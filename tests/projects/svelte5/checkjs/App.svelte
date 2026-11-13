<script>
  import { count } from "./count.svelte.js";
  import { n } from "./util.js";

  /** @type {number} */
  let label = "a";
</script>

<p>{label} {n} {count.value}</p>
