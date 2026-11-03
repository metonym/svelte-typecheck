/** A type checker that reads a tsconfig and prints errors as `tsc` does. */
export type Checker = "bun" | "tsrs" | "tsgo" | "tsc";

export interface TypecheckOptions {
  /** The project root the other paths resolve against. Default: `process.cwd()`. */
  cwd?: string;
  /** The folder whose components to check. Default: `"."`. */
  workspace?: string;
  /** The tsconfig the generated one extends. Default: `<workspace>/tsconfig.json`. */
  tsconfig?: string;
  /** Default: the first of `bun`, `tsrs`, `tsgo` and `tsc` that's installed. */
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
}

/** A type error, at its line and column (both 1-based) in the source. */
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  /** `TS2322` and the like. */
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
  /** Milliseconds spent emitting and checking. */
  timings: { emit: number; check: number };
}

/** A warning or error the Svelte compiler reports for a component. */
export interface CompilerDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  line: number;
  column: number;
}
