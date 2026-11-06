// One end-to-end run on the bench corpus, for ostia's command workloads:
// `bun bench/check.ts <mode> <checker>`, where mode is
//
// - cold: nothing kept from the last run (`--no-incremental`);
// - changed: one component edited since the last run;
// - unchanged: nothing changed since the last run, so it's replayed;
// - cli: unchanged, through the CLI with its human output, which reads
//   more than the API returns (the components outside the tsconfig);
// - compile: the compiler pass alone, cold;
// - vite: cold, on the corpus with a SvelteKit vite.config, from its folder;
// - vite-changed: there, one component edited since the last run.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { typecheck } from "../src/check.ts";
import { main } from "../src/main.ts";
import type { Checker, TypecheckOptions } from "../src/types.ts";
import { corpus, viteCorpus } from "./corpus.ts";

const MODES = [
  "cold",
  "changed",
  "unchanged",
  "cli",
  "compile",
  "vite",
  "vite-changed",
] as const;
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
const vite = mode.startsWith("vite");
const workspace = vite ? await viteCorpus() : await corpus();
if (vite) process.chdir(workspace);
if (mode.endsWith("changed")) {
  // A new comment in one component, each run.
  const page = join(workspace, "Page0.svelte");
  const source = (await readFile(page, "utf-8")).replace(/<!-- \d+ -->\n$/, "");
  await writeFile(page, `${source}<!-- ${Date.now()} -->\n`);
}
if (mode === "cli") {
  const code = await main([
    "--workspace",
    workspace,
    "--checker",
    checker,
    "--out-dir",
    outDir,
    "--output",
    "human",
  ]);
  if (code !== 0) throw new Error("bench corpus has errors");
  process.exit(0);
}
const options: TypecheckOptions = {
  workspace,
  checker,
  outDir,
  incremental: mode.endsWith("changed") || mode === "unchanged",
  diagnosticSources: mode === "compile" ? ["svelte"] : undefined,
};
const result = await typecheck(options);
if (result.diagnostics.length > 0 || result.failed.length > 0)
  throw new Error(
    `bench corpus has errors: ${JSON.stringify(result.diagnostics[0] ?? result.failed[0])}`,
  );
