import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const WARNING = /^\d+ WARNING /gm;

describe("the compiler pass's cache", () => {
  it("skips the config and the compiler for unchanged components", async () => {
    const dir = join(root, "tests/.tmp/compile-cache");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await Promise.all(
      ["Warnings.svelte", "tsconfig.json"].map((file) =>
        cp(join(root, "tests/fixtures", file), join(dir, file)),
      ),
    );
    // Leaves a marker each time a run loads it.
    await writeFile(
      join(dir, "svelte.config.js"),
      'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./loaded", import.meta.url), "");\nexport default {};\n',
    );
    const warnings = () =>
      spawnSync(
        process.execPath,
        [join(root, "src/cli.ts"), "--output", "machine"],
        { cwd: dir, encoding: "utf-8" },
      ).stdout.match(WARNING)?.length ?? 0;
    const loaded = join(dir, "loaded");

    expect(warnings()).toBe(1);
    expect(existsSync(loaded)).toBe(true);

    await rm(loaded);
    expect(warnings()).toBe(1);
    expect(existsSync(loaded)).toBe(false);

    const component = join(dir, "Warnings.svelte");
    await writeFile(
      component,
      `${await readFile(component, "utf-8")}<img src="b.png" />\n`,
    );
    expect(warnings()).toBe(2);
    expect(existsSync(loaded)).toBe(true);
  }, 60_000);
});
