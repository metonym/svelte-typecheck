<script lang="ts">
  let x = 0;
</script>

<button on:click={() => (x = 1)} on:click={1}>a</button>
<button on:click={1} on:click={() => (x = 2)}>b</button>
<button on:click={() => (x = 3)} on:click={1} on:click={() => (x = 4)}>c</button>
<button on:click={() => (x = 5)} on:click={() => (x = 6)} on:click={1}>d</button>
<button on:click={"e"} on:keydown={() => (x = 7)} on:click={1}>e</button>
<button on:click={() => (x = 8)} on:click={() => (x = 9)}>f</button>
<div on:highlighted={() => (x = 10)} on:highlighted={() => (x = 11)}>g</div>
<svelte:window on:keydown={() => (x = 12)} on:keydown={1} />
{x}
