import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkerArgs, checkerCommand, CHECKERS } from "./checker.ts";
import {
  preprocessedDiagnostics,
  preprocessorsOf,
  svelteDirOf,
} from "./compiler.ts";
import { emit } from "./emit.ts";
import { glob } from "./glob.ts";
import { isKitFile, isKitRouteFile, kitFile } from "./kit.ts";
import { createLocator, type Output } from "./output.ts";
import { projectOf, relativeTo, scriptsOf } from "./project.ts";
import type { Diagnostic, TypecheckOptions, TypecheckResult } from "./types.ts";

/** `path(line,col): error TSxxxx: message`, as tsc, tsgo, tsrs and `bun check` print. */
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const CONTINUATION = /^\s+\S/;
const LINE_BREAK = /\r?\n/;
const JS_FILE = /\.[cm]?jsx?$/;
/** Errors that stop a checker before it type-checks anything. */
const SYNTAX_CODE = /^TS[18]\d{3}$/;
const STOPPED = /Stopped before type checking/;
/** What an error's range covers past its start: an identifier, number or string. */
const TOKEN = /^(?:[\w$]+|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)/;

/** "No overload matches this call", or a wrong argument: to `__sveltets_2_store_get`. */
const STORE_ERROR = /^TS(2769|2345)$/;
/** Unused label, and an unused comma operand. */
const REACTIVE_NOISE = /^TS(7028|2695)$/;

const SHIMS = fileURLToPath(new URL("./shims/", import.meta.url));
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
    if (m)
      found.push({
        file: m[1] ?? "",
        line: Number(m[2]),
        column: Number(m[3]),
        code: m[4] ?? "",
        message: m[5] ?? "",
      });
    else if (continues && CONTINUATION.test(line)) {
      const last = found.at(-1);
      if (last) last.message += `\n${line}`;
    }
    // A blank line ends the errors: `bun check` follows them with a summary.
    continues = m !== null || (continues && line.trim() !== "");
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
  paths: string[],
  read: (path: string) => string,
  resolveImport: (from: string, specifier: string) => string | undefined,
): Map<string, number> {
  const roots = [...paths].sort((a, b) => {
    const pa = a.split(sep);
    const pb = b.split(sep);
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i] === pb[i]) continue;
      const aFile = i === pa.length - 1;
      const bFile = i === pb.length - 1;
      if (aFile !== bFile) return aFile ? -1 : 1;
      return (pa[i] ?? "") < (pb[i] ?? "") ? -1 : 1;
    }
    return pa.length - pb.length;
  });
  const order = new Map<string, number>();
  let next = 0;
  const visit = (path: string) => {
    if (order.has(path)) return;
    order.set(path, Number.POSITIVE_INFINITY);
    const text = read(path);
    for (const m of [
      ...text.matchAll(STATIC_IMPORT),
      ...text.matchAll(DYNAMIC_IMPORT),
    ]) {
      const target = resolveImport(path, m[1] ?? "");
      if (target) visit(target);
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
    CHECKERS.find((c) => checkerCommand(c, cwd) !== undefined);
  const command = checker && checkerCommand(checker, cwd);
  if (!(checker && command))
    throw new Error(
      `No type checker found: install \`typescript\` (or one of ${CHECKERS.slice(1).join(", ")}), or name one with \`checker\`.`,
    );

  const started = performance.now();
  const incremental = options.incremental ?? false;
  // An incremental run keeps the last run's code and rewrites what changed.
  const previous = incremental
    ? await readFile(join(outDir, MANIFEST), "utf-8")
        .then((text) => new Set(JSON.parse(text) as string[]))
        .catch(() => new Set<string>())
    : new Set<string>();
  if (!incremental) await rm(outDir, { recursive: true, force: true });
  const files = project.components;
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
  for (const [i, path] of files.entries()) {
    const genFrom = join(genDir, relative(root, dirname(path)));
    let result: ReturnType<typeof emit>;
    try {
      result = emit(texts[i] ?? "", {
        svelte: svelteMajor,
        basename: basename(path),
        // A relative import that leaves the root is relative to the
        // generated file's folder instead.
        rewriteImport(specifier) {
          if (!specifier.startsWith(".")) return;
          const target = resolve(dirname(path), specifier);
          if (target.startsWith(`${root}${sep}`)) return;
          return relativeTo(genFrom, target);
        },
      });
    } catch (error) {
      failed.push({ file: path, message: (error as Error).message });
      continue;
    }
    const name = path.slice(path.lastIndexOf(sep) + 1, -".svelte".length);
    const genPath = join(
      genFrom,
      `++${name}.svelte.${result.isTs ? "ts" : "js"}`,
    );
    outputs.set(genPath, {
      output: result.out,
      source: texts[i] ?? "",
      svelte: path,
      isTs: result.isTs,
      emitted: result,
    });
    write(genPath, result.out.code);
    if (declarations)
      write(
        join(genFrom, `${name}.d.svelte.ts`),
        `export { default } from "./++${name}.svelte.js";\nexport * from "./++${name}.svelte.js";\n`,
      );
  }

  // SvelteKit: its files get the types svelte-check gives them, in copies
  // that replace them, and the `./$types` they import, mirrored next to the
  // generated code, import those copies.
  const mirror = (path: string) => join(genDir, relative(root, path));
  const under = (path: string, dir: string) => path.startsWith(`${dir}${sep}`);
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
    for (const file of glob(dir, ["**/*.d.ts"]))
      write(mirror(join(dir, file)), readFileSync(join(dir, file), "utf-8"));
  }
  // An alias (`$lib/*`) finds a component's generated code before its source.
  const paths = Object.fromEntries(
    Object.entries(project.paths).map(([key, targets]) => [
      key,
      targets.flatMap((t) => (under(t, root) ? [mirror(t), t] : [t])),
    ]),
  );

  const tsconfig = join(outDir, "tsconfig.json");
  const rel = (path: string) => relativeTo(outDir, path);
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
        },
        // Listed rather than globbed: `include` skips dot folders and
        // `node_modules`, where the generated code lives by default.
        files: [
          join(SHIMS, "shims.d.ts"),
          svelteHtml,
          // Svelte 5's runes, as globals, as svelte2tsx references them.
          ...(svelteMajor >= 5 ? [join(svelteDir, "types/index.d.ts")] : []),
          ...outputs.keys(),
        ].map(rel),
        // The project's own TypeScript, which can import components.
        include: declarations ? project.include.map(rel) : [],
        exclude: [...project.exclude, ...replaced].map(rel),
      },
      null,
      2,
    ),
  );
  write(join(outDir, MANIFEST), JSON.stringify([...written].sort()));
  // Code for a component that's gone, which an import could still find.
  for (const path of previous)
    if (!written.has(path)) writes.push(rm(path, { force: true }));
  await Promise.all(writes);
  const emitted = performance.now();

  // The compiler pass runs while the checker's process works.
  const checking = sources.has("js")
    ? run(
        command.command,
        [
          ...command.prefix,
          ...checkerArgs(checker, tsconfig),
          ...(incremental && checker !== "bun"
            ? [
                "--incremental",
                "--tsBuildInfoFile",
                join(outDir, "tsbuildinfo"),
              ]
            : []),
        ],
        cwd,
        command.shell,
      ).then((output) => ({ output, at: performance.now() }))
    : Promise.resolve({ output: "", at: emitted });
  const compiled: Diagnostic[] = [];
  const preprocessors = sources.has("svelte")
    ? await preprocessorsOf(
        options.config
          ? dirname(resolve(workspace, options.config))
          : workspace,
        options.config ? resolve(workspace, options.config) : undefined,
      )
    : undefined;
  const perFile = sources.has("svelte")
    ? await Promise.all(
        files.map((path, i) =>
          preprocessedDiagnostics(
            texts[i] ?? "",
            relative(cwd, path),
            svelteDir,
            preprocessors,
          ),
        ),
      )
    : [];
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
  // type-checks anything, so it must fail the run, not pass it.
  const syntax = raw.filter(
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
  const seen = new Set<string>();
  for (const d of raw) {
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
      mapped = {
        ...d,
        file: gen.svelte,
        line: start.line,
        column: start.column,
        ...endOf(gen.source, source, gen.svelte),
        severity: "error",
        source: gen.isTs ? "ts" : "js",
      };
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
  diagnostics.push(...compiled);
  // svelte-check warns when a tsconfig includes no components.
  if (project.tsconfig && !options.components && files.length === 0)
    diagnostics.push({
      file: project.tsconfig,
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
      severity: "warning",
      source: "svelte",
      code: "100001",
      message: `No svelte input files were found in config file '${project.tsconfig}'. Did you forget to add svelte files to the 'include' in your ${basename(project.tsconfig)}? Specified 'include' paths were '${JSON.stringify(project.raw.include)}' and 'exclude' paths were '${JSON.stringify(project.raw.exclude)}'`,
    });
  const reported = errorsOnly
    ? diagnostics.filter((d) => d.severity === "error")
    : diagnostics;
  // In TypeScript's program order, as svelte-check lists them: a file's
  // imports before it; in a file, the compiler's before the checker's.
  const generatedOf = new Map(
    [...outputs.values()].map((gen) => [gen.svelte, gen.output.code]),
  );
  const order = programOrder(
    [...new Set(reported.map((d) => d.file))],
    // Generated code, whose imports include SvelteKit's `./$types`.
    (file) => generatedOf.get(file) ?? readFileSync(file, "utf-8"),
    importResolver([root, ...project.rootDirs], project.paths),
  );
  const sourceRank = (d: Diagnostic) => (d.source === "svelte" ? 0 : 1);
  reported.sort(
    (a, b) =>
      (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0) ||
      sourceRank(a) - sourceRank(b) ||
      a.line - b.line ||
      a.column - b.column,
  );

  return {
    diagnostics: reported,
    workspace,
    tsconfig: project.tsconfig,
    components: outputs.size,
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
}
