import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { typecheck } from "../src/check.ts";
import { checkerCommand, onPath } from "../src/checker.ts";

const root = join(import.meta.dir, "..");

describe("checkerCommand", () => {
  it("runs the project's TypeScript launcher on the current runtime", () => {
    const tsc = checkerCommand("tsc", root);
    expect(tsc?.command).toBe(process.execPath);
    expect(tsc?.prefix[0]).toEndWith(
      join("node_modules", "typescript", "bin", "tsc"),
    );
    expect(tsc?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("finds a package installed above the project", () => {
    expect(checkerCommand("tsc", join(root, "tests/fixtures"))?.version).toBe(
      checkerCommand("tsc", root)?.version,
    );
  });
});

describe("onPath", () => {
  it("finds a Windows command by PATHEXT's extensions", () => {
    const dir = join(root, "tests/.tmp/path");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fake-checker.cmd"), "");
    const { PATH, PATHEXT } = process.env;
    process.env.PATH = dir;
    process.env.PATHEXT = ".EXE;.CMD";
    try {
      expect(onPath("fake-checker", "win32")).toBe(
        join(dir, "fake-checker.cmd"),
      );
      expect(onPath("fake-checker", "linux")).toBeUndefined();
    } finally {
      process.env.PATH = PATH;
      process.env.PATHEXT = PATHEXT;
    }
  });
});

describe("typecheck", () => {
  it("finds the checker from the workspace up, not the current folder", async () => {
    // A workspace with its own `typescript`, whose `tsc` reports nothing.
    const dir = join(root, "tests/.tmp/own-typescript");
    const pkg = join(dir, "node_modules/typescript");
    mkdirSync(join(pkg, "bin"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "typescript",
        version: "9.9.9",
        bin: { tsc: "./bin/tsc" },
      }),
    );
    writeFileSync(join(pkg, "bin/tsc"), "#!/usr/bin/env node\n");
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    const result = await typecheck({
      cwd: root,
      workspace: dir,
      outDir: "node_modules/.cache/svelte-typecheck/test-own-typescript",
      checker: "tsc",
    });
    expect(result.checkerVersion).toBe("9.9.9");
  }, 30_000);

  it("defaults to the project's TypeScript", async () => {
    const result = await typecheck({
      cwd: root,
      workspace: "tests/fixtures",
      outDir: "node_modules/.cache/svelte-typecheck/test-default",
    });
    expect(result.checker).toBe("tsc");
  }, 30_000);
});
