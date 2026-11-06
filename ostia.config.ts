import { defineConfig } from "ostia";

const inputs = ["src/**", "bench/**", "bun.lock"];
const CHECKERS = ["bun", "tsrs", "tsgo", "tsc"] as const;

/** A whole run on the corpus: `bun bench/check.ts <mode> <checker>`. */
const run = (mode: string, checker: string) => ({
  label: `${mode}: ${checker}`,
  command: ["bun", "bench/check.ts", mode, checker],
  inputs,
});

/** A run on a generated project: `bun bench/scale.ts <shape> <n> <mode> <checker>`. */
const scale = (shape: string, components: number, mode: string) => ({
  label: `scale ${shape} ${components}, ${mode}: tsrs`,
  command: ["bun", "bench/scale.ts", shape, String(components), mode, "tsrs"],
  inputs: [...inputs, "tests/generate.ts"],
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
    // With the config loaded through Vite, as for a SvelteKit project.
    run("vite", "tsrs"),
    run("vite-changed", "tsrs"),
    // 8,000 components, the most connected shapes: an index.ts that
    // re-exports them all, and one component they all import.
    scale("barrel", 8000, "cold"),
    scale("hub", 8000, "changed"),
  ],
});
