// Compares how much work two builds of svelte-typecheck hand the checker
// on a real project: the code each generates, then tsgo with one checker
// on it, whose counts of types, instantiations and symbols are the same
// on every run, where times move with the machine's load. For a change to
// the generated code, whose effect on the time can be smaller than that.
//
//   bun run build && cp -R dist /tmp/after
//   bun eval/work.ts /tmp/before /tmp/after <project>
//
// $AB_TSCONFIG names the tsconfig (default tsconfig.json).
import { spawnSync } from "node:child_process";
import { readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const [a, b, project] = process.argv.slice(2);
if (!(a && b && project))
  throw new Error(
    "usage: bun eval/work.ts <dist-before> <dist-after> <project>",
  );
const tsconfig = process.env.AB_TSCONFIG ?? "tsconfig.json";
const svelte = dirname(
  realpathSync(join(project, "node_modules/svelte/package.json")),
);
// TypeScript 7's tsc, which eval/package.json installs: tsgo.
const tsgo = join(
  import.meta.dirname,
  "node_modules/@typescript/native/bin/tsc",
);
const MEASURES = ["Types", "Instantiations", "Symbols", "Memory used"];

/** The generated components' size, in bytes. */
function generatedSize(dir: string): number {
  let size = 0;
  for (const name of readdirSync(dir, { recursive: true, encoding: "utf8" }))
    if (name.includes("++")) size += statSync(join(dir, name)).size;
  return size;
}

function measure(dist: string, outDir: string) {
  rmSync(outDir, { recursive: true, force: true });
  const run = spawnSync(
    "node",
    [
      join(dist, "cli.js"),
      ...["--output", "machine", "--no-incremental", "--checker", "tsgo"],
      ...["--workspace", project, "--tsconfig", tsconfig, "--out-dir", outDir],
      ...["--svelte", svelte],
    ],
    { cwd: project, encoding: "utf-8" },
  );
  const summary =
    /COMPLETED \d+ FILES (\d+ ERRORS \d+ WARNINGS)/.exec(run.stdout)?.[1] ??
    run.stdout.slice(-200);
  const counts = spawnSync(
    "node",
    [
      tsgo,
      ...["-p", join(outDir, "tsconfig.json"), "--pretty", "false"],
      ...["--incremental", "false", "--checkers", "1", "--extendedDiagnostics"],
    ],
    { encoding: "utf-8" },
  ).stdout;
  const values = Object.fromEntries(
    MEASURES.map((name) => [
      name,
      new RegExp(`^${name}:\\s+(\\S+)`, "m").exec(counts)?.[1] ?? "?",
    ]),
  );
  const size = generatedSize(join(outDir, "svelte"));
  rmSync(outDir, { recursive: true, force: true });
  return { summary, size, values };
}

const out = join(project, "node_modules/.cache/work");
const before = measure(a, join(out, "a"));
const after = measure(b, join(out, "b"));
const change = (x: number, y: number) =>
  `${y >= x ? "+" : ""}${(((y - x) / x) * 100).toFixed(1)}%`;
const number = (value: string) => Number(value.replace(/[^\d.]/g, ""));
console.log(`before: ${before.summary}\nafter:  ${after.summary}`);
console.log(
  `  generated code: ${before.size} → ${after.size} bytes (${change(before.size, after.size)})`,
);
for (const name of MEASURES) {
  const x = before.values[name] ?? "?";
  const y = after.values[name] ?? "?";
  console.log(`  ${name}: ${x} → ${y} (${change(number(x), number(y))})`);
}
