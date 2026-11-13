<script>
  /** @typedef {{ n: number }} Detail */
  import { onMount } from "svelte";
  // @ts-expect-error
  import Pic from "./pic.png";

  /** @type {Detail} */
  const detail = { n: "x" };
  onMount(() => {});
</script>

<img src={Pic} alt={String(detail.n)} />
