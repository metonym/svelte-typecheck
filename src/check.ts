import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lexComponent, lexImportsExports } from "sveast";
import { version as TOOL_VERSION } from "../package.json";
import { checkerArgs, checkerCommand, CHECKERS } from "./checker.ts";
import { preprocessedDiagnostics, svelteDirOf } from "./compiler.ts";
import { configFingerprint, svelteConfigOf } from "./config.ts";
import { emit } from "./emit.ts";
import { glob } from "./glob.ts";
import { isKitFile, isKitRouteFile, kitFile } from "./kit.ts";
import { createLocator, type Output } from "./output.ts";
import {
  asTypeScriptPath,
  byFolder,
  programFiles,
  projectOf,
  relativeTo,
  scriptsOf,
} from "./project.ts";
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

/** "No overload matches this call", or a wrong argument: to `__sveltets_2_store_get`. */
const STORE_ERROR = /^TS(2769|2345)$/;
/** Unused label, and an unused comma operand. */
const REACTIVE_NOISE = /^TS(7028|2695)$/;

const SHIMS = fileURLToPath(new URL("./shims/", import.meta.url));
/** The caches' shape, in each one's key: a new shape misses the old. */
const CACHE_FORMAT = 1;
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
}
const hash = (text: string) => createHash("sha1").update(text).digest("hex");
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
    const child = shell
      ? spawn(quote(command), args.map(quote), { cwd, shell: true })
      : spawn(command, args, { cwd });
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
 */
function programOrder(
  roots: string[],
  specifiersOf: (path: string) => string[],
  resolveImport: (from: string, specifier: string) => string | undefined,
  /** Each file's imports, filled in as it's read. */
  imports: Map<string, Set<string>> = new Map(),
): Map<string, number> {
  const order = new Map<string, number>();
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
  for (const root of roots) visit(root);
  return order;
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
  // Svelte 4 and 5 ship element typings; Svelte 3 doesn't.
  const svelteHtml =
    svelteMajor === 3
      ? join(SHIMS, "svelte3-elements.d.ts")
      : join(svelteDir, "svelte-html.d.ts");

  const checker =
    options.checker ??
    CHECKERS.find((c) => checkerCommand(c, workspace) !== undefined);
  // From the workspace up: a monorepo package's own install, then a
  // hoisted one, wherever the run starts.
  const command = checker && checkerCommand(checker, workspace);
  if (!(checker && command))
    throw new Error(
      `No type checker found: install \`typescript\` (or one of ${CHECKERS.slice(1).join(", ")}), or name one with \`checker\`.`,
    );

  const started = performance.now();
  const incremental = options.incremental ?? true;
  // An incremental run keeps the last run's code and rewrites what changed.
  const previous = incremental
    ? await readFile(join(outDir, MANIFEST), "utf-8")
        .then((text) => new Set(JSON.parse(text) as string[]))
        .catch(() => new Set<string>())
    : new Set<string>();
  if (!incremental) await rm(outDir, { recursive: true, force: true });
  const files = project.components;
  const listedFiles = project.tsconfig
    ? programFiles(project)
    : [...files].sort(byFolder);
  const configDir = options.config
    ? dirname(resolve(workspace, options.config))
    : workspace;
  const configFile = options.config
    ? resolve(workspace, options.config)
    : undefined;

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
          TOOL_VERSION,
          CACHE_FORMAT,
          version,
          checker,
          command.version,
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
  const write = (path: string, content: string) => {
    written.add(path);
    writes.push(
      (incremental
        ? readFile(path, "utf-8").catch(() => undefined)
        : Promise.resolve(undefined)
      ).then(async (old) => {
        if (old === content) return;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      }),
    );
  };

  const failed: TypecheckResult["failed"] = [];
  const parseErrors: Diagnostic[] = [];
  const under = (path: string, dir: string) => path.startsWith(`${dir}${sep}`);
  const tsconfig = join(outDir, "tsconfig.json");
  // The compiler's diagnostics alone need no generated code, and leave
  // the last run's in place.
  if (sources.has("js")) {
    // Each component's generated code, by a hash of what it's made from:
    // an incremental run regenerates only what changed. One that didn't is
    // generated again, in memory, only to map an error the checker reports
    // in it.
    const emitCachePath = join(outDir, EMIT_CACHE);
    const emitFingerprint = hash(
      JSON.stringify([
        TOOL_VERSION,
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
        parseErrors.push(...effects.diagnostics);
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
      // importers, as svelte-check has it: `X.svelte.js`, outside the program.
      if (result.lang === "js" && !project.allowJs) {
        if (typed) put(join(genFrom, `${name}.svelte.js`), result.out.code);
        continue;
      }
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

    // A copy beside the generated code, so its `import("svelte")` is the
    // project's Svelte, not whichever this package was installed with.
    const shims = join(outDir, "shims.d.ts");
    write(shims, readFileSync(join(SHIMS, "shims.d.ts"), "utf-8"));

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
  const checking = sources.has("js")
    ? run(
        command.command,
        [...command.prefix, ...checkerArgs(checker, tsconfig)],
        cwd,
        command.shell,
      ).then((output) => ({ output, at: performance.now() }))
    : Promise.resolve({ output: "", at: emitted });
  const compiled: Diagnostic[] = [];
  // The compiler pass's results by component, for an incremental run: a
  // component whose text, Svelte, config and svelte-typecheck are the
  // same compiles the same. With every one cached, the config, which can
  // mean loading Vite, isn't loaded either.
  const cachePath = join(outDir, COMPILE_CACHE);
  const fingerprint = hash(
    JSON.stringify([
      TOOL_VERSION,
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
    hash(`${relative(cwd, path)}\0${texts[i] ?? ""}`),
  );
  const perFile: CompilerDiagnostic[][] = [];
  if (sources.has("svelte")) {
    const missing = files
      .map((_, i) => i)
      .filter((i) => cache.entries[keys[i] ?? ""] === undefined);
    if (missing.length > 0) {
      const svelteConfig = await svelteConfigOf(configDir, configFile);
      const fresh = await Promise.all(
        missing.map((i) =>
          preprocessedDiagnostics(
            texts[i] ?? "",
            relative(cwd, files[i] ?? ""),
            svelteDir,
            svelteConfig,
          ),
        ),
      );
      for (const [n, i] of missing.entries())
        cache.entries[keys[i] ?? ""] = fresh[n] ?? [];
    }
    for (const key of keys) perFile.push(cache.entries[key] ?? []);
    if (incremental) {
      const kept = Object.fromEntries(
        keys.map((key) => [key, cache.entries[key] ?? []]),
      );
      await writeFile(
        cachePath,
        JSON.stringify({ fingerprint, entries: kept } satisfies CompileCache),
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
  const compiledAt = performance.now();
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
  // What's read from each project file to order and report diagnostics,
  // kept by its size and modification time for the next run.
  const fileFacts = await factsCache(join(outDir, FACTS_CACHE), incremental);
  const dropped: Diagnostic[] = [];
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
          for (const use of store.uses) {
            const at = locator(gen.svelte, () => gen.source).position(use);
            const end = locator(gen.svelte, () => gen.source).position(
              use + store.name.length + 1,
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
  if (sources.has("js") && project.tsconfig && !project.allowJs) {
    const untyped = new Set(
      files.filter(
        (path, i) =>
          !TS_SCRIPT.test(texts[i] ?? "") && !existsSync(`${path}.d.ts`),
      ),
    );
    const resolveImport = importResolver(
      [root, ...project.rootDirs],
      project.paths,
    );
    /** A TS source's `.svelte` imports, by line and column. */
    const svelteImportsOf = (content: string, component: boolean) => {
      if (!content.includes(".svelte")) return [];
      const lexed = component ? lexComponent(content) : undefined;
      const ranges = lexed
        ? [lexed.module, lexed.instance].flatMap((script) =>
            script ? [[script.content.start, script.content.end] as const] : [],
          )
        : [[0, content.length] as const];
      const locate = createLocator(content);
      return ranges.flatMap(([start, end]) =>
        lexImportsExports(content.slice(start, end)).flatMap((statement) => {
          const specifier = statement.source?.value;
          if (!specifier?.endsWith(".svelte")) return [];
          const at = locate.position(start + (statement.source?.start ?? 0));
          return [[specifier, at.line, at.column] as const];
        }),
      );
    };
    const tsSources = [
      ...files.filter((_, i) => TS_SCRIPT.test(texts[i] ?? "")),
      ...listedFiles.filter((path) => TS_MODULE.test(path)),
    ];
    for (const path of tsSources)
      for (const [specifier, line, column] of fileFacts.of(
        path,
        "svelteImports",
        (content) => svelteImportsOf(content, path.endsWith(".svelte")),
      )) {
        const target = resolveImport(path, specifier);
        if (!target || !untyped.has(target)) continue;
        diagnostics.push({
          file: path,
          line,
          column,
          severity: "error",
          source: "ts",
          code: "TS7016",
          message: `Could not find a declaration file for module '${specifier}'. '${asTypeScriptPath(target)}' implicitly has an 'any' type.`,
        });
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
  // In TypeScript's program order, as svelte-check lists them: a file's
  // imports before it; in a file, the compiler's before the checker's.
  // The generated code, read back from disk rather than generated again.
  const generatedOf = new Map(
    [...outputs].map(([genPath, gen]) => [gen.svelte, genPath]),
  );
  // Every file TypeScript lists, in its order, not only those with errors:
  // an error-free `index.ts` that imports components puts them in its
  // import order. A reported file outside them comes last.
  const listed = listedFiles;
  const listedSet = new Set(listed);
  const imports = new Map<string, Set<string>>();
  const order = programOrder(
    [
      ...listed,
      ...[...new Set(reported.map((d) => d.file))]
        .filter((file) => !listedSet.has(file))
        .sort(byFolder),
    ],
    // Generated code, whose imports include SvelteKit's `./$types`.
    (file) =>
      fileFacts.of(generatedOf.get(file) ?? file, "specifiers", (code) =>
        [...code.matchAll(STATIC_IMPORT), ...code.matchAll(DYNAMIC_IMPORT)].map(
          (m) => m[1] ?? "",
        ),
      ),
    importResolver([root, ...project.rootDirs], project.paths),
    imports,
  );
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
    checkerVersion: command.version,
    timings: {
      emit: emitted - started,
      check: checked - emitted,
      compile: compiledAt - emitted,
    },
  };
  const inputs = [...order.keys()].filter((path) => !under(path, outDir));
  if (incremental) await fileFacts.save();
  if (incremental)
    await writeFile(
      resultPath,
      JSON.stringify({
        key: runKey,
        inputs,
        inputsKey: hash(JSON.stringify(statsOf(inputs))),
        result,
      } satisfies ResultCache),
    );
  return result;
}

const FACTS_CACHE = "files.json";
interface Facts {
  /** Its size and modification time. */
  stat: string;
  /** Its imports' specifiers, in TypeScript's order. */
  specifiers?: string[];
  /** Its `.svelte` imports, by line and column. */
  svelteImports?: (readonly [string, number, number])[];
}

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
  return {
    of<K extends "specifiers" | "svelteImports">(
      file: string,
      kind: K,
      compute: (text: string) => NonNullable<Facts[K]>,
    ): NonNullable<Facts[K]> {
      const stat = statsOf([file])[0] ?? "";
      let facts = used[file] ?? entries[file];
      if (facts?.stat !== stat) facts = { stat };
      used[file] = facts;
      facts[kind] ??= compute(readFileSync(file, "utf-8"));
      return facts[kind] as NonNullable<Facts[K]>;
    },
    save: () =>
      writeFile(path, JSON.stringify({ format: CACHE_FORMAT, entries: used })),
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
