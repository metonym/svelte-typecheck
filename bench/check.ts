// One end-to-end run on the bench corpus, for ostia's command workloads:
// `bun bench/check.ts <mode> <checker>`, where mode is
//
// - cold: nothing kept from the last run (`--no-incremental`);
// - changed: one component edited since the last run;
// - unchanged: nothing changed since the last run, so it's replayed;
// - compile: the compiler pass alone, cold.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { typecheck } from "../src/check.ts";
import type { Checker, TypecheckOptions } from "../src/types.ts";
import { corpus } from "./corpus.ts";

const MODES = ["cold", "changed", "unchanged", "compile"] as const;
const [mode, checker] = process.argv.slice(2) as [
  (typeof MODES)[number],
  Checker,
];
if (!MODES.includes(mode))
  throw new Error(`mode is one of ${MODES.join(", ")}`);

const workspace = await corpus();
if (mode === "changed") {
  // A new comment in one component, each run.
  const page = join(workspace, "Page0.svelte");
  const source = (await readFile(page, "utf-8")).replace(/<!-- \d+ -->\n$/, "");
  await writeFile(page, `${source}<!-- ${Date.now()} -->\n`);
}
const options: TypecheckOptions = {
  workspace,
  checker,
  outDir: `node_modules/.cache/svelte-typecheck/bench-${mode}-${checker}`,
  incremental: mode === "changed" || mode === "unchanged",
  diagnosticSources: mode === "compile" ? ["svelte"] : undefined,
};
const result = await typecheck(options);
if (result.diagnostics.length > 0 || result.failed.length > 0)
  throw new Error(
    `bench corpus has errors: ${JSON.stringify(result.diagnostics[0] ?? result.failed[0])}`,
  );
