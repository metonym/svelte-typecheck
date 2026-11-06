import { readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { typecheck } from "../src/check.ts";
import type { TypecheckOptions } from "../src/types.ts";
import { generate, type Shape } from "./generate.ts";

const root = join(import.meta.dir, "..");
/** Generated projects go here, where Svelte and tsrs resolve. */
const svelte5 = join(root, "tests/projects/svelte5");
const SHAPES: Shape[] = ["pairs", "chain", "hub", "barrel"];

const run = (workspace: string, options: TypecheckOptions = {}) =>
  typecheck({
    cwd: svelte5,
    workspace,
    checker: "tsrs",
    diagnosticSources: ["js"],
    outDir: `node_modules/.cache/svelte-typecheck/scale-${relative(join(svelte5, ".tmp/scale"), workspace)}`,
    ...options,
  });

/** Milliseconds a cold run spends outside the checker: the fewest of 3. */
async function ownTime(workspace: string): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    // eslint-disable-next-line no-await-in-loop -- runs are timed one at a time
    const result = await run(workspace, { incremental: false });
    best = Math.min(best, performance.now() - start - result.timings.check);
  }
  return best;
}

/** Each generated component's code, by its modification time. */
function generatedTimes(outDir: string): Map<string, number> {
  const times = new Map<string, number>();
  for (const name of readdirSync(outDir, { recursive: true, encoding: "utf8" }))
    if (name.includes("++"))
      times.set(name, statSync(join(outDir, name)).mtimeMs);
  return times;
}

describe("scale", () => {
  // 4 times the components should cost about 4 times as much outside the
  // checker; 6 times leaves room for a loaded machine, and catches a cost
  // that grows with the square of the project.
  it.each(SHAPES)(
    "spends time outside the checker in proportion to the components (%s)",
    async (shape) => {
      const small = join(svelte5, ".tmp/scale", `${shape}-500`);
      const large = join(svelte5, ".tmp/scale", `${shape}-2000`);
      await generate(small, { components: 500, shape });
      await generate(large, { components: 2000, shape });
      const ratio = (await ownTime(large)) / (await ownTime(small));
      expect(ratio).toBeLessThan(6);
    },
    60_000,
  );

  it.each(SHAPES)(
    "reports every planted error where it was planted (%s)",
    async (shape) => {
      const dir = join(svelte5, ".tmp/scale", `${shape}-errors`);
      const planted = await generate(dir, {
        components: 1000,
        shape,
        errors: 2,
      });
      const { diagnostics } = await run(dir, { incremental: false });
      const at = (d: {
        file: string;
        line: number;
        column: number;
        code: string;
      }) => `${d.file}:${d.line}:${d.column} ${d.code}`;
      expect(
        diagnostics
          .map((d) => at({ ...d, file: relative(dir, d.file) }))
          .sort(),
      ).toEqual(planted.map(at).sort());
    },
    60_000,
  );

  // A component's generated code depends on its source alone, so an edit
  // regenerates and rewrites that one component, however many import it;
  // the checker still sees what the edit does to them.
  it("regenerates only the edited component, and checks its importers", async () => {
    const dir = join(svelte5, ".tmp/scale", "hub-edit");
    await generate(dir, { components: 2000, shape: "hub" });
    // Generating every component: the fewer milliseconds of 2 cold runs.
    const cold = Math.min(
      (await run(dir, { incremental: false })).timings.emit,
      (await run(dir, { incremental: false })).timings.emit,
    );
    const first = await run(dir);
    expect(first.diagnostics).toEqual([]);
    const outDir = join(
      svelte5,
      "node_modules/.cache/svelte-typecheck/scale-hub-edit",
    );
    const before = generatedTimes(outDir);
    expect(before.size).toBe(2000);
    // The hub's `label` changes type: each importer passes a string.
    const hub = join(dir, "Hub.svelte");
    const retype = async (from: string, to: string) => {
      await writeFile(
        hub,
        (await readFile(hub, "utf-8")).replace(
          `label: ${from};`,
          `label: ${to};`,
        ),
      );
      return run(dir);
    };
    const second = await retype("string", "number");
    const after = generatedTimes(outDir);
    expect(
      [...after]
        .filter(([name, time]) => before.get(name) !== time)
        .map(([name]) => name),
    ).toEqual([join("svelte", "++Hub.svelte.ts")]);
    expect(second.diagnostics).toHaveLength(1999);
    expect(new Set(second.diagnostics.map((d) => d.code))).toEqual(
      new Set(["TS2322"]),
    );
    // A run writes only what changed, so the times above can't tell a
    // component generated again from one kept: the time can. Kept, an
    // edit's run generates in about a tenth of a cold run's time;
    // generated again, in about half.
    const third = await retype("number", "boolean");
    expect(Math.min(second.timings.emit, third.timings.emit)).toBeLessThan(
      cold / 4,
    );
  }, 60_000);

  it("returns the last result when nothing changed", async () => {
    const dir = join(svelte5, ".tmp/scale", "barrel-unchanged");
    await generate(dir, { components: 2000, shape: "barrel", errors: 1 });
    const first = await run(dir);
    const second = await run(dir);
    expect(second.timings).toEqual({ emit: 0, check: 0, compile: 0 });
    expect(second.diagnostics).toEqual(first.diagnostics);
  }, 60_000);
});
