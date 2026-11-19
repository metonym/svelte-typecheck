// svelte-check and svelte-typecheck on the Svelte 5 projects that each
// cover a kind of component.
import { join } from "node:path";
import { ours, svelte5, svelteCheck } from "./parity.ts";

describe("svelte-check parity, machine output", () => {
  it("matches svelte-check with $$Props, $$Events, $$Slots, strictEvents and animate:", () => {
    const cwd = join(svelte5, "typed");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // Svelte's types declare every `*.svelte` module; svelte-check hides
  // that, so an import of a component that isn't there is an error.
  it("matches svelte-check with imports of components that aren't there", () => {
    const cwd = join(svelte5, "missing");
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

  // A `@typedef` moves to the top level, but a `@type` in its block
  // stays on the declaration below.
  it("keeps a `@type` beside a `@typedef` on its declaration", () => {
    const cwd = join(svelte5, "typedef-js");
    const expected = svelteCheck([], cwd);
    expect(ours([], cwd)).toEqual(expected);
    // TS 7 skips a tag on a JSDoc line with no `*`.
    expect(ours(["--checker", "tsgo"], cwd)).toEqual(expected);
  }, 60_000);

  it("matches svelte-check on a component's bind: directives", () => {
    const cwd = join(svelte5, "bind-shorthand");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // svelte-check reports an error at each use of a JS legacy component
  // with generics, even a valid one. Here it's generic, as the same
  // component in TS is in svelte-check.
  it("checks a generic JS legacy component as svelte-check does its TS form", () => {
    const cwd = join(svelte5, "generic-js-legacy");
    const errors = (lines: string[], file: string) =>
      lines
        .filter((line) => line.startsWith(`ERROR "${file}"`))
        .map((line) => line.replace(/^ERROR "\w+\.svelte" \d+:\d+ /, ""));
    const js = errors(ours([], cwd), "Use.svelte");
    expect(js.length).toBe(3);
    expect(js).toEqual(errors(svelteCheck([], cwd), "UseTs.svelte"));
    expect(errors(ours([], cwd), "UseTs.svelte")).toEqual(js);
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
    // The one warning svelte-check misses: a module's, which it doesn't
    // compile. `counter.svelte.ts` has a type error too, so the files
    // with problems are the same.
    const extra = `WARNING "counter.svelte.ts" 8:5 "This reference only captures the initial value of \`label\`. Did you mean to reference it inside a closure instead?\\nhttps://svelte.dev/e/state_referenced_locally"`;
    const mine = ours([], cwd);
    expect(mine).toContain(extra);
    expect(mine.filter((line) => line !== extra)).toEqual(
      svelteCheck([], cwd).map((line) =>
        line.replace(/ (\d+) WARNINGS/, (_, n) => ` ${Number(n) + 1} WARNINGS`),
      ),
    );
  }, 60_000);

  it("matches svelte-check on markup that doesn't parse, TypeScript in JS, no allowJs and a scss style", () => {
    const cwd = join(svelte5, "edge");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check on an element's on: directives", () => {
    const cwd = join(svelte5, "on-directive");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check on an element's repeated on: directives", () => {
    const cwd = join(svelte5, "repeated-on-directive");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // Each helper the generated code calls, failing, and a TS file that
  // uses components wrongly: every name the shims' types print.
  it("matches svelte-check where a message prints the shims' types", () => {
    const cwd = join(svelte5, "helpers");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check on a component's CSS custom properties", () => {
    const cwd = join(svelte5, "css-props");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);
});
