<script module lang="ts">
  export { row, label };
</script>

<script lang="ts">
  let { n = 1 }: { n?: number } = $props();
  let count = $state(0);
</script>

{#snippet row(x: number)}
  <span>{x.toFixed()}{label("a")}</span>
{/snippet}

{#snippet label(text: string)}
  <b>{text.toUpperCase()}{text.nope}</b>
{/snippet}

{#snippet counted()}
  <span>{count}{count.nope}</span>
{/snippet}

{#snippet pick<T extends Nope>(x: T)}
  <span>{x}</span>
{/snippet}

{@render row(n)}
{@render counted()}
{@render pick("a")}
