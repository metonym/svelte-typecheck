import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "../tests/fixtures");
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
