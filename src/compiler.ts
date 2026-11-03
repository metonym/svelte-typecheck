import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { originalPosition } from "./sourcemap.ts";
import type { CompilerDiagnostic } from "./types.ts";

interface Warning {
  code: string;
  message: string;
  start?: { line: number; column: number };
  end?: { line: number; column: number };
}
/** A `preprocess` entry from svelte.config.js. */
type Preprocessor = Record<string, unknown>;
interface Compiler {
  compile(
    source: string,
    options: { filename: string; generate: false },
  ): { warnings: Warning[] };
  preprocess(
    source: string,
    preprocessors: Preprocessor | Preprocessor[],
    options: { filename: string },
  ): Promise<{ code: string; map?: string | { mappings: string } }>;
}

const CONFIG_FILES = [
  "svelte.config.js",
  "svelte.config.mjs",
  "svelte.config.cjs",
];

/**
 * The `preprocess` of the nearest svelte.config, from `dir` up, as
 * svelte-check finds it. A vite.config isn't read: that needs Vite.
 */
export async function preprocessorsOf(
  dir: string,
  explicit?: string,
): Promise<Preprocessor[] | undefined> {
  const path = explicit ?? configOf(dir);
  if (!path) return;
  const config = (await import(pathToFileURL(path).href)) as {
    default?: { preprocess?: Preprocessor | Preprocessor[] };
  };
  const preprocess = config.default?.preprocess;
  if (!preprocess) return;
  return Array.isArray(preprocess) ? preprocess : [preprocess];
}

function configOf(dir: string): string | undefined {
  for (let at = dir; ; at = dirname(at)) {
    for (const name of CONFIG_FILES) {
      const path = join(at, name);
      if (existsSync(path)) return path;
    }
    if (dirname(at) === at) return;
  }
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
): CompilerDiagnostic[] {
  try {
    const { warnings } = compiler.compile(source, {
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
export async function preprocessedDiagnostics(
  source: string,
  filename: string,
  svelteDir: string,
  preprocessors: Preprocessor[] | undefined,
): Promise<CompilerDiagnostic[]> {
  const compiler = compilerOf(svelteDir);
  if (!preprocessors) return diagnosticsOf(compiler, source, filename);
  const processed = await compiler.preprocess(source, preprocessors, {
    filename,
  });
  if (processed.code === source)
    return diagnosticsOf(compiler, source, filename);
  const map =
    typeof processed.map === "string"
      ? (JSON.parse(processed.map) as { mappings: string })
      : processed.map;
  const toOriginal = originalPosition(map);
  return diagnosticsOf(compiler, processed.code, filename).map((d) => {
    const start = toOriginal(d.line, d.column);
    const end = toOriginal(d.endLine ?? d.line, d.endColumn ?? d.column);
    return {
      ...d,
      ...start,
      endLine: end.line,
      endColumn: end.column,
    };
  });
}
