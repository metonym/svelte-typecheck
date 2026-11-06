<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  let { items, item }: { items: T[]; item: Snippet<[T]> } = $props();
</script>

{#each items as entry}
  {@render item(entry)}
{/each}
