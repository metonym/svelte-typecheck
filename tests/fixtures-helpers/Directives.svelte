<script lang="ts">
  function onInput(node: HTMLInputElement, param?: number) {}
  function needsParam(node: HTMLElement, param: number) {}
  function fadeInput(node: HTMLInputElement, params?: { delay: number }) {
    return {};
  }
  function fadeNeeds(node: Element, params: { delay: number }) {
    return {};
  }
  function moveInput(node: HTMLInputElement, move: { from: DOMRect; to: DOMRect }, params?: { delay: number }) {
    return {};
  }
  function moveNeeds(node: Element, move: { from: DOMRect; to: DOMRect }, params: { delay: number }) {
    return {};
  }
  declare const nope: number;
</script>

<div use:onInput></div>
<div use:onInput={1}></div>
<div use:needsParam></div>
<span transition:fadeInput></span>
<span in:fadeInput={{ delay: 1 }}></span>
<span out:fadeNeeds></span>
{#each [1] as n (n)}<p animate:moveInput>{n}</p>{/each}
{#each [1] as n (n)}<p animate:moveInput={{ delay: 1 }}>{n}</p>{/each}
{#each [1] as n (n)}<p animate:moveNeeds>{n}</p>{/each}
