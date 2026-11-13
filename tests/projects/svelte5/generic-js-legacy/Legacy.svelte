<script generics="T extends string">
  /** @type {T} */
  export let value;
  /** @type {T[]} */
  export let items;
  /** @type {((value: T) => void) | undefined} */
  export let onpick = undefined;
</script>

{value}{items}{onpick}
