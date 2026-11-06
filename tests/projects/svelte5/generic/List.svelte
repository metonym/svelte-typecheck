<script lang="ts" generics="T extends { id: number }">
  export let items: T[];
  export let selected: T | undefined = undefined;
</script>

{#each items as item, index}
  <slot {item} {index} active={item === selected} />
{/each}
