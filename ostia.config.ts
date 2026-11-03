import { defineConfig } from "ostia";

const inputs = ["src/**", "bench/**", "bun.lock"];

export default defineConfig({
  baseline: "main",
  samples: 10,
  warmup: 2,
  workloads: [
    { label: "emit", suites: ["bench/*.bench.ts"] },
    // A whole run on the corpus, with each checker.
    ...(["bun", "tsrs", "tsgo", "tsc"] as const).map((checker) => ({
      label: `check: ${checker}`,
      command: ["bun", "bench/check.ts", checker],
      inputs,
    })),
  ],
});
