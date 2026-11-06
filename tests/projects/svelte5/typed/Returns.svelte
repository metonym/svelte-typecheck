<script lang="ts">
  function badTransition(node: Element, params: { delay: number }) {
    return 1;
  }
  function badAnimation(node: Element, move: { from: DOMRect; to: DOMRect }, params: { delay: number }) {
    return { duration: "slow" };
  }
</script>

<div transition:badTransition={{ delay: 1 }}></div>
{#each [1, 2] as n (n)}<div animate:badAnimation={{ delay: 1 }}>{n}</div>{/each}
