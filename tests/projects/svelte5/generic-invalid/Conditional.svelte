<script lang="ts" generics="T extends { a: number } ? 1 : 2">
  let { value }: { value: T } = $props();
</script>

{value}
