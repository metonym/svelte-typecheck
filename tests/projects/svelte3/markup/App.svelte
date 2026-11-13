<script lang="ts">
  let x: number = 0;
</script>

<button on:click={(e: MouseEvent) => (x = e.detail)}>{x}</button>
<p>{x as number}</p>
