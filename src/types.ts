/** A type checker that reads a tsconfig and prints errors as `tsc` does. */
export type Checker = "bun" | "tsrs" | "tsgo" | "tsc";

export interface TypecheckOptions {
  /** The project root the other paths resolve against. Default: `process.cwd()`. */
  cwd?: string;
  /** The folder whose components to check. Default: `"."`. */
  workspace?: string;
  /** The tsconfig the generated one extends. Default: `<workspace>/tsconfig.json`. */
  tsconfig?: string;
  /**
   * Default: the project's own TypeScript (`tsc`; native in TypeScript 7),
   * then the first of `tsgo`, `tsrs` and `bun` that's installed.
   */
  checker?: Checker;
  /** Globs of the components to check, relative to the workspace. Default: `["**\/*.svelte"]`. */
  components?: string[];
  /** Where to write the generated code. Default: `node_modules/.cache/svelte-typecheck/<workspace>`. */
  outDir?: string;
  /**
   * Whether an import of a checked component resolves to its generated
   * code (the default). With `false`, it resolves to the component's own
   * `.svelte.d.ts`, as a library's generated declarations are.
   */
  declarations?: boolean;
  /** The Svelte package to check against. Default: `svelte`, resolved from `cwd`. */
  svelte?: string;
  /**
   * What to report: `js` for type errors (in TS and JS), `svelte` for the
   * compiler's warnings and errors. `css` is accepted, as svelte-check
   * takes it, and reports nothing. Default: all.
   */
  diagnosticSources?: DiagnosticSource[];
  /** `error` reports errors only. Default: `warning`. */
  threshold?: "warning" | "error";
  /** Compiler warnings to drop (`ignore`) or report as errors, by code. */
  compilerWarnings?: Record<string, "ignore" | "error">;
}

/** A kind of check, as svelte-check's `--diagnostic-sources` names them. */
export type DiagnosticSource = "js" | "svelte" | "css";

/** An error or warning, at its line and column (both 1-based) in the source. */
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  /** `ts` or `js` for a type error (by the file's language), `svelte` for the compiler. */
  source: "ts" | "js" | "svelte";
  /** `TS2322`, or a compiler code such as `a11y_missing_attribute`. */
  code: string;
  message: string;
}

export interface TypecheckResult {
  diagnostics: Diagnostic[];
  /** How many components were checked. */
  components: number;
  /** Errors in generated code, which map to no source. */
  dropped: Diagnostic[];
  /** Components that failed to parse. */
  failed: { file: string; message: string }[];
  checker: Checker;
  /** The checker's version, when its package says. */
  checkerVersion?: string;
  /** Milliseconds spent emitting, type-checking and compiling. */
  timings: { emit: number; check: number; compile: number };
}

/** A warning or error the Svelte compiler reports for a component. */
export interface CompilerDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  line: number;
  column: number;
}
