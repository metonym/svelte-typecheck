<script lang="ts">
  import Legacy from "./Legacy.svelte";
</script>

<Legacy value="a" items={["a"]} onpick={(v: "a") => v} />
<Legacy value="a" items={[1]} />
<Legacy value="a" items={["a"]} onpick={(v: "b") => v} />
