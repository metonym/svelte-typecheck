import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "../tests/projects/svelte5/basic");
const CORPUS = join(import.meta.dirname, "corpus");
/** Pairs of each kind: 2 kinds × 2 components × SIZE. */
const SIZE = 100;
/** Bumped when the corpus changes, so an old one is written again. */
const VERSION = "2";

/** A Svelte 5 runes child, with a bindable prop, a derived value and a snippet prop. */
const RUNES_CHILD = `<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    count = $bindable(0),
    children,
  }: { label: string; count?: number; children?: Snippet<[number]> } = $props();
  const double = $derived(count * 2);
</script>

<button type="button" onclick={() => count++}>{label} {double}</button>
{@render children?.(count)}
`;

/** Its parent: state, a bound prop, a snippet passed and one rendered. */
const runesPage = (i: number) => `<script lang="ts">
  import RunesChild from "./RunesChild${i}.svelte";

  let count = $state(1);
  const items = $state(["a", "b"]);
</script>

{#snippet row(item: string)}
  <li>{item}</li>
{/snippet}

<RunesChild label="Count" bind:count>
  {#snippet children(n)}
    <span>{n.toFixed()}</span>
  {/snippet}
</RunesChild>
<ul>
  {#each items as item}
    {@render row(item)}
  {/each}
</ul>
`;

/** The corpus's component names: legacy pairs, then runes pairs. */
const NAMES = [
  ...Array.from({ length: SIZE }, (_, i) => [`Page${i}`, `Child${i}`]),
  ...Array.from({ length: SIZE }, (_, i) => [
    `RunesPage${i}`,
    `RunesChild${i}`,
  ]),
].flat();

/**
 * Writes the corpus to `bench/corpus`: `SIZE` copies of the clean
 * fixtures (a component that uses a child's props, events, slots,
 * stores and bindings, and the child), and `SIZE` runes pairs, each
 * under its own names. No errors or warnings, so a run measures
 * checking, not reporting.
 */
export async function corpus(): Promise<string> {
  const marker = join(CORPUS, ".version");
  if (existsSync(marker) && (await readFile(marker, "utf-8")) === VERSION)
    return CORPUS;
  await rm(CORPUS, { recursive: true, force: true });
  const [child, clean, tsconfig] = await Promise.all(
    ["Child.svelte", "Clean.svelte", "tsconfig.json"].map((f) =>
      readFile(join(FIXTURES, f), "utf-8"),
    ),
  );
  await mkdir(CORPUS, { recursive: true });
  const writes = [writeFile(join(CORPUS, "tsconfig.json"), tsconfig ?? "")];
  for (let i = 0; i < SIZE; i++)
    writes.push(
      writeFile(join(CORPUS, `Child${i}.svelte`), child ?? ""),
      writeFile(
        join(CORPUS, `Page${i}.svelte`),
        (clean ?? "").replaceAll("./Child.svelte", `./Child${i}.svelte`),
      ),
      writeFile(join(CORPUS, `RunesChild${i}.svelte`), RUNES_CHILD),
      writeFile(join(CORPUS, `RunesPage${i}.svelte`), runesPage(i)),
    );
  await Promise.all(writes);
  await writeFile(marker, VERSION);
  return CORPUS;
}

/**
 * The corpus, with a SvelteKit vite.config, in `bench/corpus-vite`: the
 * compiler's pass loads it through Vite, as for most projects.
 */
export async function viteCorpus(): Promise<string> {
  const dir = join(import.meta.dirname, "corpus-vite");
  const marker = join(dir, ".version");
  if (existsSync(marker) && (await readFile(marker, "utf-8")) === VERSION)
    return dir;
  await rm(dir, { recursive: true, force: true });
  await cp(await corpus(), dir, { recursive: true });
  await Promise.all([
    writeFile(
      join(dir, "vite.config.ts"),
      'import { sveltekit } from "@sveltejs/kit/vite";\n\nexport default { plugins: [sveltekit()] };\n',
    ),
    writeFile(
      join(dir, "package.json"),
      '{ "name": "corpus-vite", "private": true, "type": "module" }\n',
    ),
  ]);
  return dir;
}

/** A JS child with JSDoc types, as carbon-components-svelte writes them. */
const JSDOC_CHILD = `<script>
  import { createEventDispatcher } from "svelte";

  /**
   * @typedef {"primary" | "ghost"} Kind
   * @typedef {{ value: string }} ChangeDetail
   * @restProps {button}
   */

  /** @type {Kind} */
  export let kind = "primary";

  /** @type {number} */
  export let count = 0;

  /** @type {import("svelte").EventDispatcher<{ change: ChangeDetail }>} */
  const dispatch = createEventDispatcher();
</script>

<button type="button" {...$$restProps} on:click={() => dispatch("change", { value: kind })}>
  {count}
</button>
<slot />
`;

/** Its parent, in JS: a JSDoc callback type and the child's event. */
const jsdocPage = (i: number) => `<script>
  import JsdocChild from "./JsdocChild${i}.svelte";

  /**
   * @callback Format
   * @param {number} n
   * @returns {string}
   * @type {Format}
   */
  const format = (n) => n.toFixed(0);
  let last = "";
</script>

<JsdocChild kind="ghost" count={1} on:change={(e) => (last = e.detail.value)}>
  {format(2)} {last}
</JsdocChild>
`;

/** A Svelte 5 runes child in JS: a \`@typedef\` and the \`@type\` of its props. */
const JSDOC_RUNES_CHILD = `<script>
  /**
   * @typedef {{ label: string, count?: number }} Props
   */

  /** @type {Props} */
  let { label, count = $bindable(0) } = $props();
  const double = $derived(count * 2);
</script>

<button type="button" onclick={() => count++}>{label} {double}</button>
`;

/** Its parent, in JS. */
const jsdocRunesPage = (i: number) => `<script>
  import JsdocRunesChild from "./JsdocRunesChild${i}.svelte";

  /** @type {number} */
  let count = $state(1);
</script>

<JsdocRunesChild label="Count" bind:count />
`;

const JS_TSCONFIG = `{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "allowJs": true,
    "checkJs": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["."]
}
`;

/** Writes a corpus to `dir` from `[file, source]` pairs, once per version. */
async function write(
  dir: string,
  files: () => Promise<[string, string][]>,
): Promise<string> {
  const marker = join(dir, ".version");
  if (existsSync(marker) && (await readFile(marker, "utf-8")) === VERSION)
    return dir;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await Promise.all(
    (await files()).map(([file, source]) => writeFile(join(dir, file), source)),
  );
  await writeFile(marker, VERSION);
  return dir;
}

/**
 * JS components with JSDoc types, in `bench/corpus-jsdoc`: `SIZE` legacy
 * pairs and `SIZE` runes pairs, checked with `checkJs`. Each moves its
 * `@typedef` tags out of the component's scope.
 */
export function jsdocCorpus(): Promise<string> {
  return write(join(import.meta.dirname, "corpus-jsdoc"), async () => [
    ["tsconfig.json", JS_TSCONFIG],
    ...Array.from({ length: SIZE }, (_, i): [string, string][] => [
      [`JsdocChild${i}.svelte`, JSDOC_CHILD],
      [`JsdocPage${i}.svelte`, jsdocPage(i)],
      [`JsdocRunesChild${i}.svelte`, JSDOC_RUNES_CHILD],
      [`JsdocRunesPage${i}.svelte`, jsdocRunesPage(i)],
    ]).flat(),
  ]);
}

/**
 * The corpus's legacy pairs, twice over, in `bench/corpus-svelte4`, for
 * Svelte 4: its markup is parsed again with Svelte 4's own parser, and
 * its compiler reads each component.
 */
export async function svelte4Corpus(): Promise<string> {
  const dir = join(import.meta.dirname, "corpus-svelte4");
  return write(dir, async () => {
    // Its imports of svelte resolve to Svelte 4, as in a Svelte 4 project.
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await symlink(
      join(import.meta.dirname, "node_modules/svelte4"),
      join(dir, "node_modules/svelte"),
      "junction",
    );
    const [child, clean, tsconfig] = await Promise.all(
      ["Child.svelte", "Clean.svelte", "tsconfig.json"].map((f) =>
        readFile(join(FIXTURES, f), "utf-8"),
      ),
    );
    return [
      ["tsconfig.json", tsconfig ?? ""],
      ...Array.from({ length: SIZE * 2 }, (_, i): [string, string][] => [
        [`Child${i}.svelte`, child ?? ""],
        [
          `Page${i}.svelte`,
          (clean ?? "").replaceAll("./Child.svelte", `./Child${i}.svelte`),
        ],
      ]).flat(),
    ];
  });
}

/** The corpus's components, as `[name, source]`. */
export async function sources(): Promise<[string, string][]> {
  const dir = await corpus();
  return Promise.all(
    NAMES.map(async (name): Promise<[string, string]> => [
      name,
      await readFile(join(dir, `${name}.svelte`), "utf-8"),
    ]),
  );
}
