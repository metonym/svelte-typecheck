<script lang="ts">
  import { onMount } from "svelte";
  // @ts-expect-error
  import Pic from "./pic.png?w=100";
  // @ts-expect-error no types
  import * as z from "not-there";
  // A comment that isn't a directive.
  import missing from "./missing";
  // @ts-ignore
  import other from "also-not-there";
  // @ts-expect-error
  let n: number = "a";
  // @ts-expect-error
  let unused = 1;
  onMount(() => {});
</script>

<img src={Pic} alt={String(z) + n + unused + missing + other} />
