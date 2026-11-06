<script lang="ts">
  import SnippetChild from "./SnippetChild.svelte";
</script>

<SnippetChild title="a">
  {#snippet extra()}x{/snippet}
</SnippetChild>
<SnippetChild title="b">
  {#snippet titel()}y{/snippet}
</SnippetChild>
