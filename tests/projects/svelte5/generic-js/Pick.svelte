<script generics="T extends string">
  /** @type {{ value: T; items: T[]; onpick?: (value: T) => void }} */
  let { value, items, onpick } = $props();
</script>

{value} {items.length} {onpick}
