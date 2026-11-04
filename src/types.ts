/** A type checker that reads a tsconfig and prints errors as `tsc` does. */
export type Checker = "bun" | "tsrs" | "tsgo" | "tsc";

export interface TypecheckOptions {
  /** The project root the other paths resolve against. Default: `process.cwd()`. */
  cwd?: string;
  /** The project folder, relative to `cwd`. Default: `"."`. */
  workspace?: string;
  /**
   * The tsconfig or jsconfig, relative to the workspace. With one, the
   * components it includes are checked, and its TS and JS files' errors are
   * reported too. Default: the nearest from the workspace up. `false`: none,
   * so every component under the workspace, and only theirs.
   */
  tsconfig?: string | false;
  /**
   * With no tsconfig: paths to skip, relative to the workspace, as
   * svelte-check's `--ignore` (a prefix, or `**` at the start or end).
   */
  ignore?: string[];
  /** The svelte.config to read preprocessors from, relative to the workspace. Default: the nearest. */
  config?: string;
  /**
   * Default: the project's own TypeScript (`tsc`; native in TypeScript 7),
   * then the first of `tsgo`, `tsrs` and `bun` that's installed.
   */
  checker?: Checker;
  /** Globs of the components to check, relative to the workspace, instead of the tsconfig's. */
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
  /**
   * Keep the generated code between runs: rewrite only what changed, and
   * let `tsc`, tsgo and tsrs reuse their last run. Default `true`.
   */
  incremental?: boolean;
  /**
   * Report only these files' diagnostics, and those of the files that
   * import them, relative to `cwd`. The whole program is still checked.
   * `--changed` and `--since` pass git's changed files.
   */
  only?: string[];
}

/** A kind of check, as svelte-check's `--diagnostic-sources` names them. */
export type DiagnosticSource = "js" | "svelte" | "css";

/** An error or warning, at its line and column (both 1-based) in the source. */
export interface Diagnostic {
  /** An absolute path. */
  file: string;
  line: number;
  column: number;
  /** Where the range ends, when known. */
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning";
  /** `ts` or `js` for a type error (by the file's language), `svelte` for the compiler. */
  source: "ts" | "js" | "svelte";
  /** `TS2322`, or a compiler code such as `a11y_missing_attribute`. */
  code: string;
  message: string;
}

export interface TypecheckResult {
  diagnostics: Diagnostic[];
  /** The workspace, as an absolute path. */
  workspace: string;
  /** The tsconfig used, if any. */
  tsconfig?: string;
  /** How many components were checked. */
  components: number;
  /** Diagnostics left out by `only`. */
  skipped: number;
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
  endLine?: number;
  endColumn?: number;
}

/**
 * Diagnostics a project accepts for now, to report only new ones. Each is
 * known by its file, code, message and the text of its line, not the
 * line's number, so an edit above it doesn't make it new.
 */
export interface Baseline {
  version: 1;
  diagnostics: BaselineEntry[];
}

export interface BaselineEntry {
  /** Relative to the workspace, `/`-separated. */
  file: string;
  code: string;
  message: string;
  /** The text of the diagnostic's line, trimmed. */
  line: string;
  /** How many such diagnostics there are. */
  count: number;
}

/** What a baseline leaves of a run's diagnostics. */
export interface BaselineResult {
  /** The diagnostics the baseline doesn't have. */
  diagnostics: Diagnostic[];
  /** How many it has, and were left out. */
  known: number;
  /** How many it has that the run no longer reports. */
  fixed: number;
}
