// svelte-check and svelte-typecheck on the Svelte 5 basic project, with
// each option and output format.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cli, ours, svelte5, svelteCheck, svelteCheckBin } from "./parity.ts";

describe("svelte-check parity, machine output", () => {
  it.each([
    ["the nearest tsconfig", []],
    ["--no-tsconfig", ["--no-tsconfig"]],
    ["--threshold error", ["--threshold", "error"]],
    // With a tsconfig, svelte-check reports type errors even then; its
    // docs and --no-tsconfig don't.
    [
      "--diagnostic-sources svelte",
      ["--diagnostic-sources", "svelte", "--no-tsconfig"],
    ],
    ["--diagnostic-sources js", ["--diagnostic-sources", "js"]],
    [
      "--compiler-warnings",
      ["--compiler-warnings", "a11y_missing_attribute:error"],
    ],
  ])(
    "matches svelte-check with %s",
    (_, args) => {
      const cwd = join(svelte5, "basic");
      expect(ours(args, cwd)).toEqual(svelteCheck(args, cwd));
    },
    60_000,
  );
});

describe("svelte-check parity, other formats", () => {
  const cwd = join(svelte5, "basic");
  /** A run's output with the tool's name and timestamps as svelte-check's. */
  const output = (command: string[], format: string) =>
    spawnSync(
      command[0] ?? "",
      [...command.slice(1), "--output", format, "--no-color"],
      {
        cwd,
        encoding: "utf-8",
      },
    )
      .stdout.replaceAll("svelte-typecheck found", "svelte-check found")
      .replaceAll("Loading svelte-typecheck in", "Loading svelte-check in")
      .replaceAll(/^\d+ /gm, "")
      .replace(/COMPLETED \d+ FILES/, "COMPLETED");

  it.each(["human", "human-verbose", "machine-verbose"])(
    "matches svelte-check's %s output",
    (format) => {
      expect(output([process.execPath, cli], format)).toBe(
        output(svelteCheckBin(cwd), format),
      );
    },
    60_000,
  );
});
