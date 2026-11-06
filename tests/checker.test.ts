import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { typecheck } from "../src/check.ts";
import { checkerCommand, nativeCommand, onPath } from "../src/checker.ts";

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

  describe("tsgo", () => {
    /** A project with these packages, each with a `bin`. */
    const projectWith = (
      name: string,
      packages: [dir: string, version: string, bin: string][],
    ) => {
      // Outside the repo, whose own packages a lookup from inside would find.
      const dir = join(tmpdir(), "svelte-typecheck-tsgo", name);
      rmSync(dir, { recursive: true, force: true });
      for (const [pkg, version, bin] of packages) {
        const pkgDir = join(dir, "node_modules", pkg);
        mkdirSync(join(pkgDir, "bin"), { recursive: true });
        writeFileSync(
          join(pkgDir, "package.json"),
          JSON.stringify({
            name: pkg.startsWith("@typescript/native-preview")
              ? pkg
              : "typescript",
            version,
            bin: { [bin]: `./bin/${bin}` },
          }),
        );
        writeFileSync(join(pkgDir, "bin", bin), "#!/usr/bin/env node\n");
      }
      return dir;
    };
    const found = (dir: string) => {
      const command = checkerCommand("tsgo", dir);
      return [command?.prefix[0]?.slice(dir.length + 1), command?.version];
    };

    it("prefers TypeScript 7 under svelte-check's alias, @typescript/native", () => {
      const dir = projectWith("alias", [
        ["typescript", "6.0.3", "tsc"],
        ["@typescript/native", "7.1.0", "tsc"],
        ["@typescript/native-preview", "7.0.0-dev.20260707.2", "tsgo"],
      ]);
      expect(found(dir)).toEqual([
        join("node_modules/@typescript/native/bin/tsc"),
        "7.1.0",
      ]);
    });

    it("then the preview build, then the project's typescript if it's 7", () => {
      const preview = projectWith("preview", [
        ["typescript", "7.1.0", "tsc"],
        ["@typescript/native-preview", "7.0.0-dev.20260707.2", "tsgo"],
      ]);
      expect(found(preview)[1]).toBe("7.0.0-dev.20260707.2");
      const typescript7 = projectWith("typescript7", [
        ["typescript", "7.1.0", "tsc"],
      ]);
      expect(found(typescript7)).toEqual([
        join("node_modules/typescript/bin/tsc"),
        "7.1.0",
      ]);
    });

    it("isn't TypeScript 6", () => {
      const dir = projectWith("typescript6", [
        ["typescript", "6.0.3", "tsc"],
        ["@typescript/native", "6.0.3", "tsc"],
      ]);
      expect(checkerCommand("tsgo", dir)?.version).not.toBe("6.0.3");
    });
  });

  it("finds a package installed above the project", () => {
    expect(checkerCommand("tsc", join(root, "tests/fixtures"))?.version).toBe(
      checkerCommand("tsc", root)?.version,
    );
  });
});

describe("nativeCommand", () => {
  it.each(["tsgo", "tsrs"] as const)(
    "starts %s's native binary, not its launcher",
    async (checker) => {
      const command = checkerCommand(checker, root);
      if (!command) throw new Error(`${checker} isn't installed`);
      const native = await nativeCommand(command);
      expect(native.prefix).toEqual([]);
      expect(native.command).not.toBe(process.execPath);
      expect(native.version).toBe(command.version);
      // The binary the launcher would start, which runs.
      const run = spawnSync(native.command, ["--version"], {
        encoding: "utf-8",
      });
      expect(run.stdout).toContain("Version");
    },
  );

  it("keeps the launcher of a package without a native binary", async () => {
    const tsc = checkerCommand("tsc", root);
    if (!tsc) throw new Error("typescript isn't installed");
    expect(await nativeCommand(tsc)).toEqual(tsc);
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
