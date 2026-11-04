import { defineConfig } from "ostia";

const inputs = ["src/**", "bench/**", "bun.lock"];
const CHECKERS = ["bun", "tsrs", "tsgo", "tsc"] as const;

/** A whole run on the corpus: `bun bench/check.ts <mode> <checker>`. */
const run = (mode: string, checker: string) => ({
  label: `${mode}: ${checker}`,
  command: ["bun", "bench/check.ts", mode, checker],
  inputs,
});

export default defineConfig({
  baseline: "main",
  samples: 10,
  warmup: 2,
  workloads: [
    // In process: parsing, scopes and generating TypeScript.
    { label: "emit", suites: ["bench/*.bench.ts"] },
    // Each checker from nothing, and after one component changed.
    ...CHECKERS.map((checker) => run("cold", checker)),
    ...CHECKERS.map((checker) => run("changed", checker)),
    // Nothing changed: the last result, whichever the checker.
    run("unchanged", "tsrs"),
    // The Svelte compiler's pass alone.
    run("compile", "tsrs"),
  ],
});
