// What the parity tests share: svelte-check and svelte-typecheck run from
// a folder, and their machine output compared.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const root = join(import.meta.dir, "..");
export const svelte5 = join(root, "tests/projects/svelte5");
/** svelte-typecheck's CLI, from source. */
export const cli = join(root, "src/cli.ts");

/**
 * A package's own bin on Node, the one the project at `cwd` installs, as
 * its scripts would run it: `node_modules/.bin` holds shell shims on Windows.
 */
export function binOf(cwd: string, pkg: string, file: string): string[] {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const path = join(dir, "node_modules", pkg, file);
    if (existsSync(path)) return ["node", path];
    if (dirname(dir) === dir) throw new Error(`no ${pkg} for ${cwd}`);
  }
}
export const svelteCheckBin = (cwd: string) =>
  binOf(cwd, "svelte-check", "bin/svelte-check");
const TIMESTAMP = /^\d+ /;

/** A CLI's machine output without timestamps or the file count. */
export function machine(command: string[], cwd: string): string[] {
  const { stdout } = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    encoding: "utf-8",
  });
  return stdout
    .split("\n")
    .filter((line) => TIMESTAMP.test(line))
    .map((line) =>
      line
        .replace(TIMESTAMP, "")
        // svelte-check counts every file in TypeScript's program.
        .replace(/^COMPLETED \d+ FILES/, "COMPLETED"),
    );
}

export const svelteCheck = (args: string[], cwd: string) =>
  machine([...svelteCheckBin(cwd), "--output", "machine", ...args], cwd);
export const ours = (args: string[], cwd: string) =>
  machine([process.execPath, cli, "--output", "machine", ...args], cwd);
