<script lang="ts">
  let className: undefined | string = undefined;
  export { className as class };
</script>

<!-- `string` has no `nope`: TypeScript says so once the prop is widened. -->
<div class={className.nope}></div>
