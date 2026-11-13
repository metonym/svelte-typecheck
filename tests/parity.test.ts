import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const svelte5 = join(root, "tests/projects/svelte5");

/**
 * A package's own bin on Node, the one the project at `cwd` installs, as
 * its scripts would run it: `node_modules/.bin` holds shell shims on Windows.
 */
function binOf(cwd: string, pkg: string, file: string): string[] {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const path = join(dir, "node_modules", pkg, file);
    if (existsSync(path)) return ["node", path];
    if (dirname(dir) === dir) throw new Error(`no ${pkg} for ${cwd}`);
  }
}
const svelteCheckBin = (cwd: string) =>
  binOf(cwd, "svelte-check", "bin/svelte-check");
const TIMESTAMP = /^\d+ /;

/** A CLI's machine output without timestamps or the file count. */
function machine(command: string[], cwd: string): string[] {
  const { stdout } = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    encoding: "utf-8",
  });
  return stdout
    .split("\n")
    .filter((line) => TIMESTAMP.test(line))
    .map((line) =>
      line
        .replace(TIMESTAMP, "")
        // svelte-check counts every file in TypeScript's program.
        .replace(/^COMPLETED \d+ FILES/, "COMPLETED"),
    );
}

const svelteCheck = (args: string[], cwd: string) =>
  machine([...svelteCheckBin(cwd), "--output", "machine", ...args], cwd);
const ours = (args: string[], cwd: string) =>
  machine(
    [
      process.execPath,
      join(root, "src/cli.ts"),
      "--output",
      "machine",
      ...args,
    ],
    cwd,
  );

describe("svelte-check parity, machine output", () => {
  it.each([
    ["the nearest tsconfig", []],
    ["--no-tsconfig", ["--no-tsconfig"]],
    ["--threshold error", ["--threshold", "error"]],
    // With a tsconfig, svelte-check reports type errors even then; its
    // docs and --no-tsconfig don't.
    [
      "--diagnostic-sources svelte",
      ["--diagnostic-sources", "svelte", "--no-tsconfig"],
    ],
    ["--diagnostic-sources js", ["--diagnostic-sources", "js"]],
    [
      "--compiler-warnings",
      ["--compiler-warnings", "a11y_missing_attribute:error"],
    ],
  ])(
    "matches svelte-check with %s",
    (_, args) => {
      const cwd = join(svelte5, "basic");
      expect(ours(args, cwd)).toEqual(svelteCheck(args, cwd));
    },
    60_000,
  );

  it("matches svelte-check with $$Props, $$Events, $$Slots, strictEvents and animate:", () => {
    const cwd = join(svelte5, "typed");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check with generic components", () => {
    const cwd = join(svelte5, "generic");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check with a generic JS component", () => {
    const cwd = join(svelte5, "generic-js");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // svelte-check reports more syntax errors here, from the broken
  // generics it pastes in more places, and the type errors they cause.
  it("reports svelte-check's first syntax errors in generics that don't parse", () => {
    const cwd = join(svelte5, "generic-invalid");
    const errors = (lines: string[]) =>
      lines.filter((line) => line.startsWith("ERROR "));
    const expected = errors(svelteCheck([], cwd));
    const received = errors(ours([], cwd));
    expect(received.length).toBeGreaterThan(0);
    expect(received).toEqual(expected.slice(0, received.length));
  }, 60_000);

  it("matches svelte-check with runes, snippets, attachments and function bindings", () => {
    const cwd = join(svelte5, "runes");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check in a SvelteKit project", () => {
    const cwd = join(root, "tests/projects/kit");
    // SvelteKit writes `./$types` and the tsconfig the project extends.
    const [node = "", kit = ""] = binOf(cwd, "@sveltejs/kit", "svelte-kit.js");
    spawnSync(node, [kit, "sync"], { cwd });
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check on markup that doesn't parse, TypeScript in JS, no allowJs and a scss style", () => {
    const cwd = join(svelte5, "edge");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // Each helper the generated code calls, failing, and a TS file that
  // uses components wrongly: every name the shims' types print.
  it("matches svelte-check where a message prints the shims' types", () => {
    const cwd = join(svelte5, "helpers");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // Without `allowJs`, an import of a JS component has no declaration.
  it("matches svelte-check on imports of a JS component without allowJs", () => {
    const cwd = join(svelte5, "untyped");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check's message rewrites and filters", () => {
    const cwd = join(svelte5, "filters");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

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
      expect(status([process.execPath, join(root, "src/cli.ts")])).toBe(1);
    },
    60_000,
  );

  it("leaves an element's attributes unchecked with an action, as svelte-check does", () => {
    const cwd = join(svelte5, ".tmp/action-attributes");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, "jsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          checkJs: true,
          allowJs: true,
          module: "esnext",
          moduleResolution: "bundler",
        },
        include: ["*.svelte"],
      }),
    );
    writeFileSync(
      join(cwd, "App.svelte"),
      [
        "<script>",
        "  /** @type {number | string | undefined} */",
        '  export let tabindex = "0";',
        "  /** @param {HTMLElement} node */",
        "  function noop(node) {",
        "    void node;",
        "  }",
        "</script>",
        "",
        "<input use:noop {tabindex} />",
        "<input {tabindex} />",
        "",
      ].join("\n"),
    );
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  describe("`svelte:element`", () => {
    const cwd = join(svelte5, ".tmp/svelte-element");
    const component = (markup: string) => {
      mkdirSync(cwd, { recursive: true });
      writeFileSync(
        join(cwd, "jsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            checkJs: true,
            allowJs: true,
            module: "esnext",
            moduleResolution: "bundler",
          },
          include: ["*.svelte"],
        }),
      );
      writeFileSync(
        join(cwd, "Any.svelte"),
        [
          "<script>",
          '  /** @template {keyof HTMLElementTagNameMap} [Tag="div"] */',
          "  /** @type {Tag} */",
          '  export let tag = /** @type {Tag} */ ("div");',
          "  /** @type {boolean} */",
          "  export let link = false;",
          "</script>",
          "",
          markup,
          "",
        ].join("\n"),
      );
    };
    const TOO_COMPLEX = "union type that is too complex";

    it("checks a tag that may be any element, where svelte-check gives up", () => {
      component("<svelte:element this={tag}><slot /></svelte:element>");
      // svelte-check reports TypeScript's limit instead; see docs/svelte-check.md.
      expect(svelteCheck([], cwd).some((l) => l.includes(TOO_COMPLEX))).toBe(
        true,
      );
      expect(ours([], cwd).some((l) => l.startsWith("ERROR"))).toBe(false);
    }, 60_000);

    it("places an attribute error where svelte-check does", () => {
      component(
        "<svelte:element this={tag} title={1}><slot /></svelte:element>",
      );
      const at = (lines: string[]) =>
        lines.filter((l) => l.startsWith("ERROR")).map((l) => l.split(" ")[2]);
      expect(at(ours([], cwd))).toEqual(at(svelteCheck([], cwd)));
    }, 60_000);

    it("matches svelte-check on a tag from a few elements", () => {
      component(
        '<svelte:element this={link ? "a" : "div"} href="/" title={{}}><slot /></svelte:element>',
      );
      expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
    }, 60_000);
  });

  it("matches svelte-check with preprocessors", () => {
    const cwd = join(root, "tests/projects/preprocess");
    // svelte-check's css source (not supported) flags the custom style.
    const args = ["--diagnostic-sources", "js,svelte"];
    expect(ours(args, cwd)).toEqual(svelteCheck(args, cwd));
  }, 60_000);
});

describe("svelte-check parity, other formats", () => {
  const cwd = join(svelte5, "basic");
  /** A run's output with the tool's name and timestamps as svelte-check's. */
  const output = (command: string[], format: string) =>
    spawnSync(
      command[0] ?? "",
      [...command.slice(1), "--output", format, "--no-color"],
      {
        cwd,
        encoding: "utf-8",
      },
    )
      .stdout.replaceAll("svelte-typecheck found", "svelte-check found")
      .replaceAll("Loading svelte-typecheck in", "Loading svelte-check in")
      .replaceAll(/^\d+ /gm, "")
      .replace(/COMPLETED \d+ FILES/, "COMPLETED");

  it.each(["human", "human-verbose", "machine-verbose"])(
    "matches svelte-check's %s output",
    (format) => {
      expect(output([process.execPath, join(root, "src/cli.ts")], format)).toBe(
        output(svelteCheckBin(cwd), format),
      );
    },
    60_000,
  );
});
