<script lang="ts">
  import Gone from "./lib/Gone.svelte";
  import Real from "./lib/Real.svelte";
  import Aliased from "$lib/Real.svelte";
  import AliasedGone from "$lib/AlsoGone.svelte";
  import Declared from "$lib/Declared.svelte";
  import { count } from "./lib/counter.svelte";
  import "./lib/SideEffect.svelte";
  // @ts-expect-error: it's gone
  import Expected from "./lib/Expected.svelte";
  // @ts-ignore
  import Ignored from "./lib/Ignored.svelte";
  const lazy = import("./lib/Lazy.svelte");
</script>

<Gone />
<Real label="a" />
<Aliased label="b" />
<AliasedGone />
<Declared label="c" />
<Expected />
<Ignored />
{count.value}
{#await lazy then m}<m.default />{/await}
