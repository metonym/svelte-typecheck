<script lang="ts">
  import { writable } from "svelte/store";

  const notAStore = 1;
  const count = writable(0);
  let a = 1;
  let b = 2;
  $: a, b;
  $: if (a) b = 3;
  $: console.log($notAStore);

  function custom(node: Element, params: { delay: number }, options: { direction: string }) {
    return { delay: params.delay, duration: options.direction.length };
  }
</script>

<div transition:custom={{ delay: 1 }}>{$count}</div>
