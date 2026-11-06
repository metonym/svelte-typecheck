<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { flip } from "svelte/animate";
  import Strict from "./Strict.svelte";
  import Typed from "./Typed.svelte";

  interface $$Events {
    change: CustomEvent<number>;
  }
  interface $$Slots {
    default: { item: number };
  }

  const dispatch = createEventDispatcher();
  dispatch("change", "not a number");
</script>

<Typed count="one" />
<Typed count={1} on:change={(e) => e.detail.toFixed(0).nope} />
<Typed count={1} let:item>{item.nope}</Typed>
<Strict on:other={() => {}} />
<div animate:flip={{ duration: "slow" }}></div>
<slot item="not a number" />
