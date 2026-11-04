<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { flip } from "svelte/animate";
  import Runes from "./Runes.svelte";

  export let count = 0;
  export let label: string;

  const notAStore = 1;
  const items = 42;
  const dispatch = createEventDispatcher<{ change: number }>();
  dispatch("change", "one");
  dispatch("other", 1);

  $: doubled = count * 2;
  $: doubled = "two";

  function badAction(node: HTMLElement, param: number) {
    return 1;
  }
  function goodAction(node: HTMLInputElement, param: number) {
    return { update(p: number) {}, destroy() {} };
  }
  function badTransition(node: Element) {
    return 1;
  }
  function badAnimation(node: Element, args: { from: DOMRect; to: DOMRect }) {
    return { duration: "slow" };
  }
  const notAComponent = 42;
  const notASnippet = 1;
  let text = "";
</script>

<p>{$notAStore}</p>
{#each items as item}<p>{item}</p>{/each}
<div use:badAction={1}></div>
<div use:goodAction={"x"}></div>
<div transition:badTransition></div>
{#each [1, 2] as n (n)}<div animate:badAnimation>{n}</div>{/each}
{#each [1, 2] as n (n)}<div animate:flip={{ delay: "x" }}>{n}</div>{/each}
<svelte:component this={notAComponent} />
<svelte:component this={Runes} title={1} />
<input bind:value={() => 1, (v: string) => (text = v)} />
<button on:click>{label}{doubled}{$$restProps.nope}{$$props.label}</button>
<slot name="footer" item={1} />
