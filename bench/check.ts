// One end-to-end run on the bench corpus, for ostia's command workloads:
// `bun bench/check.ts <mode> <checker>`, where mode is
//
// - cold: nothing kept from the last run (`--no-incremental`);
// - changed: one component edited since the last run;
// - unchanged: nothing changed since the last run, so it's replayed;
// - compile: the compiler pass alone, cold;
// - vite: cold, on the corpus with a SvelteKit vite.config, from its folder.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { typecheck } from "../src/check.ts";
import type { Checker, TypecheckOptions } from "../src/types.ts";
import { corpus, viteCorpus } from "./corpus.ts";

const MODES = ["cold", "changed", "unchanged", "compile", "vite"] as const;
const [mode, checker] = process.argv.slice(2) as [
  (typeof MODES)[number],
  Checker,
];
if (!MODES.includes(mode))
  throw new Error(`mode is one of ${MODES.join(", ")}`);

const outDir = resolve(
  `node_modules/.cache/svelte-typecheck/bench-${mode}-${checker}`,
);
// Run from a project's folder, as its vite.config is loaded.
const workspace = mode === "vite" ? await viteCorpus() : await corpus();
if (mode === "vite") process.chdir(workspace);
if (mode === "changed") {
  // A new comment in one component, each run.
  const page = join(workspace, "Page0.svelte");
  const source = (await readFile(page, "utf-8")).replace(/<!-- \d+ -->\n$/, "");
  await writeFile(page, `${source}<!-- ${Date.now()} -->\n`);
}
const options: TypecheckOptions = {
  workspace,
  checker,
  outDir,
  incremental: mode === "changed" || mode === "unchanged",
  diagnosticSources: mode === "compile" ? ["svelte"] : undefined,
};
const result = await typecheck(options);
if (result.diagnostics.length > 0 || result.failed.length > 0)
  throw new Error(
    `bench corpus has errors: ${JSON.stringify(result.diagnostics[0] ?? result.failed[0])}`,
  );
