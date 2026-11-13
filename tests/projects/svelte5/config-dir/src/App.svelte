<script lang="ts">
  import Child from "$lib/Child.svelte";

  let n: number = "a";
  const version: number = VERSION;
</script>

<Child label={n} />
<p>{version}</p>
