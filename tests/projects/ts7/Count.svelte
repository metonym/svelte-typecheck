<script lang="ts">
  let { count = 0 }: { count?: number } = $props();
  const label: string = count;
</script>

<p>{label}</p>
