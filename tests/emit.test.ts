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
});
