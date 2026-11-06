import { emit } from "../src/emit.ts";

/** Where `needle` lands in the generated code, mapped back to the source. */
const roundTrip = (source: string, needle: string) => {
  const { out } = emit(source);
  return out.toSource(out.code.indexOf(needle));
};

describe("emit", () => {
  it("maps a markup expression back to its own offset", () => {
    const source = `<script lang="ts">\n  export let item = { text: "" };\n</script>\n\n<span>{item.text}</span>\n`;
    expect(roundTrip(source, "item.text")).toBe(source.indexOf("item.text"));
  });

  it("maps a component's props object to its tag", () => {
    const source = `<script lang="ts">\n  import Button from "./Button.svelte";\n</script>\n\n<Button kind="ghost" />\n`;
    expect(roundTrip(source, "props: {")).toBe(source.indexOf("Button kind"));
  });

  it("drops errors in code it generates", () => {
    const { out } = emit("<script>\n  let a = 1;\n</script>\n");
    expect(out.toSource(out.code.indexOf("$$check.props"))).toBe(null);
  });

  it("declares a reactive assignment with its value's type", () => {
    const { out } = emit(
      `<script lang="ts">\n  export let a = 1;\n  $: double = a * 2;\n</script>\n`,
    );
    expect(out.code).toContain("let double = $$check.reactive(() => (a * 2));");
  });

  it("widens a prop as svelte2tsx does: with no default, a type or a boolean default", () => {
    const { out } = emit(
      `<script lang="ts">
  export let a = 1;
  export let b: number = 1;
  export let c = false;
  export let d;
</script>
`,
    );
    expect(out.code).not.toContain("a = $$check.any(a);");
    expect(out.code).toContain("b = $$check.any(b);");
    expect(out.code).toContain("c = $$check.any(c);");
    expect(out.code).toContain("d = $$check.any(0);");
  });

  it("checks a repeated event handler in a call of its own", () => {
    const { out } = emit("<button on:click on:click={() => {}}>x</button>\n");
    const calls = out.code.match(/svelteHTML\.createElement\("button"/g);
    expect(calls).toHaveLength(2);
  });

  it("writes `generics` as JSDoc in a JS component", () => {
    const { out } = emit(
      `<script generics="Node extends { id: string } = { id: string }">\n  export let node = undefined;\n</script>\n`,
    );
    expect(out.code).toContain(
      " * @template {{ id: string }} [Node={ id: string }]",
    );
    expect(out.code).not.toContain("$$render<");
  });

  it("types a Svelte 3 component as a class, without a `children` prop", () => {
    const source = `<script>\n  import Box from "./Box.svelte";\n</script>\n\n<Box>x</Box>\n`;
    const svelte3 = emit(source, { svelte: 3 }).out.code;
    expect(svelte3).toContain("SvelteComponentTyped<");
    expect(svelte3).not.toContain("children:");
    expect(emit(source).out.code).toContain("children:");
  });

  describe("leaves out code that can't report anything", () => {
    it("calls no createElement for an element whose attributes write nothing", () => {
      const { code } = emit(
        '<script>\n  import A from "./A.svelte";\n</script>\n<p>{1}</p>\n<clipPath></clipPath>\n<span data-a="x"></span>\n<A><em slot="s">x</em></A>\n<div class="a"></div>\n',
      ).out;
      for (const tag of ["p", "clipPath", "span", "em"])
        expect(code).not.toContain(`createElement("${tag}"`);
      expect(code).toContain('createElement("div", {"class":"a",})');
    });

    it("keeps it for a custom element, whose attributes can be required", () => {
      expect(emit("<my-el></my-el>\n").out.code).toContain(
        'createElement("my-el", {})',
      );
    });

    it("names an element only for `bind:this`", () => {
      const { code } = emit(
        '<script>\n  let el;\n</script>\n<div bind:this={el}></div>\n<div class="a"></div>\n',
      ).out;
      expect(code.match(/const \$\$_el\d+ = /g)).toHaveLength(1);
      expect(code).toMatch(/el = \$\$_el\d+;/);
    });

    it("names a component's instance only for what reads it", () => {
      const named = (markup: string) =>
        /const \$\$_c\d+ = new/.test(
          emit(
            `<script>\n  import A from "./A.svelte";\n  let v;\n</script>\n${markup}\n`,
          ).out.code,
        );
      expect(named("<A x={1} />")).toBe(false);
      expect(named("<A on:go={() => {}} />")).toBe(true);
      expect(named("<A bind:v />")).toBe(true);
      // Svelte 4 doesn't check that a bound prop is bindable.
      const svelte4 = emit(
        '<script>\n  import A from "./A.svelte";\n  let v;\n</script>\n<A bind:v />\n',
        { svelte: 4 },
      ).out.code;
      expect(svelte4).not.toMatch(/const \$\$_c\d+ = new/);
      expect(named("<A let:item>{item}</A>")).toBe(true);
      expect(named('<A><p slot="s">x</p></A>')).toBe(true);
    });

    it("declares `$$props`, `$$restProps` and `$$slots` only where they're used", () => {
      const declared = (source: string) =>
        [...emit(source).out.code.matchAll(/let (\$\$\w+) = \$\$check/g)].map(
          (m) => m[1],
        );
      expect(declared("<script>\n  export let a;\n</script>\n{a}\n")).toEqual(
        [],
      );
      expect(
        declared("<div {...$$restProps}>{#if $$slots.x}x{/if}</div>\n"),
      ).toEqual(["$$restProps", "$$slots"]);
      // Not a longer name that starts with one.
      expect(declared("<script>\n  let $$propsx;\n</script>\n")).toEqual([]);
    });

    it("passes slot content and the target as one shared value each", () => {
      const { code } = emit(
        '<script>\n  import A from "./A.svelte";\n</script>\n<A>x</A>\n',
      ).out;
      expect(code).toContain("target: $$check.target");
      expect(code).toContain("children:$$check.children");
    });

    it("drops a `data-` attribute with no expression, and checks one with", () => {
      const { code } = emit(
        '<div data-a="x" data-b data-c={1 + 1}></div>\n',
      ).out;
      expect(code).not.toContain('"data-a"');
      expect(code).not.toContain('"data-b"');
      expect(code).toContain('...$$check.none({"data-c":(1 + 1)})');
    });
  });
});
