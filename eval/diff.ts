// Runs svelte-check and svelte-typecheck on a project with the same
// options and diffs their machine output, line by line and in order.
// svelte-check is the project's own when it has one: another install
// loads a second copy of Svelte's types, which reports false errors.
//
//   bun eval/diff.ts <project> [options for both, e.g. --tsconfig x]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TIMESTAMP = /^\d+ /;
const [project, ...args] = process.argv.slice(2);
if (!project) throw new Error("usage: bun eval/diff.ts <project> [options]");

const own = join(project, "node_modules/svelte-check/bin/svelte-check");
const svelteCheck = existsSync(own)
  ? own
  : join(import.meta.dirname, "node_modules/svelte-check/bin/svelte-check");

/** Machine output without timestamps, and the file count, which differs by design. */
const lines = (command: string[]) =>
  spawnSync(command[0] ?? "", command.slice(1), {
    cwd: project,
    encoding: "utf-8",
  })
    .stdout.split("\n")
    .filter((line) => TIMESTAMP.test(line))
    .map((line) =>
      line.replace(TIMESTAMP, "").replace(/^COMPLETED \d+ FILES/, "COMPLETED"),
    );

const expected = lines(["node", svelteCheck, "--output", "machine", ...args]);
const actual = lines([
  process.execPath,
  join(ROOT, "src/cli.ts"),
  "--output",
  "machine",
  ...args,
]);
const differences: string[] = [];
for (let i = 0; i < Math.max(expected.length, actual.length); i++)
  if (expected[i] !== actual[i])
    differences.push(
      `line ${i + 1}\n  svelte-check:     ${expected[i] ?? "(none)"}\n  svelte-typecheck: ${actual[i] ?? "(none)"}`,
    );
console.log(expected.at(-1));
console.log(
  differences.length === 0
    ? "identical"
    : `${differences.length} lines differ:\n${differences.slice(0, 20).join("\n")}`,
);
process.exitCode = differences.length === 0 ? 0 : 1;
