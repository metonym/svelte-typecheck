<script lang="ts">
  let count = 0;
  $: doubled = count * 2;
  $: doubled = "two";
  $: tripled = count * 3;
</script>

<p>{doubled}{tripled}</p>
