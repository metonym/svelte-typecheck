<script lang="ts">
  import Plain from "./Plain.svelte";
</script>

<Plain label={1} on:click={(e) => e.nope} on:custom={(e) => e} />
