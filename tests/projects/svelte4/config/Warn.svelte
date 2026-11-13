<script lang="ts">
  export let name: string;
  const count: number = name;
</script>

<img src="a.png" />
<p>{name}{count}</p>

<style>
  .nope { color: red; }
</style>
