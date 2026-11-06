<script lang="ts">
  import Field from "./Field.svelte";

  const state = $state({ n: 1 as number | string });
</script>

<Field bind:value={state.n as number} />
<input bind:value={state.n as string} />
<p>{state.n.nope}</p>
