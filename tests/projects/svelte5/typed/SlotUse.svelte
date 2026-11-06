<script lang="ts">
  import SlotChild from "./SlotChild.svelte";
  let value = 1;
</script>

<SlotChild let:item />
<SlotChild><span slot="footer" let:total>{total}</span></SlotChild>
<SlotChild><span slot="nope">x</span></SlotChild>
<SlotChild><span slot="nope" let:x>{x}</span></SlotChild>
<SlotChild><svelte:fragment let:y slot="nope">{y}</svelte:fragment></SlotChild>
<SlotChild><SlotChild slot="nope" bind:value /></SlotChild>
