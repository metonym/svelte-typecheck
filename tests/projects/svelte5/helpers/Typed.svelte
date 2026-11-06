<script lang="ts">
  import { createEventDispatcher } from "svelte";

  interface $$Props {
    size: number;
    tone?: string;
  }
  interface $$Events {
    change: CustomEvent<number>;
  }
  interface $$Slots {
    default: { item: number };
    footer: { total: string };
  }
  export let size: string;
  export let tone = "light";

  const dispatch = createEventDispatcher();
  dispatch("change", "x");
</script>

<slot item="one" />
<slot name="footer" total={2} />
<slot name="missing" />
