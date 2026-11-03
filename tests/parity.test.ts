import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const TIMESTAMP = /^\d+ /;

/** A CLI's machine output without timestamps or the file count. */
function machine(command: string[], cwd: string): string[] {
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

const svelteCheck = (args: string[], cwd: string) =>
  machine(
    [
      join(root, "node_modules/.bin/svelte-check"),
      "--output",
      "machine",
      ...args,
    ],
    cwd,
  );
const ours = (args: string[], cwd: string) =>
  machine(
    [
      process.execPath,
      join(root, "src/cli.ts"),
      "--output",
      "machine",
      ...args,
    ],
    cwd,
  );

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
      const cwd = join(root, "tests/fixtures");
      expect(ours(args, cwd)).toEqual(svelteCheck(args, cwd));
    },
    60_000,
  );

  it("matches svelte-check with $$Props, $$Events, $$Slots, strictEvents and animate:", () => {
    const cwd = join(root, "tests/fixtures-typed");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check with generic components", () => {
    const cwd = join(root, "tests/fixtures-generic");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check with runes, snippets, attachments and function bindings", () => {
    const cwd = join(root, "tests/fixtures-runes");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check in a SvelteKit project", () => {
    const cwd = join(root, "tests/fixtures-kit");
    // SvelteKit writes `./$types` and the tsconfig the project extends.
    spawnSync(join(root, "node_modules/.bin/svelte-kit"), ["sync"], { cwd });
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check's message rewrites and filters", () => {
    const cwd = join(root, "tests/fixtures-filters");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("warns, as svelte-check does, of a tsconfig with no components", () => {
    const cwd = join(root, "tests/.tmp/no-components");
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src/**/*.ts"],
      }),
    );
    writeFileSync(join(cwd, "src/a.ts"), "export const a = 1;\n");
    const warning = (lines: string[]) =>
      lines.filter((line) => line.includes("No svelte input files"));
    // svelte-check also reports its own default options' deprecation here.
    expect(warning(ours([], cwd))).toEqual(warning(svelteCheck([], cwd)));
    expect(warning(ours([], cwd))).toHaveLength(1);
  }, 60_000);

  it("matches svelte-check with preprocessors", () => {
    const cwd = join(root, "tests/fixtures-preprocess");
    // svelte-check's css source (not supported) flags the custom style.
    const args = ["--diagnostic-sources", "js,svelte"];
    expect(ours(args, cwd)).toEqual(svelteCheck(args, cwd));
  }, 60_000);
});

describe("svelte-check parity, other formats", () => {
  const cwd = join(root, "tests/fixtures");
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
      expect(output([process.execPath, join(root, "src/cli.ts")], format)).toBe(
        output([join(root, "node_modules/.bin/svelte-check")], format),
      );
    },
    60_000,
  );
});
