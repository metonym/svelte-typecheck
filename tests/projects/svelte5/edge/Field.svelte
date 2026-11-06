<script lang="ts">
  let { value = $bindable(0) }: { value?: number } = $props();
</script>

<input bind:value />
