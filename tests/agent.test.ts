import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ENV } from "../src/main.ts";

const root = join(import.meta.dir, "..");
const dir = join(root, "tests/projects/svelte5/.tmp/agent");

const cli = (env: Record<string, string>, ...args: string[]) => {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const name of AGENT_ENV) delete base[name];
  return spawnSync(
    process.execPath,
    [join(root, "src/cli.ts"), "--no-incremental", ...args],
    { cwd: dir, encoding: "utf-8", env: { ...base, ...env } },
  ).stdout;
};

describe("agent output", () => {
  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(
      join(root, "tests/projects/svelte5/basic/tsconfig.json"),
      join(dir, "tsconfig.json"),
    );
    writeFileSync(
      join(dir, "Count.svelte"),
      '<script lang="ts">\n  let count: number = "one";\n</script>\n\n{count}\n',
    );
    writeFileSync(join(dir, "Clean.svelte"), "<p>Hi</p>\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("prints each problem with its source, then one line", () => {
    const expected = [
      '<error file="Count.svelte" line="2" column="7" code="TS2322">',
      "Type 'string' is not assignable to type 'number'.",
      "<source>",
      '1 | <script lang="ts">',
      '2 |   let count: number = "one";',
      "          ^^^^^",
      "3 | </script>",
      "</source>",
      "</error>",
      "Found 1 error in 1 file, checked 2 components",
      "",
    ].join("\n");
    expect(cli({}, "--output", "agent")).toBe(expected);
    // The default for a coding agent.
    for (const name of AGENT_ENV) expect(cli({ [name]: "1" })).toBe(expected);
    expect(cli({ AI_AGENT: "claude-code" })).toBe(expected);
    // Empty or 0 is unset, as `bun check` reads it.
    const unset: Record<string, string>[] = [
      {},
      { AGENT: "" },
      { CLAUDECODE: "0" },
    ];
    for (const env of unset)
      expect(cli(env)).toContain("Loading svelte-typecheck in workspace");
  }, 60_000);

  it("says so in one line when there's nothing to report", () => {
    rmSync(join(dir, "Count.svelte"));
    expect(cli({ AI_AGENT: "1" })).toBe("✓ No type errors in 1 component\n");
  }, 60_000);
});
