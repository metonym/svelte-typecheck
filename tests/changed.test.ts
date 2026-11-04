import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { typecheck } from "../src/check.ts";
import { changedFiles } from "../src/git.ts";

const root = join(import.meta.dir, "..");

describe("only", () => {
  it("reports a file's diagnostics and its importers', not the rest", async () => {
    const result = await typecheck({
      cwd: root,
      workspace: "tests/fixtures",
      outDir: "node_modules/.cache/svelte-typecheck/test-only",
      only: ["tests/fixtures/Child.svelte"],
    });
    const files = new Set(
      result.diagnostics.map((d) => d.file.slice(d.file.lastIndexOf("/") + 1)),
    );
    // Errors.svelte and render.ts import Child.svelte; Warnings.svelte doesn't.
    expect([...files].sort()).toEqual(["Errors.svelte", "render.ts"]);
    expect(result.skipped).toBe(1);
  }, 30_000);
});

describe("changedFiles", () => {
  it("lists changed and untracked files, and a branch's commits with a ref", () => {
    const dir = join(root, "tests/.tmp/git");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: dir,
      });
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.ts"), "1");
    writeFileSync(join(dir, "b.ts"), "1");
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "topic");
    writeFileSync(join(dir, "b.ts"), "2");
    git("commit", "-qam", "topic");
    writeFileSync(join(dir, "a.ts"), "2");
    writeFileSync(join(dir, "c.ts"), "1");
    const names = (paths: string[]) =>
      paths.map((p) => p.slice(p.lastIndexOf("/") + 1)).sort();
    expect(names(changedFiles(dir))).toEqual(["a.ts", "c.ts"]);
    expect(names(changedFiles(dir, "main"))).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
