<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { flip } from "svelte/animate";

  interface $$Props {
    count: number;
    label?: string;
  }
  interface $$Events {
    change: CustomEvent<number>;
  }
  interface $$Slots {
    default: { item: number };
  }

  export let count: number;
  export let label = "";
  const dispatch = createEventDispatcher();
  const items = [1, 2];
</script>

{#each items as item (item)}
  <div animate:flip={{ duration: 100 }}>{label}</div>
  <button type="button" on:click={() => dispatch("change", count)}>+</button>
{/each}
<slot item={count} />
