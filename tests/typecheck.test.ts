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
        result.diagnostics
          .filter((d) => d.source !== "svelte")
          .map(
            (d) =>
              `${d.file.replace("tests/fixtures/", "")}:${d.line}:${d.column} ${d.code}`,
          ),
      ).toEqual(EXPECTED);
      expect(result.dropped).toEqual([]);
    },
    30_000,
  );

  describe("compiler diagnostics", () => {
    const check = (options: Parameters<typeof typecheck>[0] = {}) =>
      typecheck({
        cwd: root,
        workspace: "tests/fixtures",
        outDir: "node_modules/.cache/svelte-typecheck/test-compiler",
        ...options,
      });

    it("reports the compiler's warnings, svelte-ignore applied", async () => {
      const { diagnostics } = await check({ diagnosticSources: ["svelte"] });
      expect(diagnostics).toEqual([
        {
          file: "tests/fixtures/Warnings.svelte",
          line: 5,
          column: 1,
          severity: "warning",
          source: "svelte",
          code: "a11y_missing_attribute",
          message:
            "`<img>` element should have an alt attribute\nhttps://svelte.dev/e/a11y_missing_attribute",
        },
      ]);
    });

    it("ignores a warning, or makes it an error, by code", async () => {
      const ignored = await check({
        diagnosticSources: ["svelte"],
        compilerWarnings: { a11y_missing_attribute: "ignore" },
      });
      expect(ignored.diagnostics).toEqual([]);
      const raised = await check({
        diagnosticSources: ["svelte"],
        compilerWarnings: { a11y_missing_attribute: "error" },
      });
      expect(raised.diagnostics.map((d) => d.severity)).toEqual(["error"]);
    });

    it("reports errors only at the error threshold", async () => {
      const { diagnostics } = await check({ threshold: "error" });
      expect(diagnostics.every((d) => d.severity === "error")).toBe(true);
      expect(diagnostics).toHaveLength(EXPECTED.length);
    }, 30_000);

    it.each([
      ["svelte4", "a11y-missing-attribute"],
      ["svelte3", "a11y-missing-attribute"],
    ])("uses the project's own compiler (%s)", async (svelte, code) => {
      const { diagnostics } = await check({
        diagnosticSources: ["svelte"],
        svelte: `node_modules/${svelte}`,
      });
      expect(diagnostics.map((d) => d.code)).toContain(code);
    });
  });
});
