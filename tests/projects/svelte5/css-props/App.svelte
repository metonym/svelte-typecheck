<script lang="ts">
  import Child from "./Child.svelte";
  let width = 1;
</script>

<Child --border-radius="12px" size="x" />
<Child --gap="1px" foo="x" />
<Child --width="{width}px" --color={nope} />
