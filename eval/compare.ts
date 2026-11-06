// Runs svelte-check and svelte-typecheck on a project with the same
// options, and compares their machine output. svelte-check is the
// project's own when it has one: another install loads a second copy of
// Svelte's types, which reports false errors.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TIMESTAMP = /^\d+ /;

/** The project's svelte-check, from its folder up, or eval's. */
export function svelteCheckOf(project: string): string {
  for (let dir = project; ; dir = dirname(dir)) {
    const bin = join(dir, "node_modules/svelte-check/bin/svelte-check");
    if (existsSync(bin)) return bin;
    if (dirname(dir) === dir) break;
  }
  return join(
    import.meta.dirname,
    "node_modules/svelte-check/bin/svelte-check",
  );
}

/** Machine output without timestamps, and the file count, which differs by design. */
function lines(command: string[], cwd: string): string[] {
  const run = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    encoding: "utf-8",
    maxBuffer: 1 << 28,
  });
  return run.stdout
    .split("\n")
    .filter((line) => TIMESTAMP.test(line))
    .map((line) =>
      line.replace(TIMESTAMP, "").replace(/^COMPLETED \d+ FILES/, "COMPLETED"),
    );
}

export interface Comparison {
  /** svelte-check's lines, then svelte-typecheck's. */
  expected: string[];
  actual: string[];
}

export function compare(projectPath: string, args: string[]): Comparison {
  const project = resolve(projectPath);
  return {
    expected: lines(
      ["node", svelteCheckOf(project), "--output", "machine", ...args],
      project,
    ),
    actual: lines(
      [
        process.execPath,
        join(ROOT, "src/cli.ts"),
        "--output",
        "machine",
        ...args,
      ],
      project,
    ),
  };
}

/** The lines only one tool printed, each as often as it printed it more. */
export function onlyIn({ expected, actual }: Comparison): {
  svelteCheck: string[];
  svelteTypecheck: string[];
} {
  const count = new Map<string, number>();
  for (const line of expected) count.set(line, (count.get(line) ?? 0) + 1);
  const svelteTypecheck: string[] = [];
  for (const line of actual) {
    const left = count.get(line) ?? 0;
    if (left > 0) count.set(line, left - 1);
    else svelteTypecheck.push(line);
  }
  const svelteCheck = [...count].flatMap(([line, n]) =>
    Array.from({ length: n }, () => line),
  );
  return { svelteCheck, svelteTypecheck };
}

/** The `'…'` quoted types in a machine-output line, and the text around them. */
function quoted(line: string): { types: string[]; text: string } {
  const types: string[] = [];
  const text = line.replace(/'((?:[^'\\]|\\.)*)'/g, (_, type: string) => {
    types.push(type);
    return "''";
  });
  return { types, text };
}

/** A union's members, without the parentheses one can print with: `(string & {})`. */
const memberList = (type: string) =>
  type.split(" | ").map((m) => m.replace(/^\((.*)\)$/, "$1"));
const members = (type: string) => memberList(type).sort().join(" | ");

/**
 * Whether two lines say the same at the same place but for the order of
 * a union's members, which TypeScript prints in the order it first met
 * them (docs/svelte-check.md): `'"a" | "b"'` and `'"b" | "a"'`, and an
 * elaboration on the union's first member, which then differs too.
 */
export function onlyUnionOrder(a: string, b: string): boolean {
  if (a === b) return false;
  // The same error, elaborated on another member of a union whose name is
  // all the line prints (`type 'BreakpointSize'`): only after the first line.
  const [headA = "", ...restA] = a.split("\\n");
  const [headB = "", ...restB] = b.split("\\n");
  if (
    headA === headB &&
    restA.length > 0 &&
    quoted(restA.join("\\n")).text === quoted(restB.join("\\n")).text
  )
    return true;
  const x = quoted(a);
  const y = quoted(b);
  if (x.text !== y.text || x.types.length !== y.types.length) return false;
  const unions = x.types.filter((t) => t.includes(" | "));
  if (unions.length === 0) return false;
  return x.types.every((t, i) => {
    const u = y.types[i] ?? "";
    if (t === u || members(t) === members(u)) return true;
    // One member of a union in the same line, each tool its first.
    return unions.some((union) => {
      const set = memberList(union);
      return set.includes(t) && set.includes(u);
    });
  });
}
