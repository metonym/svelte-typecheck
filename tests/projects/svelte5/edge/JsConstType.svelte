<script>
  let xs = [1];
</script>

{#each xs as x}{@const n: number = x}{n}{/each}
