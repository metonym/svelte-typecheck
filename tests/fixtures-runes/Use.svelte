<script lang="ts">
  import Counter from "./Counter.svelte";
  import Documented from "./Documented.svelte";
  import Inferred from "./Inferred.svelte";
  import List from "./List.svelte";
  import Loose from "./Loose.svelte";
  import Loaded from "./Loaded.svelte";
  import Rows, { row as exportedRow } from "./Rows.svelte";
  import { counter } from "./counter.svelte.js";

  let v = $state(1);
  let text = $state("");
  let c: Counter;
  const store = counter(1);
  const total: string = store.count;
  function attach(node: HTMLInputElement) {
    node.select();
  }
  function notSnippet() {}

  $effect(() => {
    c.reset(1);
  });
</script>

{#snippet row(n: number)}
  <span>{n.toFixed()}</span>
{/snippet}

<Counter label="x" bind:value={v} bind:this={c} />
<Counter label={1} bind:start={v} />
<Counter />
<Counter label="y" bind:value={() => text, (n) => (text = n)}>
  {#snippet children(n)}{n.toUpperCase()}{/snippet}
</Counter>
<Inferred a={1} b="x" c={2} bind:d={v} extra />
<Documented size="1" />
<List items={[1, 2]}>
  {#snippet item(n)}{n.toFixed()}{/snippet}
</List>
<List items={["a"]} item={row} />
<div {@attach attach}></div>
<section class="s" {@attach attach}></section>
<input bind:value={() => v, (s: string) => (v = s)} />
<svelte:boundary onerror={(e: string) => e}>
  <p>{total}</p>
  {#snippet failed(error, reset)}<button onclick={reset}>{error}</button>{/snippet}
</svelte:boundary>
{@render row("1")}
{@render notSnippet()}
<Loose a={1} b="x" bind:c={text} />
<Loaded url={1} />
<Rows n="2" />
{@render exportedRow("x")}
