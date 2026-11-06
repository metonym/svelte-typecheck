<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, value = $bindable(""), fixed = 0, children }: { title: string; value?: string; fixed?: number; children?: Snippet<[number]> } = $props();
  const notASnippet = 1;
</script>

{@render notASnippet()}
{@render children?.("x")}
<p>{title}{value}{fixed}</p>
