<script lang="ts">
  import { box } from "./counter.svelte";
  import { twice } from "./plain.svelte.js";
  import { Color } from "./colors.svelte";
</script>

{box.n}{twice}{Color.Red}
