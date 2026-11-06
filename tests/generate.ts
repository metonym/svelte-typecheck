import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * How the generated components import each other:
 *
 * - `pairs`: each parent imports its own child, and nothing else;
 * - `chain`: each component imports the next, one chain through them all;
 * - `hub`: every component imports one `Hub.svelte`;
 * - `barrel`: an `index.ts` re-exports every component, and each imports
 *   the next one through it, as a component library does.
 */
export type Shape = "pairs" | "chain" | "hub" | "barrel";

export interface GenerateOptions {
  /** How many components, the hub's included. */
  components: number;
  shape: Shape;
  /** Errors planted in each component's script. Default 0. */
  errors?: number;
}

/** An error the generator planted, where svelte-check reports it. */
export interface Planted {
  file: string;
  line: number;
  column: number;
  code: string;
}

const TSCONFIG = {
  compilerOptions: {
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["."],
};

/** Every third component is legacy: `export let`, slots and `on:`. */
const isLegacy = (i: number) => i % 3 === 2;

/** The component, importing `next` (a component's name) from `from`. */
function component(
  i: number,
  next: { name: string; from: string } | undefined,
  errors: number,
): string {
  const lines = ['<script lang="ts">'];
  if (next)
    lines.push(
      next.from.endsWith(".svelte")
        ? `  import ${next.name} from "${next.from}";`
        : `  import { ${next.name} } from "${next.from}";`,
    );
  if (isLegacy(i))
    lines.push(
      "  export let label: string;",
      "  export let count = 0;",
      `  $: double = count * 2;`,
    );
  else
    lines.push(
      "  let { label, count = $bindable(0) }: { label: string; count?: number } = $props();",
      "  const double = $derived(count * 2);",
    );
  for (let e = 0; e < errors; e++)
    lines.push(`  const planted${e}: number = "not a number";`);
  lines.push(
    '  const items = ["a", "b", "c"];',
    "</script>",
    "",
    `<section data-index="${i}">`,
    "  <h2>{label} {double}</h2>",
    "  {#each items as item}",
    "    <p>{item.toUpperCase()}</p>",
    "  {/each}",
  );
  if (next) lines.push(`  <${next.name} label="next" bind:count />`);
  lines.push(
    isLegacy(i)
      ? '  <button on:click={() => count++}>+</button>\n  <slot name="footer" {count} />'
      : "  <button onclick={() => count++}>+</button>",
    "</section>",
    "",
  );
  return lines.join("\n");
}

/** The line of a component's `e`th planted error. */
const plantedLine = (i: number, hasImport: boolean, e: number) =>
  1 + (hasImport ? 1 : 0) + (isLegacy(i) ? 3 : 2) + e + 1;

/**
 * Writes a project of `components` Svelte components to `dir`, all of
 * them TypeScript, two runes components to each legacy one, and returns
 * the errors it planted. The same options write the same project.
 */
export async function generate(
  dir: string,
  { components, shape, errors = 0 }: GenerateOptions,
): Promise<Planted[]> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const name = (i: number) => `C${i}`;
  const files = new Map<string, string>();
  const planted: Planted[] = [];
  const add = (i: number, next?: { name: string; from: string }) => {
    files.set(`${name(i)}.svelte`, component(i, next, errors));
    for (let e = 0; e < errors; e++)
      planted.push({
        file: `${name(i)}.svelte`,
        line: plantedLine(i, next !== undefined, e),
        column: 9,
        code: "TS2322",
      });
  };
  if (shape === "hub") {
    files.set("Hub.svelte", component(0, undefined, 0));
    for (let i = 1; i < components; i++)
      add(i, { name: "Hub", from: "./Hub.svelte" });
  } else
    for (let i = 0; i < components; i++) {
      const last = i === components - 1;
      if (shape === "pairs")
        add(
          i,
          i % 2 === 0 && !last
            ? { name: name(i + 1), from: `./${name(i + 1)}.svelte` }
            : undefined,
        );
      else if (shape === "chain")
        add(
          i,
          last
            ? undefined
            : { name: name(i + 1), from: `./${name(i + 1)}.svelte` },
        );
      else add(i, last ? undefined : { name: name(i + 1), from: "./index.js" });
    }
  if (shape === "barrel")
    files.set(
      "index.ts",
      Array.from(
        { length: components },
        (_, i) =>
          `export { default as ${name(i)} } from "./${name(i)}.svelte";`,
      ).join("\n") + "\n",
    );
  files.set("tsconfig.json", `${JSON.stringify(TSCONFIG, null, 2)}\n`);
  await Promise.all(
    [...files].map(([file, text]) => writeFile(join(dir, file), text)),
  );
  return planted;
}
