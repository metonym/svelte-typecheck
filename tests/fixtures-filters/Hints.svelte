<script lang="ts">
  const notAComponent = 42;
  declare const declared: number;
</script>

<svelte:component this={notAComponent} />
<p>{declared}</p>
