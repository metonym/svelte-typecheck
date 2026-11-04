import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
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
              `${relative(join(root, "tests/fixtures"), d.file)}:${d.line}:${d.column} ${d.code}`,
          ),
      ).toEqual(EXPECTED);
      expect(result.dropped).toEqual([]);
    },
    30_000,
  );

  it("reports them on Svelte 3, with its element types from the shims", async () => {
    const result = await typecheck({
      cwd: root,
      workspace: "tests/fixtures",
      svelte: "node_modules/svelte3",
      outDir: "node_modules/.cache/svelte-typecheck/test-svelte3",
    });
    expect(
      result.diagnostics
        .filter((d) => d.source !== "svelte")
        .map(
          (d) =>
            `${relative(join(root, "tests/fixtures"), d.file)}:${d.line}:${d.column} ${d.code}`,
        ),
    ).toEqual(EXPECTED);
  }, 30_000);

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
          file: join(root, "tests/fixtures/Warnings.svelte"),
          line: 5,
          column: 1,
          endLine: 5,
          endColumn: 14,
          severity: "warning",
          source: "svelte",
          code: "a11y_missing_attribute",
          message:
            "`<img>` element should have an alt attribute\nhttps://svelte.dev/e/a11y_missing_attribute",
        },
      ]);
    });

    it("generates no code for the compiler's diagnostics alone", async () => {
      const outDir = "node_modules/.cache/svelte-typecheck/test-compiler-only";
      rmSync(join(root, outDir), { recursive: true, force: true });
      const { diagnostics } = await check({
        diagnosticSources: ["svelte"],
        outDir,
      });
      expect(diagnostics.map((d) => d.code)).toEqual([
        "a11y_missing_attribute",
      ]);
      expect(existsSync(join(root, outDir, "svelte"))).toBe(false);
      expect(existsSync(join(root, outDir, "tsconfig.json"))).toBe(false);
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

  it("reports the project's TS and JS errors with declarations off", async () => {
    // A library's components, typed by their own `.svelte.d.ts`.
    const dir = join(root, "tests/.tmp/no-declarations");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, allowJs: true, checkJs: true },
        include: ["*.svelte", "*.ts", "*.js"],
      }),
    );
    writeFileSync(
      join(dir, "Box.svelte"),
      "<script>\n  export let n = 1;\n</script>\n",
    );
    writeFileSync(
      join(dir, "Box.svelte.d.ts"),
      'import { SvelteComponent } from "svelte";\nexport default class Box extends SvelteComponent<{ n?: number }> {}\n',
    );
    writeFileSync(
      join(dir, "util.js"),
      '/** @type {number} */\nexport const n = "one";\n',
    );
    writeFileSync(
      join(dir, "props.ts"),
      'import type Box from "./Box.svelte";\nexport const n: number = "one";\nexport type B = Box;\n',
    );
    const { diagnostics } = await typecheck({
      cwd: dir,
      declarations: false,
      diagnosticSources: ["js"],
      checker: "bun",
      incremental: false,
    });
    expect(
      diagnostics.map((d) => `${relative(dir, d.file)}:${d.line} ${d.code}`),
    ).toEqual(["props.ts:2 TS2322", "util.js:2 TS2322"]);
  }, 30_000);

  it("reads a JSDoc cast in a template expression, as svelte-check does", async () => {
    const dir = join(root, "tests/.tmp/template-cast");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "jsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, checkJs: true, allowJs: true },
        include: ["*.svelte"],
      }),
    );
    writeFileSync(
      join(dir, "Cast.svelte"),
      '<script>\n  /** @type {string | number} */\n  export let value = "a";\n</script>\n\n<p>{/** @type {string} */ (value).length}</p>\n<p title={/** @type {string} */ (value).trim()}></p>\n',
    );
    const { diagnostics } = await typecheck({
      cwd: dir,
      diagnosticSources: ["js"],
      checker: "bun",
      incremental: false,
    });
    expect(diagnostics).toEqual([]);
  }, 30_000);

  it("runs svelte.config's preprocessors first, positions mapped back", async () => {
    const { diagnostics } = await typecheck({
      cwd: root,
      workspace: "tests/fixtures-preprocess",
      outDir: "node_modules/.cache/svelte-typecheck/test-preprocess",
    });
    // Where svelte-check reports it; the stripped block moved it up 5 lines,
    // and `#!custom` would be a CSS error without the style preprocessor.
    expect(
      diagnostics.map((d) => `${d.line}:${d.column} ${d.severity} ${d.code}`),
    ).toEqual(["10:1 warning a11y_missing_attribute"]);
  }, 30_000);
});
