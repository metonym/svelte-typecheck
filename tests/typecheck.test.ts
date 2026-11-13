import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { typecheck } from "../src/check.ts";
import type { Checker } from "../src/types.ts";

const root = join(import.meta.dir, "..");
/** The Svelte 5 project the tests run from, as a user runs from theirs. */
const svelte5 = join(root, "tests/projects/svelte5");
const basic = join(svelte5, "basic");

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
        cwd: svelte5,
        workspace: "basic",
        checker,
        outDir: `node_modules/.cache/svelte-typecheck/test-${checker}`,
      });
      expect(result.checker).toBe(checker);
      expect(
        result.diagnostics
          .filter((d) => d.source !== "svelte")
          .map(
            (d) => `${relative(basic, d.file)}:${d.line}:${d.column} ${d.code}`,
          ),
      ).toEqual(EXPECTED);
      expect(result.dropped).toEqual([]);
    },
    30_000,
  );

  // A run learns which `ignoreDeprecations` the tsconfig needs, and the
  // next runs tsc once, with it, for the same result.
  it("reuses what a run learned of a tsconfig's deprecated options", async () => {
    const options = {
      cwd: svelte5,
      workspace: "deprecated",
      checker: "tsc" as const,
      outDir: "node_modules/.cache/svelte-typecheck/test-deprecated-cache",
    };
    rmSync(join(svelte5, options.outDir), { recursive: true, force: true });
    const first = await typecheck(options);
    expect(existsSync(join(svelte5, options.outDir, "deprecations.json"))).toBe(
      true,
    );
    const count = join(svelte5, "deprecated/src/lib/Count.svelte");
    const text = readFileSync(count, "utf-8");
    // A change to a component, so the result isn't reused whole.
    writeFileSync(count, `${text}\n`);
    try {
      const second = await typecheck(options);
      expect(second.diagnostics).toEqual(first.diagnostics);
      expect(first.diagnostics.map((d) => `${d.code} ${d.severity}`)).toEqual([
        "TS2322 error",
        "TS2322 error",
        "TS5101 warning",
        "TS5101 warning",
      ]);
    } finally {
      writeFileSync(count, text);
    }
  }, 60_000);

  // TypeScript 7 removed what TypeScript 6 deprecates, and won't check.
  it.each<Checker>(["bun", "tsrs", "tsgo"])(
    "reports a removed option on the project's tsconfig, with %s",
    async (checker) => {
      const result = await typecheck({
        cwd: svelte5,
        workspace: "deprecated",
        checker,
        outDir: `node_modules/.cache/svelte-typecheck/test-deprecated-${checker}`,
      });
      expect(
        result.diagnostics.map(
          (d) =>
            `${relative(svelte5, d.file).replaceAll("\\", "/")}:${d.line}:${d.column} ${d.code} ${d.severity}`,
        ),
      ).toEqual([
        "deprecated/tsconfig.json:3:3 TS5102 error",
        "deprecated/tsconfig.json:7:5 TS5102 error",
      ]);
      // The hint names the folder `baseUrl` did, from the project's tsconfig.
      expect(result.diagnostics[0]?.message).toContain(
        `"paths": {"*": ["./src/*"]}`,
      );
    },
    30_000,
  );

  // A shell keeps `$PWD` as the path it was given, symlinks and all (macOS's
  // `/tmp` is `/private/tmp`). Go's `os.Getwd` trusts it, so tsgo prints
  // its paths relative to it, not to the folder's real path.
  it.each<Checker>(["tsgo", "tsc"])(
    "reads %s's paths when $PWD names the folder through a symlink",
    async (checker) => {
      const link = join(svelte5, ".tmp/pwd-link");
      mkdirSync(join(svelte5, ".tmp"), { recursive: true });
      rmSync(link, { force: true });
      symlinkSync(svelte5, link);
      const pwd = process.env.PWD;
      process.env.PWD = link;
      try {
        const result = await typecheck({
          cwd: svelte5,
          workspace: "basic",
          checker,
          incremental: false,
          outDir: `node_modules/.cache/svelte-typecheck/test-pwd-${checker}`,
        });
        expect(
          result.diagnostics
            .filter((d) => d.source !== "svelte")
            .map(
              (d) =>
                `${relative(basic, d.file)}:${d.line}:${d.column} ${d.code}`,
            ),
        ).toEqual(EXPECTED);
      } finally {
        process.env.PWD = pwd;
      }
    },
    30_000,
  );

  // A checker reports real paths, and the last run's manifest lists them.
  // A `cwd` through a symlink (macOS's `/tmp`) must name the same files.
  it.each<Checker>(["bun", "tsrs", "tsgo", "tsc"])(
    "reports them when cwd names the folder through a symlink, with %s",
    async (checker) => {
      const link = join(svelte5, `.tmp/cwd-link-${checker}`);
      mkdirSync(join(svelte5, ".tmp"), { recursive: true });
      rmSync(link, { force: true });
      symlinkSync(svelte5, link);
      const outDir = `node_modules/.cache/svelte-typecheck/test-cwd-link-${checker}`;
      rmSync(join(svelte5, outDir), { recursive: true, force: true });
      const run = async (cwd: string) =>
        (
          await typecheck({ cwd, workspace: "basic", checker, outDir })
        ).diagnostics
          .filter((d) => d.source !== "svelte")
          .map(
            (d) => `${relative(basic, d.file)}:${d.line}:${d.column} ${d.code}`,
          );
      expect(await run(svelte5)).toEqual(EXPECTED);
      // A new component, so the next run can't reuse the last result.
      const extra = join(basic, `Extra-${checker}.svelte`);
      writeFileSync(extra, "<p>extra</p>\n");
      try {
        expect(await run(link)).toEqual(EXPECTED);
      } finally {
        rmSync(extra, { force: true });
      }
    },
    30_000,
  );

  it("reports them on Svelte 3, with its element types from the shims", async () => {
    const result = await typecheck({
      cwd: svelte5,
      workspace: "basic",
      svelte: "../svelte3/node_modules/svelte",
      outDir: "node_modules/.cache/svelte-typecheck/test-svelte3",
    });
    expect(
      result.diagnostics
        .filter((d) => d.source !== "svelte")
        .map(
          (d) => `${relative(basic, d.file)}:${d.line}:${d.column} ${d.code}`,
        ),
    ).toEqual(EXPECTED);
  }, 30_000);

  describe("compiler diagnostics", () => {
    const check = (options: Parameters<typeof typecheck>[0] = {}) =>
      typecheck({
        cwd: svelte5,
        workspace: "basic",
        outDir: "node_modules/.cache/svelte-typecheck/test-compiler",
        ...options,
      });

    it("reports the compiler's warnings, svelte-ignore applied", async () => {
      const { diagnostics } = await check({ diagnosticSources: ["svelte"] });
      expect(diagnostics).toEqual([
        {
          file: join(basic, "Warnings.svelte"),
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
      rmSync(join(svelte5, outDir), { recursive: true, force: true });
      const { diagnostics } = await check({
        diagnosticSources: ["svelte"],
        outDir,
      });
      expect(diagnostics.map((d) => d.code)).toEqual([
        "a11y_missing_attribute",
      ]);
      expect(existsSync(join(svelte5, outDir, "svelte"))).toBe(false);
      expect(existsSync(join(svelte5, outDir, "tsconfig.json"))).toBe(false);
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
        svelte: `../${svelte}/node_modules/svelte`,
      });
      expect(diagnostics.map((d) => d.code)).toContain(code);
    });

    describe("in .svelte.js and .svelte.ts modules", () => {
      const modules = join(svelte5, "modules");
      const checkModules = (options: Parameters<typeof typecheck>[0] = {}) =>
        typecheck({
          cwd: modules,
          outDir: "node_modules/.cache/svelte-typecheck/test-modules",
          ...options,
        });
      const LOCAL = "https://svelte.dev/e/state_referenced_locally";

      it("reports them, svelte-ignore applied, at the source's positions", async () => {
        const { diagnostics } = await checkModules();
        expect(
          diagnostics.map((d) => [
            relative(modules, d.file),
            d.line,
            d.column,
            d.source,
            d.code,
            d.message.endsWith(LOCAL),
          ]),
        ).toEqual([
          [
            "counter.svelte.ts",
            5,
            25,
            "svelte",
            "state_referenced_locally",
            true,
          ],
          [
            "plain.svelte.js",
            2,
            22,
            "svelte",
            "state_referenced_locally",
            true,
          ],
        ]);
      });

      it("ignores or raises them by code, and only with the svelte source", async () => {
        const ignored = await checkModules({
          compilerWarnings: { state_referenced_locally: "ignore" },
        });
        expect(ignored.diagnostics).toEqual([]);
        const raised = await checkModules({
          compilerWarnings: { state_referenced_locally: "error" },
        });
        expect(raised.diagnostics.map((d) => d.severity)).toEqual([
          "error",
          "error",
        ]);
        const typesOnly = await checkModules({ diagnosticSources: ["js"] });
        expect(typesOnly.diagnostics).toEqual([]);
      });

      it("reports none before Svelte 5, which has no modules", async () => {
        const { diagnostics } = await checkModules({
          diagnosticSources: ["svelte"],
          svelte: "../../svelte4/node_modules/svelte",
        });
        expect(diagnostics).toEqual([]);
      });
    });
  });

  it("reports the project's TS and JS errors with declarations off", async () => {
    // A library's components, typed by their own `.svelte.d.ts`.
    const dir = join(svelte5, ".tmp/no-declarations");
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

  // TypeScript 7.1 runs a tsconfig's content mappers only with
  // `--runExternalCode`, and errors without it; the generated code is
  // already TypeScript, so the generated tsconfig turns them off.
  it.each<Checker>(["bun", "tsrs", "tsgo", "tsc"])(
    "checks a project whose tsconfig declares content mappers, with %s",
    async (checker) => {
      const dir = join(svelte5, `.tmp/content-mappers-${checker}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true },
          include: ["*.svelte", "*.ts"],
          contentMappers: [
            { package: "@sveltejs/ts-content-mapper", extensions: [".svelte"] },
          ],
        }),
      );
      writeFileSync(
        join(dir, "Box.svelte"),
        '<script lang="ts">\n  let n: number = "one";\n</script>\n',
      );
      const { diagnostics } = await typecheck({
        cwd: dir,
        diagnosticSources: ["js"],
        checker,
        incremental: false,
      });
      expect(
        diagnostics.map((d) => `${relative(dir, d.file)}:${d.line} ${d.code}`),
      ).toEqual(["Box.svelte:2 TS2322"]);
    },
    30_000,
  );

  // A repeated `on:` repeats its key in the element's object, as
  // svelte2tsx writes it. Each checker reports the last handler's error
  // at each key, and that the key repeats (TS1117) at none.
  it.each<Checker>(["bun", "tsrs", "tsgo", "tsc"])(
    "reports a repeated on: as svelte-check does, with %s",
    async (checker) => {
      const { diagnostics } = await typecheck({
        cwd: svelte5,
        workspace: "repeated-on-directive",
        diagnosticSources: ["js"],
        checker,
        incremental: false,
        outDir: `node_modules/.cache/svelte-typecheck/test-repeated-on-${checker}`,
      });
      expect(diagnostics.map((d) => `${d.line}:${d.column} ${d.code}`)).toEqual(
        [
          "5:12 TS2322",
          "5:37 TS2322",
          "8:12 TS2322",
          "8:37 TS2322",
          "8:62 TS2322",
          "9:12 TS2322",
          "9:54 TS2322",
          "11:9 TS2353",
          "12:19 TS2322",
          "12:47 TS2322",
        ],
      );
    },
    30_000,
  );

  // With no type error to show it type-checked, TS1117 alone isn't taken
  // for a syntax error in the generated code.
  it.each<Checker>(["bun", "tsrs", "tsgo", "tsc"])(
    "passes a repeated on: with no error, with %s",
    async (checker) => {
      const dir = join(svelte5, `.tmp/repeated-on-${checker}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true },
          include: ["*.svelte"],
        }),
      );
      writeFileSync(
        join(dir, "App.svelte"),
        '<script lang="ts">\n  let x = 0;\n</script>\n<button on:click={() => (x = 1)} on:click={() => (x = 2)}>{x}</button>\n',
      );
      const { diagnostics } = await typecheck({
        cwd: dir,
        checker,
        incremental: false,
      });
      expect(diagnostics).toEqual([]);
    },
    30_000,
  );

  it("reads a JSDoc cast in a template expression, as svelte-check does", async () => {
    const dir = join(svelte5, ".tmp/template-cast");
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
      cwd: join(root, "tests/projects/preprocess"),
      outDir: "node_modules/.cache/svelte-typecheck/test-preprocess",
    });
    // Where svelte-check reports it; the stripped block moved it up 5 lines,
    // and `#!custom` would be a CSS error without the style preprocessor.
    expect(
      diagnostics.map((d) => `${d.line}:${d.column} ${d.severity} ${d.code}`),
    ).toEqual(["10:1 warning a11y_missing_attribute"]);
  }, 30_000);
});
