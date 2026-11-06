<script lang="ts">
  export let count = 0;
  export let label: string;
  let className: undefined | string = undefined;
  export { className as class };
  export const version = 1;
  export function reset() {}
</script>

<p {...$$restProps}>{label}{count}{className}</p>
