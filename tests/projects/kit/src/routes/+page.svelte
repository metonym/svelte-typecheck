<script lang="ts">
  import Card from "$lib/Card.svelte";
  import { site } from "$lib";
  import Badge from "#lib/Card.svelte";

  let { data, form } = $props();
  const n: number = data.posts;
  const s: string = site;
</script>

<Card title={data.posts.length} />
<p>{form?.missing}{s}{n}</p>
<Badge title={2} />
