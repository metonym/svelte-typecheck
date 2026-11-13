<script>
  import Pick from "./Pick.svelte";
</script>

<Pick value="a" items={[1]} />
<Pick value="a" items={["a"]} onpick={(/** @type {"b"} */ v) => v} />
