<script lang="ts" generics="const T extends readonly string[]">
  let { items, picked }: { items: T; picked: T[number] } = $props();
</script>

{items.length} {picked}
