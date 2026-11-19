// svelte-check and svelte-typecheck on Svelte 3 and 4, legacy-syntax
// components and preprocessors.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  machine,
  ours,
  root,
  svelte5,
  svelteCheck,
  svelteCheckBin,
} from "./parity.ts";

describe("svelte-check parity, machine output", () => {
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

  // svelte-check from the Svelte 5 project loads each fixture's Svelte.
  const legacy = (fixture: string) => {
    const cwd = join(root, "tests/projects", fixture);
    const theirs = machine(
      [...svelteCheckBin(svelte5), "--output", "machine"],
      cwd,
    );
    return { theirs, mine: ours([], cwd) };
  };

  it.each(["svelte3", "svelte4"])(
    "matches svelte-check on %s with TypeScript and no svelte.config",
    (svelte) => {
      // Compiler warnings from the stripped script, and parse errors for
      // TypeScript and Svelte 5 syntax in markup. Svelte 4's come from
      // its own parser; Svelte 3's from Svelte 5's, as in svelte-check.
      const { theirs, mine } = legacy(`${svelte}/markup`);
      expect(theirs).toContainEqual(
        expect.stringContaining("Unused CSS selector"),
      );
      expect(mine).toEqual(theirs);
    },
    60_000,
  );

  it("matches svelte-check on Svelte 4 with a svelte.config and no preprocess", () => {
    // svelte-check strips no types here, so the compiler fails on the
    // script and its warnings are lost. Only the type error remains.
    const { theirs, mine } = legacy("svelte4/config");
    expect(theirs).toContainEqual(expect.stringContaining("not assignable"));
    expect(mine).toEqual(theirs);
  }, 60_000);

  it("reports no false error for a Svelte 4 enum it can't strip", () => {
    // svelte-check transpiles the enum and warns; we can't, so we skip
    // the compile, rather than report the compiler's error on it.
    const { theirs, mine } = legacy("svelte4/enum");
    expect(theirs).toContainEqual(expect.stringContaining("A11y"));
    expect(mine).toContainEqual(
      "COMPLETED 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS",
    );
  }, 60_000);

  it("matches svelte-check with preprocessors", () => {
    const cwd = join(root, "tests/projects/preprocess");
    // svelte-check's css source (not supported) flags the custom style.
    const args = ["--diagnostic-sources", "js,svelte"];
    expect(ours(args, cwd)).toEqual(svelteCheck(args, cwd));
  }, 60_000);
});
