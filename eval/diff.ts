// Runs svelte-check and svelte-typecheck on a project with the same
// options and diffs their machine output, line by line and in order.
//
//   bun eval/diff.ts <project> [options for both, e.g. --tsconfig x]
import { compare } from "./compare.ts";

const [project, ...args] = process.argv.slice(2);
if (!project) throw new Error("usage: bun eval/diff.ts <project> [options]");

const { expected, actual } = compare(project, args);
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
