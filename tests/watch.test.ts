import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { typecheck } from "../src/check.ts";
import type { TypecheckResult } from "../src/types.ts";
import { watch } from "../src/watch.ts";

const root = join(import.meta.dir, "..");
const BROKEN = `<script lang="ts">\n  const n: number = "one";\n</script>\n`;

/** A copy of the clean fixtures, inside the repo so imports resolve. */
async function workspace(name: string): Promise<string> {
  const dir = join(root, "tests/.tmp", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await Promise.all(
    ["Child.svelte", "Clean.svelte", "tsconfig.json"].map((file) =>
      cp(join(root, "tests/fixtures", file), join(dir, file)),
    ),
  );
  return dir;
}

describe("incremental", () => {
  it("is the default: rechecks a changed component and drops a removed one's code", async () => {
    const dir = await workspace("incremental");
    const outDir = join(
      root,
      "node_modules/.cache/svelte-typecheck/test-incremental",
    );
    await rm(outDir, { recursive: true, force: true });
    const run = () => typecheck({ cwd: root, workspace: dir, outDir });
    expect((await run()).diagnostics).toEqual([]);
    // The checker's own cache, for the next run.
    expect(existsSync(join(outDir, "tsbuildinfo"))).toBe(true);
    await writeFile(join(dir, "Broken.svelte"), BROKEN);
    expect((await run()).diagnostics.map((d) => d.code)).toEqual(["TS2322"]);
    await rm(join(dir, "Broken.svelte"));
    expect((await run()).diagnostics).toEqual([]);
    expect(existsSync(join(outDir, "svelte/++Broken.svelte.ts"))).toBe(false);
  }, 30_000);
});

describe("incremental, with a component unchanged", () => {
  it("maps an error a changed import causes in it", async () => {
    const dir = await workspace("incremental-import");
    const outDir = join(
      root,
      "node_modules/.cache/svelte-typecheck/test-incremental-import",
    );
    await rm(outDir, { recursive: true, force: true });
    const run = () => typecheck({ cwd: root, workspace: dir, outDir });
    expect((await run()).diagnostics).toEqual([]);
    // Clean.svelte passes `count={double}`, a number; it's now a string.
    const child = join(dir, "Child.svelte");
    await writeFile(
      child,
      (await readFile(child, "utf-8")).replace(
        "export let count: number;",
        "export let count: string;",
      ),
    );
    const [error] = (await run()).diagnostics;
    expect(error?.file).toBe(join(dir, "Clean.svelte"));
    expect([error?.line, error?.column, error?.code]).toEqual([
      12,
      8,
      "TS2322",
    ]);
  }, 30_000);
});

describe("watch", () => {
  it("checks again when a component changes", async () => {
    const dir = await workspace("watch");
    const results: TypecheckResult[] = [];
    let onResult = () => {};
    /** Resolves on the first result that `test` accepts. */
    const until = (test: (r: TypecheckResult) => boolean) =>
      new Promise<TypecheckResult>((done) => {
        onResult = () => {
          const found = results.find(test);
          if (found) done(found);
        };
        onResult();
      });
    const stop = watch(
      {
        cwd: root,
        workspace: dir,
        outDir: join(root, "node_modules/.cache/svelte-typecheck/test-watch"),
      },
      (result) => {
        if (!(result instanceof Error)) results.push(result);
        onResult();
      },
    );
    try {
      const first = await until(() => true);
      expect(first.diagnostics).toEqual([]);
      // A late event from the copy above can rerun the check first.
      await writeFile(join(dir, "Broken.svelte"), BROKEN);
      const broken = await until((r) => r.diagnostics.length > 0);
      expect(broken.diagnostics.map((d) => d.code)).toEqual(["TS2322"]);
    } finally {
      stop();
    }
  }, 30_000);
});

describe("incremental, with nothing changed", () => {
  it("returns the last result, and checks again once a file changes", async () => {
    const dir = await workspace("replay");
    const outDir = join(
      root,
      "node_modules/.cache/svelte-typecheck/test-replay",
    );
    await rm(outDir, { recursive: true, force: true });
    const run = () => typecheck({ cwd: root, workspace: dir, outDir });
    expect((await run()).timings.check).toBeGreaterThan(0);
    // Replayed: nothing generated or checked.
    const replayed = await run();
    expect(replayed.diagnostics).toEqual([]);
    expect(replayed.timings.check).toBe(0);
    // A new TS file the tsconfig includes is a change.
    await writeFile(join(dir, "extra.ts"), 'export const n: number = "one";\n');
    expect((await run()).diagnostics.map((d) => d.code)).toEqual(["TS2322"]);
    // So is a file outside the tsconfig's `include` that a component imports.
    const outside = join(root, "tests/.tmp/replay-outside.ts");
    await writeFile(outside, "export const label = 1;\n");
    await writeFile(
      join(dir, "extra.ts"),
      'import { label } from "../replay-outside.js";\nexport const n: number = label;\n',
    );
    expect((await run()).diagnostics).toEqual([]);
    await writeFile(outside, 'export const label = "one";\n');
    expect((await run()).diagnostics.map((d) => d.code)).toEqual(["TS2322"]);
    // And the declarations TypeScript reads for an import of a JS file.
    const js = join(root, "tests/.tmp/replay-outside-js.js");
    const dts = join(root, "tests/.tmp/replay-outside-js.d.ts");
    await writeFile(js, "export const count = 1;\n");
    await writeFile(dts, "export const count: number;\n");
    await writeFile(
      join(dir, "extra.ts"),
      'import { count } from "../replay-outside-js.js";\nexport const n: number = count;\n',
    );
    expect((await run()).diagnostics).toEqual([]);
    await writeFile(dts, "export const count: string;\n");
    expect((await run()).diagnostics.map((d) => d.code)).toEqual(["TS2322"]);
  }, 30_000);
});

describe("the project's own build info", () => {
  it("is never written over, incremental or not", async () => {
    const dir = await workspace("own-build-info");
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          incremental: true,
          tsBuildInfoFile: "./own.tsbuildinfo",
        },
        include: ["."],
      }),
    );
    const outDir = join(
      root,
      "node_modules/.cache/svelte-typecheck/test-own-build-info",
    );
    await typecheck({ cwd: root, workspace: dir, outDir, incremental: false });
    expect(existsSync(join(dir, "own.tsbuildinfo"))).toBe(false);
    await typecheck({ cwd: root, workspace: dir, outDir });
    expect(existsSync(join(dir, "own.tsbuildinfo"))).toBe(false);
    expect(existsSync(join(outDir, "tsbuildinfo"))).toBe(true);
  }, 30_000);
});
