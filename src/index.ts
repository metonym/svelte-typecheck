export { typecheck } from "./check.ts";
export { watch } from "./watch.ts";
export { compilerDiagnostics } from "./compiler.ts";
export { applyBaseline, createBaseline } from "./baseline.ts";
export type {
  Baseline,
  BaselineEntry,
  BaselineResult,
  Checker,
  CompilerDiagnostic,
  Diagnostic,
  DiagnosticSource,
  TypecheckOptions,
  TypecheckResult,
} from "./types.ts";
