import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const WARNING = /^\d+ WARNING /gm;

describe("the compiler pass's cache", () => {
  it("skips the config and the compiler for unchanged components", async () => {
    const dir = join(root, "tests/projects/svelte5/.tmp/compile-cache");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await Promise.all(
      ["Warnings.svelte", "tsconfig.json"].map((file) =>
        cp(join(root, "tests/projects/svelte5/basic", file), join(dir, file)),
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
    // A changed component: a config with no preprocessors, whose shape
    // the first run kept, isn't loaded either.
    expect(warnings()).toBe(2);
    expect(existsSync(loaded)).toBe(false);

    // A changed config is.
    await writeFile(
      join(dir, "svelte.config.js"),
      `${await readFile(join(dir, "svelte.config.js"), "utf-8")}// changed\n`,
    );
    expect(warnings()).toBe(2);
    expect(existsSync(loaded)).toBe(true);
  }, 60_000);

  it("leaves the config unloaded for a changed component no preprocessor that changes code reads", async () => {
    const dir = join(root, "tests/projects/svelte5/.tmp/compile-cache-shape");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await Promise.all(
      ["Warnings.svelte", "tsconfig.json"].map((file) =>
        cp(join(root, "tests/projects/svelte5/basic", file), join(dir, file)),
      ),
    );
    // A style preprocessor that strips `#!custom`, and SvelteKit's, which
    // only warns; a marker each time a run loads it.
    await writeFile(
      join(dir, "svelte.config.js"),
      `import { writeFileSync } from "node:fs";
writeFileSync(new URL("./loaded", import.meta.url), "");
export default {
  preprocess: [
    { name: "strip", style: ({ content }) => ({ code: content.replace("#!custom", "") }) },
    { name: "sveltekit:warnings", markup() {}, script() {} },
  ],
};
`,
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [join(root, "src/cli.ts"), "--output", "machine"],
        { cwd: dir, encoding: "utf-8" },
      ).stdout;
    const loaded = join(dir, "loaded");
    expect(run().match(WARNING)?.length).toBe(1);
    expect(existsSync(loaded)).toBe(true);

    // No `<style>`: compiled as the config would, without loading it.
    await rm(loaded);
    const component = join(dir, "Warnings.svelte");
    const source = await readFile(component, "utf-8");
    await writeFile(component, `${source}<img src="b.png" />\n`);
    expect(run().match(WARNING)?.length).toBe(2);
    expect(existsSync(loaded)).toBe(false);

    // A `<style>` the preprocessor reads: loaded, and `#!custom` stripped
    // before the compiler sees it, so it reports no CSS error.
    await writeFile(
      component,
      `${source}<style>\n  #!custom\n  img { color: red; }\n</style>\n`,
    );
    const output = run();
    expect(existsSync(loaded)).toBe(true);
    expect(output).not.toContain(" ERROR ");
    expect(output.match(WARNING)?.length).toBe(1);
  }, 60_000);
});
