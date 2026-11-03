import { join } from "node:path";
import { typecheck } from "../src/check.ts";
import type { Checker } from "../src/types.ts";

const root = join(import.meta.dir, "..");

// One planted error per kind, where svelte-check --tsgo reported each.
// Clean.svelte has none.
const EXPECTED = [
  "Errors.svelte:8:9 TS2322", // script: a string for a number
  "Errors.svelte:11:8 TS2322", // a component prop's value
  "Errors.svelte:12:45 TS2339", // a dispatched event's detail
  "Errors.svelte:13:33 TS2339", // a default slot's `let:` prop
  "Errors.svelte:14:55 TS2339", // a named slot's `let:` prop
  "Errors.svelte:15:9 TS2322", // an element attribute's value
  "Errors.svelte:16:28 TS2339", // a DOM event
  "Errors.svelte:17:5 TS2304", // an undeclared name in markup
  "Errors.svelte:18:31 TS2339", // an `{#each}` item
  "Errors.svelte:19:18 TS2741", // `bind:this` to another element type
  "Errors.svelte:20:12 TS2339", // a `$store` value
  "render.ts:3:45 TS2322", // a component's props from TypeScript
];

describe("typecheck", () => {
  it.each<Checker>(["bun", "tsrs", "tsgo", "tsc"])(
    "reports what svelte-check reports for the fixtures, with %s",
    async (checker) => {
      const result = await typecheck({
        cwd: root,
        workspace: "tests/fixtures",
        checker,
        outDir: `node_modules/.cache/svelte-typecheck/test-${checker}`,
      });
      expect(result.checker).toBe(checker);
      expect(
        result.diagnostics.map(
          (d) =>
            `${d.file.replace("tests/fixtures/", "")}:${d.line}:${d.column} ${d.code}`,
        ),
      ).toEqual(EXPECTED);
      expect(result.dropped).toEqual([]);
    },
    30_000,
  );
});
