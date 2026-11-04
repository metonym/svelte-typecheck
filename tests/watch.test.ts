import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
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
