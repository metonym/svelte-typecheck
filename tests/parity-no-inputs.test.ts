// svelte-check and svelte-typecheck on a tsconfig that includes no
// components, or nothing.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cli, ours, svelte5, svelteCheck } from "./parity.ts";

describe("svelte-check parity, machine output", () => {
  it("warns, as svelte-check does, of a tsconfig with no components", () => {
    const cwd = join(svelte5, ".tmp/no-components");
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

  it.each([
    ["an include that matches nothing", "no-inputs", { include: ["scr"] }],
    // TypeScript reads `my.app` as a file, so "." includes nothing.
    ["a folder whose name has a dot", "my.app", { include: ["."] }],
    [
      "an include with ${configDir}",
      "no-inputs-config-dir",
      { include: ["${configDir}/lib"] },
    ],
    // An inherited include is named from the extending tsconfig; with no
    // exclude, outDir is excluded.
    [
      "an inherited include",
      "no-inputs-extends",
      { extends: "./config/base.json", compilerOptions: { outDir: "out" } },
    ],
  ])(
    "fails, as svelte-check does, on %s",
    (_, name, tsconfig) => {
      const cwd = join(svelte5, ".tmp", name);
      mkdirSync(join(cwd, "src"), { recursive: true });
      mkdirSync(join(cwd, "config"), { recursive: true });
      writeFileSync(join(cwd, "tsconfig.json"), JSON.stringify(tsconfig));
      writeFileSync(
        join(cwd, "config/base.json"),
        JSON.stringify({ compilerOptions: { strict: true }, include: ["lib"] }),
      );
      writeFileSync(join(cwd, "src/App.svelte"), "<h1>Hi</h1>\n");
      writeFileSync(join(cwd, "src/a.ts"), "export const a: number = 1;\n");
      expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
      const status = (command: string[]) =>
        spawnSync(command[0] ?? "", command.slice(1), { cwd }).status;
      expect(status([process.execPath, cli])).toBe(1);
    },
    60_000,
  );
});
