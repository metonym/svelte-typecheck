<script lang="ts">
  import Legacy from "./Legacy.svelte";
  import Typed from "./Typed.svelte";
  import Runes from "./Runes.svelte";
  let fixed = 0;
  let v = 1;
</script>

<Legacy count="one" on:change={(e) => e.detail.nope} on:click={(e) => e.nope} on:other={(e) => e.detail.nope} let:item>{item}</Legacy>
<Legacy label="x"><span slot="footer" let:item>{item.nope}</span></Legacy>
<Typed size={1} on:change={(e) => e.detail.nope} let:item>{item.nope}</Typed>
<Typed size="big" />
<Runes title={1} bind:fixed bind:value={v}>
  {#snippet children(n: string)}{n}{/snippet}
</Runes>
<Runes />
