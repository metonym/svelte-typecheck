<script lang="ts">
  import Legacy from "./Legacy.svelte";
  import List from "./List.svelte";
  import Pick from "./Pick.svelte";
  import Handlers from "./Handlers.svelte";
  import Pattern from "./Pattern.svelte";

  const rows = [{ id: 1, name: "One" }];
</script>

<List items={rows} let:item let:index>{item.name.toUpperCase()} {index.toFixed()}</List>
<List items={rows} let:item>{item.nope}</List>
<List items={[{ name: "no id" }]} />
<List items={rows} selected={{ id: 2 }} />
<Legacy value={1} let:value>{value.toFixed()}</Legacy>
<Legacy value={true} />
<Pick items={["a", "b"]} picked="a" />
<Pick items={["a", "b"]} picked="c" />
<Handlers handlers={{ go: (x: number) => x }} name="go" />
<Handlers handlers={{ go: (x: number) => x }} name="stop" />
<Pattern pair="a=b" />
<Pattern pair="ab" />
