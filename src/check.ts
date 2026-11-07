import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { lexComponent, lexImportsExports } from "sveast/lexer";
import { version as TOOL_VERSION } from "../package.json";
import {
  checkerArgs,
  checkerCommand,
  CHECKERS,
  nativeCommand,
} from "./checker.ts";
import {
  compileAll,
  compileFilesOffThread,
  compileKey,
  compileOffThread,
  type CompileRequest,
  type CompileResult,
  type ConfigShape,
  svelteDirOf,
  withEdits,
} from "./compiler.ts";
import { configFingerprint } from "./config.ts";
import type { emit } from "./emit.ts";
import { glob } from "./glob.ts";
import { createLocator, type Output } from "./output.ts";
import {
  asTypeScriptPath,
  byFolder,
  programFiles,
  projectOf,
  relativeTo,
  scriptsOf,
} from "./project.ts";
import { shim } from "./shims.ts";
import type {
  CompilerDiagnostic,
  Diagnostic,
  TypecheckOptions,
  TypecheckResult,
} from "./types.ts";

/** `path(line,col): error TSxxxx: message`, as tsc, tsgo, tsrs and `bun check` print. */
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const CONTINUATION = /^\s+\S/;
const GLOBAL_DIAGNOSTIC = /^error (TS\d+): (.*)$/;
const TS_MODULE = /\.[cm]?tsx?$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
/** A comment that hides the next line's error from TypeScript. */
const TS_DIRECTIVE = /^\s*\/\/\s*@ts-(ignore|expect-error)\b/;
const LINE_BREAK = /\r?\n/;
const JS_FILE = /\.[cm]?jsx?$/;
/** Errors that stop a checker before it type-checks anything. */
const SYNTAX_CODE = /^TS[18]\d{3}$/;
const STOPPED = /Stopped before type checking/;
const TS_SCRIPT = /<script\b[^>]*\blang=["']?(ts|typescript)\b/;
/** `A.d.svelte`, `A.d.svelte.ts`, `++A.svelte.ts` and `A.svelte.js`: `A.svelte`'s code. */
const GENERATED_NAME =
  /(?:\+\+)?([^/\\]+?)(?:\.d\.svelte(?:\.ts)?|\.svelte\.[jt]s)$/;
const DRIVE_PATH = /\b[A-Z]:\//g;
const toPosix = (path: string) => path.split(sep).join("/");
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A type error, which a checker reports only once the program parses. */
const TYPE_CODE = /^TS[2-7]\d{3}$/;
/** What an error's range covers past its start: an identifier, number or string. */
const TOKEN = /^(?:[\w$]+|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)/;

/** "No overload matches this call", or a wrong argument: to `$$check.store`. */
const STORE_ERROR = /^TS(2769|2345)$/;
/** Unused label, and an unused comma operand. */
const REACTIVE_NOISE = /^TS(7028|2695)$/;
/**
 * "Cannot find module": an import that resolved to nothing, whose file
 * can appear where no input the result cache keys on changes.
 */
const UNRESOLVED_MODULE = /^TS(2307|2732|2792)$/;

/** The caches' shape, in each one's key: a new shape misses the old. */
const CACHE_FORMAT = 2;
/** The last run's result, and a key to what it read. */
const RESULT_CACHE = "result.json";
interface ResultCache {
  key: string;
  /** The files the run's program imported, as far as ordering read them. */
  inputs: string[];
  /** Their sizes and modification times, hashed. */
  inputsKey: string;
  result: TypecheckResult;
}
/** What generating each component did, for an incremental run. */
const EMIT_CACHE = "emit-cache.json";
interface EmitEffects {
  /** The files it wrote. */
  files: string[];
  /** The generated code the checker reads, and the component's language. */
  genPath?: string;
  lang?: "ts" | "js";
  /** Its parse error, or TypeScript in its JS script. */
  diagnostics: Diagnostic[];
}
interface EmitCache {
  /** svelte-typecheck's version, Svelte's, and the options generating reads. */
  fingerprint: string;
  /** By a hash of a component's path and text. */
  entries: Record<string, EmitEffects>;
}
/** The compiler pass's last results, by component. */
const COMPILE_CACHE = "compile-cache.json";
interface CompileCache {
  /** svelte-typecheck's version, Svelte's and the config's. */
  fingerprint: string;
  /** Diagnostics, by a hash of a component's name and text. */
  entries: Record<string, CompilerDiagnostic[]>;
  /** The config's shape, and the packages it was read with. */
  shape?: ConfigShape;
  shapeKey?: string;
}
const hash = (text: string) => createHash("sha1").update(text).digest("hex");
/**
 * What every cache is kept by, besides its own inputs: the version, or run
 * from source, a hash of the source, as a change to it keeps the version.
 */
const TOOL_KEY = import.meta.url.endsWith(".ts")
  ? hash(
      glob(import.meta.dirname, ["**/*.ts"])
        .map((rel) => readFileSync(join(import.meta.dirname, rel), "utf-8"))
        .join("\0"),
    )
  : TOOL_VERSION;
/** Components to compile before the compiler's pass moves to a worker. */
const OFF_THREAD_AT = 16;
/** The files the last incremental run wrote. */
const MANIFEST = "manifest.json";

/** svelte-check's compiler options with no tsconfig. */
const DEFAULT_COMPILER_OPTIONS = {
  allowJs: true,
  noEmit: true,
  declaration: false,
  skipLibCheck: true,
  maxNodeModuleJsDepth: 2,
  allowSyntheticDefaultImports: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
};

/** Thrown when generated code doesn't parse: an emitter bug, not a type error. */
export class EmitError extends Error {}

/** A Windows shell argument, quoted when it has a space or a special character. */
const SHELL_SPECIAL = /[\s"&|<>^()%!]/;
const quote = (arg: string) =>
  SHELL_SPECIAL.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg;

function run(
  command: string,
  args: string[],
  cwd: string,
  shell = false,
): Promise<string> {
  return new Promise((done, fail) => {
    // A shell's `$PWD` can name the folder through a symlink, and Go's
    // `os.Getwd` (tsgo's) trusts it: its paths would be relative to that.
    const env = { ...process.env, PWD: cwd };
    const child = shell
      ? spawn(quote(command), args.map(quote), { cwd, env, shell: true })
      : spawn(command, args, { cwd, env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", fail);
    child.on("close", () => done(output));
  });
}

interface RawDiagnostic {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

/** Errors as the checker prints them, multi-line messages joined. */
function parseDiagnostics(text: string): RawDiagnostic[] {
  const found: RawDiagnostic[] = [];
  let continues = false;
  for (const line of text.split(LINE_BREAK)) {
    const m = DIAGNOSTIC.exec(line);
    // An error with no file: an option's, or a root file's.
    const global = m ? null : GLOBAL_DIAGNOSTIC.exec(line);
    if (m)
      found.push({
        file: m[1] ?? "",
        line: Number(m[2]),
        column: Number(m[3]),
        code: m[4] ?? "",
        message: m[5] ?? "",
      });
    else if (global)
      found.push({
        file: "",
        line: 1,
        column: 1,
        code: global[1] ?? "",
        message: global[2] ?? "",
      });
    else if (continues && CONTINUATION.test(line)) {
      const last = found.at(-1);
      if (last) last.message += `\n${line}`;
    }
    // A blank line ends the errors: `bun check` follows them with a summary.
    continues =
      m !== null || global !== null || (continues && line.trim() !== "");
  }
  return found;
}

const STATIC_IMPORT = /(?:\bfrom\s*|^\s*import\s*)["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const JS_EXTENSION = /\.([cm]?)js(x?)$/;

/**
 * Files in TypeScript's program order: roots as it lists a folder (files
 * before subfolders, by name), each after the files it imports: its static
 * imports, then its `import()`s and import types, as TypeScript collects them.
 * Roots can be added later, after those visited, as more files turn up.
 */
function programOrder(
  specifiersOf: (path: string) => string[],
  resolveImport: (from: string, specifier: string) => string | undefined,
) {
  const order = new Map<string, number>();
  /** Each file's imports, filled in as it's read. */
  const imports = new Map<string, Set<string>>();
  let next = 0;
  const visit = (path: string) => {
    if (order.has(path)) return;
    order.set(path, Number.POSITIVE_INFINITY);
    for (const specifier of specifiersOf(path)) {
      const target = resolveImport(path, specifier);
      if (!target) continue;
      imports.set(path, (imports.get(path) ?? new Set()).add(target));
      visit(target);
    }
    order.set(path, next++);
  };
  return {
    order,
    imports,
    add(roots: string[]) {
      for (const root of roots) visit(root);
    },
  };
}

/**
 * A module resolver for ordering, close enough to TypeScript's: relative
 * imports, through `rootDirs` (SvelteKit's `./$types`) when the file isn't
 * there, and `paths`. Packages aren't followed.
 */
function importResolver(rootDirs: string[], paths: Record<string, string[]>) {
  const exists = new Map<string, boolean>();
  const isFile = (path: string) => {
    let found = exists.get(path);
    if (found === undefined) {
      found = statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
      exists.set(path, found);
    }
    return found;
  };
  // `./a.js` names `./a.ts`, `./a.d.ts` too, as TypeScript resolves it.
  const fileAt = (target: string) =>
    [
      target,
      `${target}.ts`,
      `${target}.d.ts`,
      `${target}.js`,
      target.replace(JS_EXTENSION, ".$1ts$2"),
      target.replace(JS_EXTENSION, ".d.$1ts"),
      join(target, "index.ts"),
      join(target, "index.js"),
    ].find(
      (path) => !path.includes(`${sep}node_modules${sep}`) && isFile(path),
    );
  const throughRootDirs = (target: string) => {
    const from = rootDirs
      .filter((dir) => target.startsWith(`${dir}${sep}`))
      .sort((a, b) => b.length - a.length)[0];
    if (!from) return;
    const suffix = relative(from, target);
    for (const dir of rootDirs) {
      if (dir === from) continue;
      const found = fileAt(join(dir, suffix));
      if (found) return found;
    }
    return;
  };
  const patterns = Object.entries(paths).map(([key, targets]) => {
    const star = key.indexOf("*");
    return { key, star, targets };
  });
  return (from: string, specifier: string): string | undefined => {
    if (specifier.startsWith(".")) {
      const target = resolve(dirname(from), specifier);
      return fileAt(target) ?? throughRootDirs(target);
    }
    for (const { key, star, targets } of patterns) {
      let rest: string;
      if (star === -1) {
        if (specifier !== key) continue;
        rest = "";
      } else {
        const prefix = key.slice(0, star);
        const suffix = key.slice(star + 1);
        if (
          !specifier.startsWith(prefix) ||
          !specifier.endsWith(suffix) ||
          specifier.length < prefix.length + suffix.length
        )
          continue;
        rest = specifier.slice(prefix.length, specifier.length - suffix.length);
      }
      for (const target of targets) {
        const found = fileAt(target.replace("*", rest));
        if (found) return found;
      }
    }
    return;
  };
}

const NON_BINDABLE =
  "Cannot use 'bind:' with this property. It is declared as non-bindable inside the component.\n";

/** The hints svelte-check adds to a component's errors. */
function withHint(d: Diagnostic, svelteMajor: number): Diagnostic {
  if (
    d.code === "TS2345" &&
    d.message.includes("ConstructorOfATypedSvelteComponent")
  )
    return {
      ...d,
      message: `${d.message}\n\nPossible causes:\n- You use the instance type of a component where you should use the constructor type\n- Type definitions are missing for this Svelte Component. ${svelteMajor >= 5 ? "" : 'If you are using Svelte 3.31+, use SvelteComponentTyped to add a definition:\n  import type { SvelteComponentTyped } from "svelte";\n  class ComponentName extends SvelteComponentTyped<{propertyName: string;}> {}'}`,
    };
  if (d.code === "TS1184")
    return {
      ...d,
      message: `${d.message}\nIf this is a declare statement, move it into <script context="module">..</script>`,
    };
  return d;
}

/** svelte-check's message for a `bind:` of a prop that isn't `$bindable()`. */
function nonBindableMessage(message: string): string {
  if (
    message.startsWith("Type '") &&
    message.includes("is not assignable to type '")
  ) {
    const at = message.indexOf(`Type '"`) + `Type '"`.length;
    const prop = message.slice(at, message.indexOf('"', at));
    return `${NON_BINDABLE}To mark a property as bindable: 'let { ${prop} = $bindable() } = $props()'`;
  }
  return `${NON_BINDABLE}To mark a property as bindable: 'let { prop = $bindable() } = $props()'\n\n${message}`;
}

const NOTHING_EMITTED = {
  reactive: [],
  transitions: [],
  storeDeclarations: [],
  bindingChecks: [],
};

/** SvelteKit's major version, from the project's `@sveltejs/kit`, or 0. */
function kitMajor(root: string): number {
  try {
    const path = createRequire(join(root, "package.json")).resolve(
      "@sveltejs/kit/package.json",
    );
    const { version } = JSON.parse(readFileSync(path, "utf-8")) as {
      version: string;
    };
    return Number.parseInt(version, 10);
  } catch {
    return 0;
  }
}

/** The deepest folder that holds every path. */
function commonDir(paths: string[]): string {
  let common = paths[0] ?? sep;
  for (const path of paths)
    while (!`${path}${sep}`.startsWith(`${common}${sep}`) && common !== sep)
      common = dirname(common);
  return common;
}

/**
 * Type-checks Svelte components, as svelte-check does: with a tsconfig
 * (given, or the nearest from the workspace up), the components it
 * includes, and its TS and JS files' errors too; with none, every component
 * under the workspace. Each component becomes TypeScript under `outDir`,
 * next to a tsconfig that extends the project's, a checker runs on it, and
 * each error maps back to its `.svelte` line. Errors in generated code are
 * dropped. Svelte's compiler reports its warnings in the same pass.
 */
export async function typecheck(
  options: TypecheckOptions = {},
): Promise<TypecheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const workspace = resolve(cwd, options.workspace ?? ".");
  const project = projectOf({
    workspace,
    tsconfig: options.tsconfig,
    ignore: options.ignore,
    components: options.components,
  });
  const outDir = resolve(
    cwd,
    options.outDir ??
      join("node_modules/.cache/svelte-typecheck", relative(cwd, workspace)),
  );
  const genDir = join(outDir, "svelte");
  const declarations = options.declarations ?? true;
  const svelteDir = svelteDirOf(cwd, options.svelte);
  const sources = new Set(options.diagnosticSources ?? ["js", "svelte"]);
  const errorsOnly = options.threshold === "error";
  const { version } = JSON.parse(
    readFileSync(join(svelteDir, "package.json"), "utf-8"),
  ) as { version: string };
  const svelteMajor = Number(version.split(".")[0]);
  // Svelte 4 and 5 ship element typings; Svelte 3 doesn't, so ours are
  // written beside the shims.
  const svelteHtml =
    svelteMajor === 3
      ? join(outDir, "svelte-html.d.ts")
      : join(svelteDir, "svelte-html.d.ts");

  const checker =
    options.checker ??
    CHECKERS.find((c) => checkerCommand(c, workspace) !== undefined);
  // From the workspace up: a monorepo package's own install, then a
  // hoisted one, wherever the run starts.
  const command = checker && checkerCommand(checker, workspace);
  // Found while this thread generates code, for when the checker starts.
  const native = command ? nativeCommand(command) : undefined;
  // The compiler's diagnostics alone run no checker, so need none.
  if (sources.has("js") && !(checker && command))
    throw new Error(
      `No type checker found: install \`typescript\` (or one of ${CHECKERS.slice(1).join(", ")}), or name one with \`checker\`.`,
    );

  const started = performance.now();
  const incremental = options.incremental ?? true;
  const configDir = options.config
    ? dirname(resolve(workspace, options.config))
    : workspace;
  const configFile = options.config
    ? resolve(workspace, options.config)
    : undefined;
  // A run with no compiler results kept compiles every component, on the
  // worker from here: it reads them, and loads the compiler and the config
  // (through Vite, up to half a second), while this thread reads them too
  // and generates code.
  /** When the compiler's pass started, on the worker; on this thread, once code is generated. */
  let compileStartedAt: number | undefined;
  const compilingEarly =
    sources.has("svelte") &&
    sources.has("js") &&
    project.components.length >= OFF_THREAD_AT &&
    !(incremental && existsSync(join(outDir, COMPILE_CACHE)))
      ? compileFilesOffThread({
          svelteDir,
          configDir,
          configFile,
          files: project.components.map((path) => ({
            path,
            filename: relative(cwd, path),
          })),
        })
      : undefined;
  // An incremental run keeps the last run's code and rewrites what changed.
  const previous = incremental
    ? await readFile(join(outDir, MANIFEST), "utf-8")
        .then((text) => new Set(JSON.parse(text) as string[]))
        .catch(() => new Set<string>())
    : new Set<string>();
  const cleared = incremental ? undefined : await clearOutDir(outDir);
  const files = project.components;
  const listedFiles = project.tsconfig
    ? programFiles(project)
    : [...files].sort(byFolder);

  // Nothing the run reads has changed since the last one: its result. The
  // files are known by their size and modification time, which a `stat`
  // gives without reading them.
  const resultPath = join(outDir, RESULT_CACHE);
  const projectDir = project.tsconfig ? dirname(project.tsconfig) : workspace;
  const last = incremental
    ? await readFile(resultPath, "utf-8")
        .then((text) => JSON.parse(text) as ResultCache)
        .catch(() => undefined)
    : undefined;
  const runKey = incremental
    ? hash(
        JSON.stringify([
          TOOL_KEY,
          CACHE_FORMAT,
          version,
          checker,
          command?.version,
          cwd,
          options,
          configFingerprint(configDir, configFile),
          statsOf([
            ...files,
            ...listedFiles,
            ...project.configFiles,
            // SvelteKit's `.svelte-kit/types`, outside `include`.
            ...project.rootDirs.flatMap((dir) =>
              `${projectDir}${sep}`.startsWith(`${dir}${sep}`) ||
              outDir.startsWith(`${dir}${sep}`) ||
              !existsSync(dir)
                ? []
                : glob(dir, ["**/*"]).map((rel) => join(dir, rel)),
            ),
            ...packageFilesOf(projectDir),
          ]),
        ]),
      )
    : "";
  // And what the last run's program imported, outside `include` too: a
  // sibling package's source.
  if (
    last?.key === runKey &&
    Array.isArray(last.inputs) &&
    hash(JSON.stringify(statsOf(last.inputs))) === last.inputsKey
  )
    return { ...last.result, timings: { emit: 0, check: 0, compile: 0 } };
  const texts = await Promise.all(files.map((path) => readFile(path, "utf-8")));
  // Generated code mirrors the sources under one root, so `rootDirs` maps
  // a relative import between them.
  // The tsconfig's folder, where its `rootDirs` (SvelteKit's) start.
  const root = commonDir([
    project.tsconfig ? dirname(project.tsconfig) : workspace,
    ...files.map((file) => dirname(file)),
  ]);

  // The compiler pass's results by component, for an incremental run: a
  // component whose text, Svelte, config and svelte-typecheck are the
  // same compiles the same. With every one cached, the config, which can
  // mean loading Vite, isn't loaded either. The rest compile on a worker
  // from here, while this thread generates code and the checker runs.
  const cachePath = join(outDir, COMPILE_CACHE);
  const fingerprint = hash(
    JSON.stringify([
      TOOL_KEY,
      CACHE_FORMAT,
      version,
      configFingerprint(configDir, configFile),
    ]),
  );
  const cache: CompileCache = incremental
    ? ((await readFile(cachePath, "utf-8")
        .then((text) => JSON.parse(text) as CompileCache)
        .then((c) => (c.fingerprint === fingerprint ? c : undefined))
        .catch(() => undefined)) ?? { fingerprint, entries: {} })
    : { fingerprint, entries: {} };
  const keys = files.map((path, i) =>
    compileKey(relative(cwd, path), texts[i] ?? ""),
  );
  const missing = sources.has("svelte")
    ? files
        .map((_, i) => i)
        .filter((i) => cache.entries[keys[i] ?? ""] === undefined)
    : [];
  // A Vite plugin's preprocessors are the installed package's.
  const shapeKey = hash(JSON.stringify(statsOf(packageFilesOf(projectDir))));
  const compileRequest: CompileRequest = {
    svelteDir,
    configDir,
    configFile,
    shape: cache.shapeKey === shapeKey ? cache.shape : undefined,
    components: missing.map((i) => ({
      source: texts[i] ?? "",
      filename: relative(cwd, files[i] ?? ""),
    })),
  };
  // Worth a worker's start only with as much code to generate beside it;
  // with none to generate or checker to wait for, nothing runs beside it.
  let compilingOffThread: Promise<CompileResult> | undefined;
  // Every component missing: `missing[n]` is `n`, so the worker's results,
  // by file, are by missing component too.
  if (compilingEarly && missing.length === files.length) {
    compileStartedAt = compilingEarly.at;
    compilingOffThread = compilingEarly.wait().then((early) =>
      withEdits(early, keys, async (edited) => {
        const request = {
          ...compileRequest,
          components: edited.map((i) => ({
            source: texts[i] ?? "",
            filename: relative(cwd, files[i] ?? ""),
          })),
        };
        return (
          (await compileOffThread(request)) ?? (await compileAll(request))
        ).results;
      }),
    );
  } else if (missing.length >= OFF_THREAD_AT && sources.has("js")) {
    compileStartedAt = performance.now();
    compilingOffThread = compileOffThread(compileRequest);
  }
  // Unhandled until awaited, after the checker: a rejection is the run's.
  compilingOffThread?.catch(() => {});
  // When it finished, for the run's timings, as this thread may be busy then.
  const compiledOffThreadAt = compilingOffThread?.then(
    () => performance.now(),
    () => undefined,
  );

  const outputs = new Map<
    string,
    {
      output: Output;
      source: string;
      svelte: string;
      isTs: boolean;
      emitted: Pick<
        ReturnType<typeof emit>,
        "reactive" | "transitions" | "storeDeclarations" | "bindingChecks"
      >;
      /** A SvelteKit file's typed copy, whose syntax errors are the user's. */
      kit?: boolean;
    }
  >();
  const writes: Promise<void>[] = [];
  const written = new Set<string>();
  /** What this run generated, by path, so it isn't read back from disk. */
  const generated = new Map<string, string>();
  /** Each folder's `mkdir`, made once for all the files written in it. */
  const folders = new Map<string, Promise<unknown>>();
  const folder = (dir: string) => {
    let made = folders.get(dir);
    if (!made) {
      made = mkdir(dir, { recursive: true });
      folders.set(dir, made);
    }
    return made;
  };
  const write = (path: string, content: string) => {
    written.add(path);
    generated.set(path, content);
    writes.push(
      (incremental
        ? readFile(path, "utf-8").catch(() => undefined)
        : Promise.resolve(undefined)
      ).then(async (old) => {
        if (old === content) return;
        await folder(dirname(path));
        await writeFile(path, content);
      }),
    );
  };

  const failed: TypecheckResult["failed"] = [];
  const parseErrors: Diagnostic[] = [];
  const under = (path: string, dir: string) => path.startsWith(`${dir}${sep}`);
  const tsconfig = join(outDir, "tsconfig.json");
  // What's read from each project file to order and report diagnostics,
  // kept by its size and modification time for the next run.
  const fileFacts = await factsCache(join(outDir, FACTS_CACHE), incremental);
  /**
   * Without `allowJs`, a JS component is an untyped JS module to its
   * importers, as svelte-check has it: each import of one from TypeScript.
   */
  const untypedImports = await (async () => {
    if (!(sources.has("js") && project.tsconfig && !project.allowJs)) return [];
    const untyped = new Set(
      files.filter(
        (path, i) =>
          !TS_SCRIPT.test(texts[i] ?? "") && !existsSync(`${path}.d.ts`),
      ),
    );
    if (untyped.size === 0) return [];
    const resolvePath = importResolver(
      [root, ...project.rootDirs],
      project.paths,
    );
    // An import of the package's own name, which `paths` didn't find.
    const resolveSelf = importResolver([], project.selfExports);
    const tsComponents = new Map(
      files.flatMap((path, i) => {
        const text = texts[i] ?? "";
        return TS_SCRIPT.test(text) ? [[path, text] as const] : [];
      }),
    );
    const tsModules = listedFiles.filter((path) => TS_MODULE.test(path));
    await fileFacts.read(tsModules);
    return [...tsComponents.keys(), ...tsModules].flatMap((path) =>
      fileFacts
        .of(
          path,
          "svelteImports",
          (content) => svelteImportsOf(content, path.endsWith(".svelte")),
          tsComponents.get(path),
        )
        .flatMap((i) => {
          const target =
            resolvePath(path, i.specifier) ?? resolveSelf(path, i.specifier);
          return target && untyped.has(target) ? [{ ...i, path, target }] : [];
        }),
    );
  })();
  // The compiler's diagnostics alone need no generated code, and leave
  // the last run's in place.
  if (sources.has("js")) {
    // Loaded here: a run that returns the last result never parses.
    const [{ emit }, { isKitFile, isKitRouteFile, kitFile }] =
      await Promise.all([import("./emit.ts"), import("./kit.ts")]);
    // Each component's generated code, by a hash of what it's made from:
    // an incremental run regenerates only what changed. One that didn't is
    // generated again, in memory, only to map an error the checker reports
    // in it.
    const emitCachePath = join(outDir, EMIT_CACHE);
    const emitFingerprint = hash(
      JSON.stringify([
        TOOL_KEY,
        CACHE_FORMAT,
        svelteMajor,
        project.checkJs,
        project.allowJs,
        declarations,
        root,
        genDir,
      ]),
    );
    const emitCache: EmitCache = (incremental
      ? await readFile(emitCachePath, "utf-8")
          .then((text) => JSON.parse(text) as EmitCache)
          .then((c) => (c.fingerprint === emitFingerprint ? c : undefined))
          .catch(() => undefined)
      : undefined) ?? { fingerprint: emitFingerprint, entries: {} };
    const nextEmitCache: EmitCache = {
      fingerprint: emitFingerprint,
      entries: {},
    };

    const emitFor = (i: number) => {
      const path = files[i] ?? "";
      const genFrom = join(genDir, relative(root, dirname(path)));
      return emit(texts[i] ?? "", {
        svelte: svelteMajor,
        basename: basename(path),
        checkJs: project.checkJs,
        // A relative import that leaves the root is relative to the
        // generated file's folder instead.
        rewriteImport(specifier) {
          if (!specifier.startsWith(".")) return;
          const target = resolve(dirname(path), specifier);
          if (target.startsWith(`${root}${sep}`)) return;
          return relativeTo(genFrom, target);
        },
      });
    };
    /** An entry whose generated code is generated only when it's needed. */
    const lazyOutput = (i: number, lang: "ts" | "js") => {
      let result: ReturnType<typeof emit> | undefined;
      const get = () => {
        result ??= emitFor(i);
        return result;
      };
      return {
        source: texts[i] ?? "",
        svelte: files[i] ?? "",
        isTs: lang === "ts",
        get output() {
          return get().out;
        },
        get emitted() {
          return get();
        },
      };
    };

    for (const [i, path] of files.entries()) {
      const genFrom = join(genDir, relative(root, dirname(path)));
      const name = path.slice(path.lastIndexOf(sep) + 1, -".svelte".length);
      // A component's own `X.svelte.d.ts` is what an import of it finds, as
      // TypeScript resolves it for svelte-check; the generated code types the rest.
      const typed = declarations && !existsSync(`${path}.d.ts`);
      const key = hash(`${path}\0${typed}\0${texts[i] ?? ""}`);
      const cached = emitCache.entries[key];
      if (cached && (!cached.genPath || existsSync(cached.genPath))) {
        for (const file of cached.files) written.add(file);
        parseErrors.push(...cached.diagnostics);
        if (cached.genPath && cached.lang)
          outputs.set(cached.genPath, lazyOutput(i, cached.lang));
        nextEmitCache.entries[key] = cached;
        continue;
      }
      const effects: EmitEffects = { files: [], diagnostics: [] };
      nextEmitCache.entries[key] = effects;
      const put = (file: string, content: string) => {
        effects.files.push(file);
        write(file, content);
      };
      let result: ReturnType<typeof emit>;
      try {
        result = emitFor(i);
      } catch (error) {
        const e = error as Error & { start?: { line: number; column: number } };
        if (!e.start) {
          failed.push({ file: path, message: e.message });
          delete nextEmitCache.entries[key];
          continue;
        }
        // A component that doesn't parse: svelte-check reports the parse error
        // from its checker too, and an import of it finds no default export.
        const isTs = TS_SCRIPT.test(texts[i] ?? "");
        effects.diagnostics.push({
          file: path,
          line: e.start.line,
          column: e.start.column + 1,
          endLine: e.start.line,
          endColumn: e.start.column + 1,
          severity: "error",
          source: isTs ? "ts" : "js",
          code: "-1",
          message: e.message,
        });
        parseErrors.push(...effects.diagnostics);
        // Without `allowJs`, a JS component is an untyped JS module to its
        // importers whether it parses or not, as svelte-check has it.
        if (!isTs && !project.allowJs) continue;
        // As svelte2tsx's output then, a module only if a script imports or
        // exports something.
        const lexed = lexComponent(texts[i] ?? "");
        const isModule = [lexed.instance, lexed.module].some(
          (script) =>
            script &&
            lexImportsExports(
              (texts[i] ?? "").slice(script.content.start, script.content.end),
            ).length > 0,
        );
        const stub = isModule ? "export {};\n" : "";
        put(join(genFrom, `++${name}.svelte.${isTs ? "ts" : "js"}`), stub);
        if (declarations) put(join(genFrom, `${name}.d.svelte.ts`), stub);
        continue;
      }
      const locate = createLocator(texts[i] ?? "");
      for (const t of result.tsInJs) {
        const at = locate.position(t.at);
        effects.diagnostics.push({
          file: path,
          line: at.line,
          column: at.column,
          severity: "error",
          source: "js",
          code: t.code,
          message: t.message,
        });
      }
      parseErrors.push(...effects.diagnostics);
      // Without `allowJs`, a JS component is an untyped JS module to its
      // importers, as svelte-check has it: outside the program, and `any`.
      if (result.lang === "js" && !project.allowJs) continue;
      const genPath = join(
        genFrom,
        `++${name}.svelte.${result.isTs ? "ts" : "js"}`,
      );
      effects.genPath = genPath;
      effects.lang = result.lang === "ts" ? "ts" : "js";
      outputs.set(genPath, {
        output: result.out,
        source: texts[i] ?? "",
        svelte: path,
        isTs: result.lang === "ts",
        emitted: result,
      });
      put(genPath, result.out.code);
      if (typed)
        put(
          join(genFrom, `${name}.d.svelte.ts`),
          `export { default } from "./++${name}.svelte.js";\nexport * from "./++${name}.svelte.js";\n`,
        );
    }
    if (incremental) write(emitCachePath, JSON.stringify(nextEmitCache));

    // An untyped JS component, as TypeScript has an untyped JS module:
    // `any`, and so is each name imported from it. A declaration, since
    // an untyped JS file in `node_modules`, where this goes, would get
    // Svelte's `*.svelte` module type instead.
    const untypedNames = new Map<string, Set<string>>();
    for (const i of untypedImports) {
      const names = untypedNames.get(i.target) ?? new Set<string>();
      for (const name of i.names) names.add(name);
      untypedNames.set(i.target, names);
    }
    const untypedDeclarationOf = (target: string) =>
      join(
        genDir,
        relative(root, dirname(target)),
        `${basename(target, ".svelte")}.d.svelte.ts`,
      );
    if (declarations)
      for (const [target, names] of untypedNames)
        write(untypedDeclarationOf(target), untypedDeclaration(names));

    // SvelteKit: its files get the types svelte-check gives them, in copies
    // that replace them, and the `./$types` they import, mirrored next to the
    // generated code, import those copies.
    const mirror = (path: string) => join(genDir, relative(root, path));
    const kitProject =
      project.tsconfig !== undefined &&
      (project.rootDirs.some((dir) => dir.includes(".svelte-kit")) ||
        files.some((path) => isKitRouteFile(basename(path))));
    const replaced: string[] = [];
    if (kitProject) {
      const hooksModule =
        kitMajor(root) >= 3 ? "@sveltejs/kit/hooks" : "@sveltejs/kit";
      for (const path of scriptsOf(project, isKitFile)) {
        if (!under(path, root)) continue;
        const source = readFileSync(path, "utf-8");
        const output = kitFile(path, source, hooksModule);
        if (!output) continue;
        replaced.push(path);
        outputs.set(mirror(path), {
          output,
          source,
          svelte: path,
          isTs: !JS_FILE.test(path),
          emitted: NOTHING_EMITTED,
          kit: true,
        });
        write(mirror(path), output.code);
      }
    }
    const rootDirs: string[] = [];
    for (const dir of project.rootDirs) {
      if (dir === root || under(dir, outDir)) continue;
      if (!(kitProject && under(dir, root) && existsSync(dir))) {
        rootDirs.push(dir);
        continue;
      }
      // A rootDir in the project, such as SvelteKit's `.svelte-kit/types`.
      replaced.push(dir);
      rootDirs.push(mirror(dir));
      // Its `$types.d.ts`, and SvelteKit 2's `proxy+page.server.ts` copies.
      for (const file of glob(dir, ["**/*.{ts,js}"]))
        write(mirror(join(dir, file)), readFileSync(join(dir, file), "utf-8"));
    }
    // An alias (`$lib/*`) finds a component's generated code before its source.
    const paths = Object.fromEntries(
      Object.entries(project.paths).map(([key, targets]) => [
        key,
        targets.flatMap((t) => (under(t, root) ? [mirror(t), t] : [t])),
      ]),
    );
    // `rootDirs` maps only a relative import: one through the package's own
    // name finds an untyped component's declaration by name.
    if (declarations)
      for (const i of untypedImports)
        if (!i.specifier.startsWith("."))
          paths[i.specifier] = [untypedDeclarationOf(i.target)];

    // A copy beside the generated code, so its `import("svelte")` is the
    // project's Svelte, not whichever this package was installed with.
    const shims = join(outDir, "shims.d.ts");
    write(shims, shim("shims.d.ts"));
    if (svelteMajor === 3) write(svelteHtml, shim("svelte3-elements.d.ts"));

    const rel = (path: string) => relativeTo(outDir, path);
    /** The program's root files: generated code in place of what it replaces. */
    const generatedFor = new Map(
      [...outputs].map(([genPath, gen]) => [gen.svelte, genPath]),
    );
    const replacedSet = new Set(replaced);
    const rootFiles = [
      ...new Set([
        ...listedFiles
          .filter((path) => path.endsWith(".svelte"))
          .map((path) => generatedFor.get(path))
          .filter((path): path is string => path !== undefined),
        ...[...outputs]
          .filter(([, gen]) => !gen.kit)
          .map(([genPath]) => genPath),
        // The project's own TypeScript, which can import components.
        ...listedFiles
          .filter((path) => !path.endsWith(".svelte"))
          .map((path) => {
            if (replacedSet.has(path)) return generatedFor.get(path);
            const dir = replaced.find((d) => under(path, d));
            return dir ? mirror(path) : path;
          })
          .filter((path): path is string => path !== undefined),
      ]),
    ];
    write(
      tsconfig,
      JSON.stringify(
        {
          ...(project.tsconfig ? { extends: rel(project.tsconfig) } : {}),
          compilerOptions: {
            ...(project.tsconfig ? {} : DEFAULT_COMPILER_OPTIONS),
            rootDirs: [rel(root), "svelte", ...rootDirs.map(rel)],
            ...(Object.keys(paths).length > 0
              ? {
                  paths: Object.fromEntries(
                    Object.entries(paths).map(([key, targets]) => [
                      key,
                      targets.map(rel),
                    ]),
                  ),
                }
              : {}),
            allowArbitraryExtensions: true,
            noEmit: true,
            // Ours, never the project's: a tsconfig's own `incremental` and
            // `tsBuildInfoFile` would have the checker write this program's
            // build info over the project's.
            composite: false,
            incremental,
            ...(incremental ? { tsBuildInfoFile: "./tsbuildinfo" } : {}),
          },
          // Listed rather than globbed: `include` skips dot folders and
          // `node_modules`, where the generated code lives by default. In
          // svelte-check's order, which decides how TypeScript prints a
          // union: components, the project's TS and JS, then the shims.
          files: [
            ...rootFiles,
            shims,
            svelteHtml,
            // Svelte 5's runes, as globals, as svelte2tsx references them.
            ...(svelteMajor >= 5 ? [join(svelteDir, "types/index.d.ts")] : []),
          ].map(rel),
          include: [],
          // The components are already TypeScript here. A content mapper
          // (TypeScript 7.1) the project's tsconfig declares would claim
          // them again, and needs `--runExternalCode` to run at all.
          contentMappers: [],
        },
        null,
        2,
      ),
    );
    write(join(outDir, MANIFEST), JSON.stringify([...written].sort()));
    // Code for a component that's gone, which an import could still find.
    for (const path of previous)
      if (!written.has(path)) writes.push(rm(path, { force: true }));
  }
  await Promise.all(writes);
  // The caches go here, generated code or not.
  if (incremental) await mkdir(outDir, { recursive: true });
  const emitted = performance.now();

  // The compiler pass runs while the checker's process works.
  const launch =
    checker && native && sources.has("js") ? await native : undefined;
  const checking =
    checker && launch
      ? run(
          launch.command,
          [...launch.prefix, ...checkerArgs(checker, tsconfig)],
          cwd,
          launch.shell,
        ).then((output) => ({ output, at: performance.now() }))
      : Promise.resolve({ output: "", at: emitted });
  // In TypeScript's program order, as svelte-check lists them: a file's
  // imports before it; in a file, the compiler's before the checker's.
  // The generated code: as this run wrote it, or read back from disk
  // rather than generated again.
  const generatedOf = new Map(
    [...outputs].map(([genPath, gen]) => [gen.svelte, genPath]),
  );
  const ordering = programOrder(
    // Generated code, whose imports include SvelteKit's `./$types`.
    (file) => {
      const path = generatedOf.get(file) ?? file;
      return fileFacts.of(
        path,
        "specifiers",
        (code) =>
          [
            ...code.matchAll(STATIC_IMPORT),
            ...code.matchAll(DYNAMIC_IMPORT),
          ].map((m) => m[1] ?? ""),
        generated.get(path),
      );
    },
    importResolver([root, ...project.rootDirs], project.paths),
  );
  // Every file TypeScript lists, in its order, not only those with errors:
  // an error-free `index.ts` that imports components puts them in its
  // import order. Ordered while the checker and the worker work, as what
  // they report doesn't change it; after a compile on this thread.
  const listedSet = new Set(listedFiles);
  if (compilingOffThread) ordering.add(listedFiles);

  const compiled: Diagnostic[] = [];
  const perFile: CompilerDiagnostic[][] = [];
  if (sources.has("svelte")) {
    if (missing.length > 0) {
      // Here, once the checker runs, when there's no worker for it.
      const fresh =
        (await compilingOffThread) ?? (await compileAll(compileRequest));
      for (const [n, i] of missing.entries())
        cache.entries[keys[i] ?? ""] = fresh.results[n] ?? [];
      cache.shape = fresh.shape;
      cache.shapeKey = fresh.shape && shapeKey;
    }
    for (const key of keys) perFile.push(cache.entries[key] ?? []);
    if (incremental) {
      const kept = Object.fromEntries(
        keys.map((key) => [key, cache.entries[key] ?? []]),
      );
      await writeFile(
        cachePath,
        JSON.stringify({
          fingerprint,
          entries: kept,
          shape: cache.shape,
          shapeKey: cache.shapeKey,
        } satisfies CompileCache),
      );
    }
  }
  for (const [i, path] of files.entries())
    for (const d of perFile[i] ?? []) {
      const level = options.compilerWarnings?.[d.code];
      if (d.severity === "warning" && level === "ignore") continue;
      compiled.push({
        file: path,
        ...d,
        severity: level === "error" ? "error" : d.severity,
        source: "svelte",
      });
    }
  const compiledAt = (await compiledOffThreadAt) ?? performance.now();
  ordering.add(listedFiles);
  const { output: text, at: checked } = await checking;

  const raw = parseDiagnostics(text);
  const inOutput = (file: string) =>
    resolve(cwd, file).startsWith(`${outDir}${sep}`);
  // A syntax error in generated code stops the checker before it
  // type-checks anything, so it must fail the run, not pass it. A type
  // error anywhere means it type-checked, and a TS1xxx error was one of
  // the semantic ones (no default export, misplaced `await`).
  const typeChecked = raw.some((d) => TYPE_CODE.test(d.code));
  const syntax = typeChecked
    ? []
    : raw.filter(
        (d) =>
          inOutput(d.file) &&
          SYNTAX_CODE.test(d.code) &&
          !outputs.get(resolve(cwd, d.file))?.kit,
      );
  if (syntax.length > 0 || STOPPED.test(text))
    throw new EmitError(
      `Generated code has syntax errors:\n${syntax
        .slice(0, 20)
        .map((d) => `${d.file}(${d.line},${d.column}): ${d.code} ${d.message}`)
        .join("\n")}`,
    );

  const locators = new Map<string, ReturnType<typeof createLocator>>();
  const locator = (key: string, content: () => string) => {
    let found = locators.get(key);
    if (!found) {
      found = createLocator(content());
      locators.set(key, found);
    }
    return found;
  };
  /** The end of the token an error starts at, as the editor underlines it. */
  const endOf = (source: string, offset: number, file: string) => {
    const length = TOKEN.exec(source.slice(offset))?.[0].length ?? 0;
    const end = locator(file, () => source).position(offset + length);
    return { endLine: end.line, endColumn: end.column };
  };
  const diagnostics: Diagnostic[] = [];
  const dropped: Diagnostic[] = [];
  const storeErrors: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const d of raw) {
    if (d.file === "") {
      // About the generated code (a root file it can't read): our bug.
      if (d.message.includes(outDir))
        throw new EmitError(`${d.code}: ${d.message}`);
      // An option's, as svelte-check reports one: on the tsconfig.
      diagnostics.push({
        ...d,
        file: project.tsconfig ?? workspace,
        severity: "error",
        source: "ts",
      });
      continue;
    }
    const abs = resolve(cwd, d.file);
    const gen = outputs.get(abs);
    let mapped: Diagnostic;
    if (gen) {
      const offset = locator(abs, () => gen.output.code).offset(
        d.line,
        d.column,
      );
      const source = gen.output.toSource(offset);
      if (source === null) {
        // svelte-check reports a `$name` that isn't a store at each use.
        const store = STORE_ERROR.test(d.code)
          ? gen.emitted.storeDeclarations.find(
              (s) => s.start <= offset && offset < s.end,
            )
          : undefined;
        if (store) {
          // After the file's other errors, as svelte-check adds them.
          for (const use of store.uses) {
            const at = locator(gen.svelte, () => gen.source).position(use);
            const end = locator(gen.svelte, () => gen.source).position(
              use + store.name.length + 1,
            );
            storeErrors.push({
              ...d,
              file: gen.svelte,
              line: at.line,
              column: at.column,
              endLine: end.line,
              endColumn: end.column,
              severity: "error",
              source: gen.isTs ? "ts" : "js",
              message: `Cannot use '${store.name}' as a store. '${store.name}' needs to be an object with a subscribe method on it.\n\n${d.message}`,
            });
          }
          continue;
        }
        // svelte-check names a `bind:` of a prop that isn't `$bindable()`.
        const binding =
          d.code === "TS2322"
            ? gen.emitted.bindingChecks.find(
                (b) => b.start <= offset && offset < b.end,
              )
            : undefined;
        if (binding) {
          const at = locator(gen.svelte, () => gen.source).position(
            binding.from,
          );
          const end = locator(gen.svelte, () => gen.source).position(
            binding.to,
          );
          diagnostics.push({
            ...d,
            file: gen.svelte,
            line: at.line,
            column: at.column,
            endLine: end.line,
            endColumn: end.column,
            severity: "error",
            source: gen.isTs ? "ts" : "js",
            message: nonBindableMessage(d.message),
          });
          continue;
        }
        dropped.push({ ...d, file: abs, severity: "error", source: "ts" });
        continue;
      }
      // What svelte-check filters out: a `$:` label TypeScript calls unused,
      // a no-op comma in `$: a, b`, and a transition's third argument.
      const within = (ranges: [number, number][]) =>
        ranges.some(([from, to]) => from <= source && source < to);
      if (
        (REACTIVE_NOISE.test(d.code) && within(gen.emitted.reactive)) ||
        (d.code === "TS2554" &&
          d.message.startsWith("Expected 3 arguments") &&
          within(gen.emitted.transitions))
      )
        continue;
      const start = locator(gen.svelte, () => gen.source).position(source);
      mapped = withHint(
        {
          ...d,
          file: gen.svelte,
          line: start.line,
          column: start.column,
          ...endOf(gen.source, source, gen.svelte),
          severity: "error",
          source: gen.isTs ? "ts" : "js",
        },
        svelteMajor,
      );
    } else if (inOutput(d.file) || !project.reports(abs)) {
      if (inOutput(d.file))
        dropped.push({ ...d, file: abs, severity: "error", source: "ts" });
      continue;
    } else {
      const content = readFileSync(abs, "utf-8");
      const offset = locator(abs, () => content).offset(d.line, d.column);
      mapped = {
        ...d,
        file: abs,
        ...endOf(content, offset, abs),
        severity: "error",
        source: JS_FILE.test(abs) ? "js" : "ts",
      };
    }
    const key = `${mapped.file}:${mapped.line}:${mapped.column}:${mapped.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(mapped);
  }
  diagnostics.push(...storeErrors);
  // A message that names generated code names its source, as svelte-check's
  // name the `.svelte` file: `<out>/svelte/src/A.d.svelte` is `src/A.svelte`.
  // TypeScript names a file `/`-separated, and on Windows svelte-check
  // with a lowercase drive letter, as a file URI's path has it.
  const generatedPath = new RegExp(
    `${escapeRegExp(`${toPosix(genDir)}/`)}[^"'\\s]*`,
    "gi",
  );
  for (const d of diagnostics) {
    d.message = d.message.replace(generatedPath, (path) =>
      asTypeScriptPath(
        join(root, relative(toPosix(genDir), path)).replace(
          GENERATED_NAME,
          "$1.svelte",
        ),
      ),
    );
    if (process.platform === "win32")
      d.message = d.message.replace(DRIVE_PATH, (drive) => drive.toLowerCase());
  }
  diagnostics.push(...compiled);
  if (sources.has("js")) diagnostics.push(...parseErrors);
  // Without `allowJs`, svelte-check still loads a JS component, so an
  // import of it from TypeScript is untyped (TS7016). It isn't in this
  // program, so the import is found here.
  if (untypedImports.length > 0) {
    /** `@ts-expect-error`s that TS7016 would have used, by file and line. */
    const expected = new Set<string>();
    const untypedErrors: Diagnostic[] = [];
    for (const i of untypedImports) {
      // With `skipLibCheck`, a declaration file's errors aren't reported.
      if (project.skipLibCheck && DECLARATION_FILE.test(i.path)) continue;
      if (i.directive) {
        if (i.directive === "expect-error")
          expected.add(`${i.path}:${i.line - 1}`);
        continue;
      }
      untypedErrors.push({
        file: i.path,
        line: i.line,
        column: i.column,
        severity: "error",
        source: "ts",
        code: "TS7016",
        message: `Could not find a declaration file for module '${i.specifier}'. '${asTypeScriptPath(i.target)}' implicitly has an 'any' type.`,
      });
    }
    // Where TypeScript reports it: after the errors before the import in
    // its file (another import's, say), and before those after it.
    for (const error of untypedErrors) {
      const after = diagnostics.findIndex(
        (d) =>
          d.file === error.file &&
          d.source !== "svelte" &&
          (d.line > error.line ||
            (d.line === error.line && d.column > error.column)),
      );
      diagnostics.splice(after === -1 ? diagnostics.length : after, 0, error);
    }
    // An `@ts-expect-error` that TS7016 would have used isn't unused, as
    // TypeScript reports it here, where nothing reads the import.
    if (expected.size > 0) {
      const kept = diagnostics.filter(
        (d) => !(d.code === "TS2578" && expected.has(`${d.file}:${d.line}`)),
      );
      diagnostics.length = 0;
      diagnostics.push(...kept);
    }
  }
  // TypeScript fails a tsconfig that includes nothing, and svelte-check
  // reports it; one that includes no components, svelte-check warns of.
  if (project.tsconfig && project.inputSpecs && listedFiles.length === 0)
    diagnostics.push({
      file: project.tsconfig,
      line: 1,
      column: 1,
      severity: "error",
      source: "ts",
      code: "TS18003",
      message: `No inputs were found in config file '${asTypeScriptPath(project.tsconfig)}'. Specified 'include' paths were '${JSON.stringify(project.inputSpecs.include)}' and 'exclude' paths were '${JSON.stringify(project.inputSpecs.exclude)}'.`,
    });
  else if (project.tsconfig && !options.components && files.length === 0)
    diagnostics.push({
      file: project.tsconfig,
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
      severity: "warning",
      source: "svelte",
      code: "100001",
      message: `No svelte input files were found in config file '${asTypeScriptPath(project.tsconfig)}'. Did you forget to add svelte files to the 'include' in your ${basename(project.tsconfig)}? Specified 'include' paths were '${JSON.stringify(project.raw.include)}' and 'exclude' paths were '${JSON.stringify(project.raw.exclude)}'`,
    });
  const reported = errorsOnly
    ? diagnostics.filter((d) => d.severity === "error")
    : diagnostics;
  // A reported file outside the listed ones comes after them.
  ordering.add(
    [...new Set(reported.map((d) => d.file))]
      .filter((file) => !listedSet.has(file))
      .sort(byFolder),
  );
  const { order, imports } = ordering;
  // Only some files' diagnostics: those, and the files that import them,
  // whose errors a change to them can cause.
  let skipped = 0;
  if (options.only) {
    const shown = new Set(options.only.map((path) => resolve(cwd, path)));
    for (const [file, targets] of imports)
      for (const target of targets)
        if (options.only.some((path) => resolve(cwd, path) === target))
          shown.add(file);
    const kept = reported.filter((d) => shown.has(d.file));
    skipped = reported.length - kept.length;
    reported.length = 0;
    reported.push(...kept);
  }
  const sourceRank = (d: Diagnostic) => (d.source === "svelte" ? 0 : 1);
  // Stable: in a file, the checker's order (generated code's, so a hoisted
  // snippet's errors come first), as svelte-check keeps it.
  reported.sort(
    (a, b) =>
      (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0) ||
      sourceRank(a) - sourceRank(b),
  );

  const result: TypecheckResult = {
    diagnostics: reported,
    workspace,
    tsconfig: project.tsconfig,
    components: files.length,
    skipped,
    dropped,
    failed,
    checker,
    checkerVersion: command?.version,
    timings: {
      emit: emitted - started,
      check: checked - emitted,
      // Not from `emitted`: on the worker, it can start well before.
      compile: compiledAt - (compileStartedAt ?? emitted),
    },
  };
  const inputs = [...order.keys()]
    .filter((path) => !under(path, outDir))
    .flatMap((path) => [path, ...declarationsBeside(path)]);
  if (incremental) await fileFacts.save();
  // A result with an import that resolved to nothing isn't kept: the file
  // it names can appear anywhere resolution looks, which nothing here stats.
  if (incremental && diagnostics.some((d) => UNRESOLVED_MODULE.test(d.code)))
    await rm(resultPath, { force: true });
  else if (incremental)
    await writeFile(
      resultPath,
      JSON.stringify({
        key: runKey,
        inputs,
        inputsKey: hash(JSON.stringify(statsOf(inputs))),
        result,
      } satisfies ResultCache),
    );
  // Nothing of the run's left running once it returns.
  await cleared?.deleted;
  return result;
}

const FACTS_CACHE = "files.json";
interface Facts {
  /** Its size and modification time. */
  stat: string;
  /** Its imports' specifiers, in TypeScript's order. */
  specifiers?: string[];
  /** Its `.svelte` imports. */
  svelteImports?: SvelteImport[];
}

/** An import of a `.svelte` file, from a TS file or component. */
interface SvelteImport {
  specifier: string;
  /** The specifier's. */
  line: number;
  column: number;
  /** A `@ts-ignore` or `@ts-expect-error` on the line before. */
  directive: "ignore" | "expect-error" | null;
  /** The names it imports, or re-exports. */
  names: string[];
}

/** A TS source's `.svelte` imports: a module's, or a component's scripts'. */
function svelteImportsOf(content: string, component: boolean): SvelteImport[] {
  if (!content.includes(".svelte")) return [];
  const lexed = component ? lexComponent(content) : undefined;
  const ranges = lexed
    ? [lexed.module, lexed.instance].flatMap((script) =>
        script ? [[script.content.start, script.content.end] as const] : [],
      )
    : [[0, content.length] as const];
  const locate = createLocator(content);
  const lines = content.split("\n");
  return ranges.flatMap(([start, end]) =>
    lexImportsExports(content.slice(start, end)).flatMap((statement) => {
      const specifier = statement.source?.value;
      if (!specifier?.endsWith(".svelte")) return [];
      const at = locate.position(start + (statement.source?.start ?? 0));
      const directive = TS_DIRECTIVE.exec(lines[at.line - 2] ?? "")?.[1];
      return [
        {
          specifier,
          line: at.line,
          column: at.column,
          directive:
            directive === "ignore" || directive === "expect-error"
              ? directive
              : null,
          names: statement.specifiers.flatMap((spec) => {
            // An import's name in the module, or a re-export's.
            const name = "imported" in spec ? spec.imported : spec.local;
            return name === "*" ? [] : [name];
          }),
        },
      ];
    }),
  );
}

/**
 * An untyped module, as TypeScript has one: its default export is `any`,
 * and so is each name it's imported by, each as a value and as a type that
 * takes type arguments, unused but for the type to read them.
 */
function untypedDeclaration(names: Set<string>): string {
  const declare = (name: string) =>
    `declare const ${name}: any;\ntype ${name}<${UNTYPED_PARAMS}> = any & [${UNTYPED_ARGS}];\n`;
  const named = [...names].filter(
    (name) => name !== "default" && IDENTIFIER.test(name),
  );
  return `${[UNTYPED, ...named].map(declare).join("")}export default ${UNTYPED};\n${named.length > 0 ? `export { ${named.join(", ")} };\n` : ""}`;
}
const UNTYPED = "$$untyped";
const UNTYPED_ARGS = "A, B, C, D, E, F, G, H";
const UNTYPED_PARAMS = UNTYPED_ARGS.split(", ")
  .map((p) => `${p} = any`)
  .join(", ");

/** Facts about files, read once per change of a file's size or time. */
async function factsCache(path: string, enabled: boolean) {
  const entries: Record<string, Facts> = enabled
    ? await readFile(path, "utf-8")
        .then((text) => {
          const cache = JSON.parse(text) as {
            format: number;
            entries: Record<string, Facts>;
          };
          return cache.format === CACHE_FORMAT ? cache.entries : {};
        })
        .catch(() => ({}))
    : {};
  const used: Record<string, Facts> = {};
  /** Each file's stat, once a run. */
  const stats = new Map<string, string>();
  const statOf = (file: string) => {
    let stat = stats.get(file);
    if (stat === undefined) {
      stat = statsOf([file])[0] ?? "";
      stats.set(file, stat);
    }
    return stat;
  };
  /** Texts `read` read, until `of` has what it needs from them. */
  const texts = new Map<string, string>();
  return {
    of<K extends "specifiers" | "svelteImports">(
      file: string,
      kind: K,
      compute: (text: string) => NonNullable<Facts[K]>,
      /** The file's text, when it's known without reading it. */
      text?: string,
    ): NonNullable<Facts[K]> {
      const stat = statOf(file);
      let facts = used[file] ?? entries[file];
      if (facts?.stat !== stat) facts = { stat };
      used[file] = facts;
      facts[kind] ??= compute(
        text ?? texts.get(file) ?? readFileSync(file, "utf-8"),
      );
      if (facts.specifiers && facts.svelteImports) texts.delete(file);
      return facts[kind] as NonNullable<Facts[K]>;
    },
    /**
     * Reads the files whose facts aren't kept, all at once, for `of`: one
     * at a time, a run's first read of a project's TS files can take a
     * few hundred milliseconds.
     */
    async read(files: string[]): Promise<void> {
      await Promise.all(
        files.map(async (file) => {
          const facts = used[file] ?? entries[file];
          if (facts?.stat === statOf(file) && facts.svelteImports) return;
          const text = await readFile(file, "utf-8").catch(() => undefined);
          if (text !== undefined) texts.set(file, text);
        }),
      );
    },
    save: () =>
      writeFile(path, JSON.stringify({ format: CACHE_FORMAT, entries: used })),
  };
}

/**
 * The declarations TypeScript reads in place of a JS file or a component
 * an import names (`X.svelte.d.ts`, which a build can write beside it), so
 * a change to them, or their creation, is a change to the run.
 */
function declarationsBeside(path: string): string[] {
  if (path.endsWith(".svelte")) return [`${path}.d.ts`];
  return JS_EXTENSION.test(path) ? [path.replace(JS_EXTENSION, ".d.$1ts")] : [];
}

/**
 * Empties `outDir` for a run that keeps nothing from the last: moved
 * aside, to a dot folder no glob enters, and deleted while the run goes
 * on, where deleting it first took a tenth of a second on a large
 * project. One an earlier run left, as a stopped one can, goes too.
 * `deleted` is that deletion, which the run waits for before it returns.
 */
async function clearOutDir(
  outDir: string,
): Promise<{ deleted: Promise<unknown> }> {
  const parent = dirname(outDir);
  const prefix = `.${basename(outDir)}.old-`;
  try {
    await rename(outDir, join(parent, `${prefix}${process.pid}-${Date.now()}`));
  } catch (error) {
    // Nothing to clear, or it can't move (Windows, while a file's open).
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      await rm(outDir, { recursive: true, force: true });
    return { deleted: Promise.resolve() };
  }
  const names = await readdir(parent).catch(() => []);
  return {
    deleted: Promise.all(
      names
        .filter((name) => name.startsWith(prefix))
        .map((name) =>
          rm(join(parent, name), { recursive: true, force: true }).catch(
            () => {},
          ),
        ),
    ),
  };
}

/** Each file's size and modification time, or that it's missing. */
function statsOf(paths: string[]): string[] {
  return paths.map((path) => {
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat ? `${path}:${stat.size}:${stat.mtimeMs}` : `${path}:-`;
  });
}

const PACKAGE_FILES = [
  "package.json",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

/** The manifests and lockfiles from `dir` up, which a change of dependencies touches. */
function packageFilesOf(dir: string): string[] {
  const found: string[] = [];
  for (let at = dir; ; at = dirname(at)) {
    found.push(...PACKAGE_FILES.map((name) => join(at, name)));
    if (dirname(at) === at) return found;
  }
}
