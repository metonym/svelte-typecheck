<script lang="ts" strictEvents>
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{ save: string }>();
</script>

<button type="button" on:click={() => dispatch("save", "x")}>Save</button>
