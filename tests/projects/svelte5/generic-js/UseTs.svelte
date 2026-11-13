<script lang="ts">
  import Pick from "./Pick.svelte";
</script>

<Pick value="a" items={["a"]} />
<Pick value="a" items={["b"]} />
<Pick value="a" items={[1]} />
<Pick value="a" items={["a"]} onpick={(v: "b") => v} />
<Pick value="a" items={["a"]} onpick={(v: "a") => v} />
