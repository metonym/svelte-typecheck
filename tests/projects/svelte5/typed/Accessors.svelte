<svelte:options accessors />

<script lang="ts">
  export let count = 0;
  export const version = 1;
  export function reset() {
    count = 0;
  }
</script>

<p>{count}</p>
