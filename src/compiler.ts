import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { CompilerDiagnostic } from "./types.ts";

interface Warning {
  code: string;
  message: string;
  start?: { line: number; column: number };
}
interface Compiler {
  compile(
    source: string,
    options: { filename: string; generate: false },
  ): { warnings: Warning[] };
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
  try {
    const { warnings } = compiler.compile(source, {
      filename,
      generate: false,
    });
    return warnings.map((w) => ({
      severity: "warning",
      code: w.code,
      message: w.message,
      line: w.start?.line ?? 1,
      column: (w.start?.column ?? 0) + 1,
    }));
  } catch (error) {
    const e = error as Warning;
    return [
      {
        severity: "error",
        code: e.code ?? "compile_error",
        message: e.message,
        line: e.start?.line ?? 1,
        column: (e.start?.column ?? 0) + 1,
      },
    ];
  }
}
