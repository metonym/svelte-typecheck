// One run on a generated project, for ostia's scale workloads:
// `bun bench/scale.ts <shape> <components> <mode> <checker>`, where mode
// is cold (`--no-incremental`) or changed (one component edited since the
// last run). The project is written once, to bench/scale/, and again only
// when its options change.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { typecheck } from "../src/check.ts";
import type { Checker } from "../src/types.ts";
import { generate, type Shape } from "../tests/generate.ts";

const [shape, size, mode, checker] = process.argv.slice(2) as [
  Shape,
  string,
  "cold" | "changed",
  Checker,
];
const components = Number(size);
if (!(components > 0 && (mode === "cold" || mode === "changed")))
  throw new Error(
    "usage: bun bench/scale.ts <shape> <components> <cold|changed> <checker>",
  );

const workspace = join(import.meta.dirname, "scale", `${shape}-${components}`);
const marker = join(workspace, ".options");
const options = JSON.stringify({ shape, components });
if (!existsSync(marker) || (await readFile(marker, "utf-8")) !== options) {
  await generate(workspace, { components, shape });
  await writeFile(marker, options);
}
if (mode === "changed") {
  // A new comment in the first component, each run.
  const first = join(workspace, shape === "hub" ? "Hub.svelte" : "C0.svelte");
  const source = (await readFile(first, "utf-8")).replace(
    /<!-- \d+ -->\n$/,
    "",
  );
  await writeFile(first, `${source}<!-- ${Date.now()} -->\n`);
}
const result = await typecheck({
  // From bench/, whose package.json installs Svelte and the checkers.
  cwd: import.meta.dirname,
  workspace,
  checker,
  outDir: resolve(
    `node_modules/.cache/svelte-typecheck/bench-scale-${shape}-${components}-${mode}-${checker}`,
  ),
  incremental: mode === "changed",
});
if (result.diagnostics.length > 0 || result.failed.length > 0)
  throw new Error(
    `generated project has errors: ${JSON.stringify(result.diagnostics[0] ?? result.failed[0])}`,
  );
