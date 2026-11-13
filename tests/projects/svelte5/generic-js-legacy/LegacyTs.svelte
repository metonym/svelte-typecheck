<script lang="ts" generics="T extends string">
  export let value: T;
  export let items: T[];
  export let onpick: ((value: T) => void) | undefined = undefined;
</script>

{value}{items}{onpick}
