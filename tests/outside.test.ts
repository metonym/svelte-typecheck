import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outsideOf, projectOf } from "../src/project.ts";

const root = join(import.meta.dir, "..");

/** A project whose tsconfig includes `src` and excludes `skip`, with components around it. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "svelte-typecheck-outside-"));
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "esnext",
        moduleResolution: "bundler",
        noEmit: true,
      },
      include: ["src"],
      exclude: ["skip"],
    }),
    "src/Ok.svelte": "<p>ok</p>\n",
    "e2e/Bad.svelte": '<script lang="ts">let n: number = "x";</script>\n',
    "dist/Built.svelte": "<p>built</p>\n",
    "skip/Skipped.svelte": "<p>skipped</p>\n",
    ".gitignore": "dist\nnode_modules\n",
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

const outside = (dir: string) =>
  outsideOf(projectOf({ workspace: dir }), dir).map((path) =>
    path.slice(dir.length + 1).replaceAll("\\", "/"),
  );

describe("outsideOf", () => {
  it("lists components the tsconfig leaves out, but not those it excludes or git ignores", () => {
    const dir = workspace();
    try {
      spawnSync("git", ["init", "-q"], { cwd: dir });
      expect(outside(dir)).toEqual(["e2e/Bad.svelte"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("walks the workspace outside a repository", () => {
    const dir = workspace();
    try {
      expect(outside(dir)).toEqual(["dist/Built.svelte", "e2e/Bad.svelte"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the CLI", () => {
  it("notes components outside the tsconfig in human output only", () => {
    const dir = workspace();
    try {
      spawnSync("git", ["init", "-q"], { cwd: dir });
      symlinkSync(
        join(root, "node_modules"),
        join(dir, "node_modules"),
        "junction",
      );
      const cli = (output: string) =>
        spawnSync(
          process.execPath,
          [
            join(root, "src/cli.ts"),
            "--output",
            output,
            "--no-color",
            // Not the default, which the linked node_modules would share.
            "--out-dir",
            ".svelte-typecheck",
          ],
          { cwd: dir, encoding: "utf-8" },
        );
      const human = cli("human");
      expect([human.status, human.stderr]).toEqual([0, ""]);
      expect(human.stdout).toContain(
        `1 component in the workspace isn't in tsconfig.json's "include" and wasn't checked: ${join("e2e", "Bad.svelte")}`,
      );
      const machine = cli("machine");
      expect(machine.stdout).not.toContain("include");
      expect(machine.stdout).toContain("COMPLETED 1 FILES 0 ERRORS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
