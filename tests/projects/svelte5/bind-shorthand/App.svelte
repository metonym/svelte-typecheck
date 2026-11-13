<script lang="ts">
  import Child from "./Child.svelte";
  import Legacy from "./Legacy.svelte";
  let edited = $state(false);
  let other = $state(1);
</script>

<Child bind:edited />
<Child bind:edited={other} />
<Child bind:size={other} />
<Legacy bind:edited />
