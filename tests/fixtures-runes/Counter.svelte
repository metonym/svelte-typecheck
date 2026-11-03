<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    start?: number;
    label: string;
    value?: number;
    children?: Snippet<[number]>;
    onchange?: (n: number) => void;
  }

  let { start = 0, label, value = $bindable(0), children, onchange }: Props = $props();
  let count = $state(start);
  const double = $derived(count * 2);
  const id = $props.id();
  $effect(() => {
    onchange?.(count);
  });
  export function reset() {
    count = 0;
  }
</script>

{#snippet row(n: number)}
  <span>{n.toFixed()}</span>
{/snippet}

<button {id} onclick={() => count++}>{label} {double}</button>
{@render row(count)}
{@render children?.(count)}
