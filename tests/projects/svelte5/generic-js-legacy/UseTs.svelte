<script lang="ts">
  import LegacyTs from "./LegacyTs.svelte";
</script>

<LegacyTs value="a" items={["a"]} onpick={(v: "a") => v} />
<LegacyTs value="a" items={[1]} />
<LegacyTs value="a" items={["a"]} onpick={(v: "b") => v} />
