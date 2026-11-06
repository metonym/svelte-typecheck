import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { lexComponent } from "sveast/lexer";
import {
  configNeedsChdir,
  type Preprocessor,
  type SvelteConfig,
  svelteConfigOf,
} from "./config.ts";
import { createLocator } from "./output.ts";
import { originalPosition } from "./sourcemap.ts";
import type { CompilerDiagnostic } from "./types.ts";

interface Warning {
  code: string;
  message: string;
  start?: { line: number; column: number };
  end?: { line: number; column: number };
}
interface Compiler {
  compile(
    source: string,
    options: { filename: string; generate: false; dev?: boolean },
  ): { warnings: Warning[] };
  preprocess(
    source: string,
    preprocessors: Preprocessor | Preprocessor[],
    options: { filename: string },
  ): Promise<{ code: string; map?: string | { mappings: string } }>;
}

/** The Svelte package a project checks against: `svelte`, from `cwd`. */
export function svelteDirOf(cwd: string, svelte?: string): string {
  return svelte
    ? resolve(cwd, svelte)
    : dirname(
        createRequire(join(cwd, "package.json")).resolve("svelte/package.json"),
      );
}

const compilers = new Map<string, Compiler>();

/**
 * That Svelte's compiler, through `require`, which every version from 3
 * up exports, so a project's own version reports its own warnings.
 */
function compilerOf(svelteDir: string): Compiler {
  let compiler = compilers.get(svelteDir);
  if (!compiler) {
    compiler = createRequire(join(svelteDir, "package.json"))(
      "svelte/compiler",
    ) as Compiler;
    compilers.set(svelteDir, compiler);
  }
  return compiler;
}

function diagnosticsOf(
  compiler: Compiler,
  source: string,
  filename: string,
  compilerOptions: Record<string, unknown> = {},
): CompilerDiagnostic[] {
  try {
    const { warnings } = compiler.compile(source, {
      ...compilerOptions,
      filename,
      generate: false,
    });
    return warnings.map((w) => ({
      severity: "warning",
      code: w.code,
      message: w.message,
      ...positionsOf(w),
    }));
  } catch (error) {
    const e = error as Warning;
    return [
      {
        severity: "error",
        code: e.code ?? "compile_error",
        message: e.message,
        ...positionsOf(e),
      },
    ];
  }
}

/** Svelte's 1-based line and 0-based column, as 1-based both. */
function positionsOf(w: Warning) {
  const line = w.start?.line ?? 1;
  const column = (w.start?.column ?? 0) + 1;
  return {
    line,
    column,
    endLine: w.end?.line ?? line,
    endColumn: w.end ? w.end.column + 1 : column,
  };
}

/**
 * What `svelte/compiler` reports for a component (a11y, unused CSS, invalid
 * markup), without generating code. `<!-- svelte-ignore -->` applies, as in
 * a build. A compile error comes back as one `error`.
 */
export function compilerDiagnostics(
  source: string,
  filename: string,
  options: { cwd?: string; svelte?: string } = {},
): CompilerDiagnostic[] {
  const compiler = compilerOf(
    svelteDirOf(resolve(options.cwd ?? process.cwd()), options.svelte),
  );
  return diagnosticsOf(compiler, source, filename);
}

/**
 * `compilerDiagnostics` after svelte.config's preprocessors, with each
 * position mapped back to the source, as svelte-check does.
 */
async function preprocessedDiagnostics(
  source: string,
  filename: string,
  svelteDir: string,
  config: SvelteConfig,
  /** Whether the config has preprocessors, when they're left out of `config`. */
  preprocessed = Boolean(config.preprocess),
): Promise<CompilerDiagnostic[]> {
  const compiler = compilerOf(svelteDir);
  const { preprocess, compilerOptions } = config;
  let diagnostics: CompilerDiagnostic[];
  const processed = preprocess
    ? await compiler.preprocess(source, preprocess, { filename })
    : undefined;
  if (!processed || processed.code === source)
    diagnostics = diagnosticsOf(compiler, source, filename, compilerOptions);
  else {
    const map =
      typeof processed.map === "string"
        ? (JSON.parse(processed.map) as { mappings: string })
        : processed.map;
    const toOriginal = originalPosition(map);
    diagnostics = diagnosticsOf(
      compiler,
      processed.code,
      filename,
      compilerOptions,
    ).map((d) => {
      const start = toOriginal(d.line, d.column);
      const end = toOriginal(d.endLine ?? d.line, d.endColumn ?? d.column);
      return { ...d, ...start, endLine: end.line, endColumn: end.column };
    });
  }
  return asSvelteCheck(diagnostics, source, preprocessed);
}

/**
 * What a later run needs to know of a config to compile a component
 * without loading it: its preprocessors, by name and the tags they read,
 * and its compiler options.
 */
export interface ConfigShape {
  preprocess: { name: string; hooks: Hook[] }[];
  preprocessed: boolean;
  compilerOptions: Record<string, unknown>;
}
type Hook = "markup" | "script" | "style";
const HOOKS: Hook[] = ["markup", "script", "style"];
/** Preprocessors that never change code: SvelteKit's only warns. */
const UNCHANGING = new Set(["sveltekit:warnings"]);
/** The tags Svelte's `preprocess` hands each hook, anywhere in the markup. */
const TAG: Record<Exclude<Hook, "markup">, RegExp> = {
  script: /<script[\s/>]/i,
  style: /<style[\s/>]/i,
};

/** Only JSON: a function (`warningFilter`, `cssHash`) can't be kept. */
function isJson(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value))
    return true;
  if (Array.isArray(value)) return value.every(isJson);
  return (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value as object).every((v) => v === undefined || isJson(v))
  );
}

/** Each preprocessor's name and the hooks it has. */
function readersOf(preprocess: Preprocessor[] = []): ConfigShape["preprocess"] {
  return preprocess.map((p) => ({
    name: typeof p.name === "string" ? p.name : "",
    hooks: HOOKS.filter((hook) => typeof p[hook] === "function"),
  }));
}

function shapeOf(config: SvelteConfig): ConfigShape | undefined {
  if (!isJson(config.compilerOptions)) return;
  return {
    preprocess: readersOf(config.preprocess),
    preprocessed: Boolean(config.preprocess),
    compilerOptions: config.compilerOptions,
  };
}

/** Whether no preprocessor that can change code reads any of `source`. */
function untouched(
  source: string,
  readers: ConfigShape["preprocess"],
): boolean {
  return readers.every(
    (p) =>
      UNCHANGING.has(p.name) ||
      p.hooks.every((hook) => hook !== "markup" && !TAG[hook].test(source)),
  );
}

/** Components to compile, with what finds their compiler and config. */
export interface CompileRequest {
  svelteDir: string;
  configDir: string;
  configFile?: string;
  /** The config's shape, as the last run that loaded it found it. */
  shape?: ConfigShape;
  components: { source: string; filename: string }[];
}

export interface CompileResult {
  results: CompilerDiagnostic[][];
  /** The shape of the config this run loaded, or used without loading. */
  shape?: ConfigShape;
}

/**
 * `preprocessedDiagnostics` for each component, with the config loaded
 * once; not at all when, by its shape, no preprocessor that can change
 * code reads any of them, as a Vite config can take half a second.
 */
export async function compileAll(
  request: CompileRequest,
): Promise<CompileResult> {
  const { shape, svelteDir } = request;
  if (
    shape &&
    request.components.every((c) => untouched(c.source, shape.preprocess))
  ) {
    return {
      shape,
      results: await Promise.all(
        request.components.map(({ source, filename }) =>
          preprocessedDiagnostics(
            source,
            filename,
            svelteDir,
            { compilerOptions: shape.compilerOptions },
            shape.preprocessed,
          ),
        ),
      ),
    };
  }
  const config = await svelteConfigOf(request.configDir, request.configFile);
  // A component no preprocessor can change compiles as it is: Svelte's
  // `preprocess` would hand none of it to a hook, and parse it for nothing.
  const readers = readersOf(config.preprocess);
  const unprocessed = { compilerOptions: config.compilerOptions };
  return {
    shape: shapeOf(config),
    results: await Promise.all(
      request.components.map(({ source, filename }) =>
        untouched(source, readers)
          ? preprocessedDiagnostics(
              source,
              filename,
              svelteDir,
              unprocessed,
              Boolean(config.preprocess),
            )
          : preprocessedDiagnostics(source, filename, svelteDir, config),
      ),
    ),
  };
}

interface Pending {
  done: (result: never) => void;
  fail: (error: Error) => void;
  /** The job, run on this thread, when the worker can't run it. */
  here: () => Promise<unknown>;
}

/**
 * One worker for the process, kept for the next run (`--watch`'s) with its
 * compiler and config loaded; unreferenced while idle, so it never keeps
 * the process alive.
 */
let worker: Worker | undefined;
const pending = new Map<number, Pending>();
/** Jobs that keep the worker referenced: those a run waits for. */
const waitedFor = new Set<number>();
let nextId = 0;

function startWorker(): Worker {
  // Beside this module, in the source and in the bundle.
  const file = import.meta.url.endsWith(".ts")
    ? "compile-worker.ts"
    : "compile-worker.js";
  const started = new Worker(new URL(file, import.meta.url));
  started.unref();
  started.on(
    "message",
    (reply: { id: number; result?: unknown; error?: string }) => {
      const job = pending.get(reply.id);
      if (!job) return;
      pending.delete(reply.id);
      waitedFor.delete(reply.id);
      if (waitedFor.size === 0) started.unref();
      if (reply.error === undefined) job.done(reply.result as never);
      else job.fail(new Error(reply.error));
    },
  );
  // A worker that can't start, or dies: what it had runs here instead.
  const fallBack = () => {
    if (worker !== started) return;
    worker = undefined;
    const jobs = [...pending.values()];
    pending.clear();
    waitedFor.clear();
    for (const job of jobs) job.here().then(job.done as never, job.fail);
  };
  started.on("error", fallBack);
  started.on("exit", fallBack);
  return started;
}

/** Posts a job to the worker, which it keeps alive for once `wait` runs. */
function post<T>(message: object, here: () => Promise<T>) {
  const running = (worker ??= startWorker());
  const id = nextId++;
  const result = new Promise<T>((done, fail) => {
    pending.set(id, { done: done as never, fail, here });
    running.postMessage({ id, ...message });
  });
  // Unhandled until waited for: a rejection is the run's then.
  result.catch(() => {});
  return {
    result,
    wait(): Promise<T> {
      if (pending.has(id)) {
        waitedFor.add(id);
        worker?.ref();
      }
      return result;
    },
  };
}

/**
 * `compileAll` on a worker thread, so the compiler's pass runs while this
 * one generates code and the checker checks it; `undefined` when loading
 * the config needs `process.chdir`, which a worker can't do, or there's
 * no worker.
 */
export function compileOffThread(
  request: CompileRequest,
): Promise<CompileResult> | undefined {
  if (configNeedsChdir(request.configDir, request.configFile)) return;
  try {
    return post({ request }, () => compileAll(request)).wait();
  } catch {
    return;
  }
}

/** What finds a project's compiler and config, and the files to compile. */
export interface CompileFilesRequest extends Omit<
  CompileRequest,
  "components" | "shape"
> {
  files: { path: string; filename: string }[];
}

export interface CompileFilesResult extends CompileResult {
  /** `compileKey` of each file, as it was read and compiled. */
  keys: string[];
}

/** What a compile's result is kept by: the component's name and text. */
export const compileKey = (filename: string, source: string) =>
  createHash("sha1").update(`${filename}\0${source}`).digest("hex");

/** `compileAll` on files this reads. */
export async function compileFiles(
  request: CompileFilesRequest,
): Promise<CompileFilesResult> {
  const { files, ...source } = request;
  const components = await Promise.all(
    files.map(async ({ path, filename }) => ({
      source: await readFile(path, "utf-8"),
      filename,
    })),
  );
  return {
    ...(await compileAll({ ...source, components })),
    keys: components.map((c) => compileKey(c.filename, c.source)),
  };
}

/**
 * `compileFiles` on the worker, for a run that compiles every component:
 * it starts as soon as the components are found, while this thread reads
 * them, generates code and starts the checker. The worker is referenced
 * for it only once the run waits for it, so a run that ends first doesn't
 * wait. `undefined` as for `compileOffThread`.
 */
export function compileFilesOffThread(request: CompileFilesRequest):
  | {
      wait: () => Promise<CompileFilesResult>;
      /** When it started, for the run's timings. */
      at: number;
    }
  | undefined {
  if (configNeedsChdir(request.configDir, request.configFile)) return;
  const at = performance.now();
  try {
    return { ...post({ files: request }, () => compileFiles(request)), at };
  } catch {
    return;
  }
}

/**
 * `early`, a compile of every component as the worker read them, with each
 * one edited since compiled again as the run read it: those whose key, as
 * the run read them (`keys`), isn't the worker's. Both are by component.
 */
export async function withEdits(
  early: CompileFilesResult,
  keys: string[],
  compileAgain: (edited: number[]) => Promise<CompilerDiagnostic[][]>,
): Promise<CompileResult> {
  const edited = keys.flatMap((key, i) => (early.keys[i] === key ? [] : [i]));
  if (edited.length === 0) return early;
  const again = await compileAgain(edited);
  const results = [...early.results];
  for (const [n, i] of edited.entries()) results[i] = again[n] ?? [];
  return { ...early, results };
}

const TEXT_TYPE = /^text\//;
const EXPORTED_TYPE = (name: string) =>
  new RegExp(`\\bexport\\s+?(enum|namespace)\\s+?${name}\\b`);

/**
 * What svelte-check does with the compiler's diagnostics. Without
 * preprocessors, a `lang` it can't compile (`lang="scss"`, a non-TS
 * script) makes a parse error and that section's warnings false
 * positives; a parse error in a script or style gets a hint about
 * preprocessors.
 */
function asSvelteCheck(
  diagnostics: CompilerDiagnostic[],
  source: string,
  preprocessed: boolean,
): CompilerDiagnostic[] {
  const lexed = lexComponent(source);
  const script = lexed.instance ?? lexed.module;
  const langOf = (
    attributes: { name: string; value: string | true }[] = [],
  ) => {
    const lang =
      attributes.find((a) => a.name === "lang") ??
      attributes.find((a) => a.name === "type");
    return typeof lang?.value === "string"
      ? lang.value.replace(TEXT_TYPE, "")
      : "";
  };
  const scriptLang = langOf(script?.attributes);
  const styleLang = langOf(lexed.css?.attributes);
  const ignoreScript =
    !preprocessed && scriptLang !== "" && scriptLang !== "ts";
  const ignoreStyle = !preprocessed && styleLang !== "";
  const offsetOf = createLocator(source).offset;
  const inside = (
    d: CompilerDiagnostic,
    tag?: { content: { start: number; end: number } } | null,
  ) => {
    if (!tag) return false;
    const at = offsetOf(d.line, d.column);
    return tag.content.start <= at && at <= tag.content.end;
  };
  const kept: CompilerDiagnostic[] = [];
  for (const d of diagnostics) {
    if (d.severity === "error") {
      if (d.message.includes("expected")) {
        if (!preprocessed && (scriptLang || styleLang)) continue;
        const inScript = inside(d, script);
        if (inScript || inside(d, lexed.css))
          d.message +=
            "\n\nIf you expect this syntax to work, here are some suggestions: " +
            (inScript
              ? '\nIf you use typescript with `svelte-preprocess`, did you add `lang="ts"` to your `script` tag? '
              : '\nIf you use less/SCSS with `svelte-preprocess`, did you add `lang="scss"`/`lang="less"` to your `style` tag? If you use SCSS, it may be necessary to add the path to your NODE runtime to the setting `svelte.language-server.runtime`, or use `sass` instead of `node-sass`. ') +
            "\nDid you setup a `svelte.config.js` or `vite.config.js`? \nSee https://github.com/sveltejs/language-tools/tree/master/docs#using-with-preprocessors for more info.";
      }
      kept.push(d);
      continue;
    }
    if (ignoreScript && !d.code.startsWith("a11y")) continue;
    if (
      ignoreStyle &&
      (d.code === "css_unused_selector" || d.code === "css-unused-selector")
    )
      continue;
    if (d.code === "export_let_unused" || d.code === "unused-export-let") {
      const name = d.message.slice(
        d.message.indexOf("'") + 1,
        d.message.lastIndexOf("'"),
      );
      if (EXPORTED_TYPE(name).test(source)) continue;
    }
    kept.push(d);
  }
  return kept;
}
