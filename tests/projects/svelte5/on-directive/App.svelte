<script lang="ts">
  let x = 0;
</script>

<div
    on:highlighted={() => (x = 1)}
></div>
<div on:highlighted|once={() => (x = 2)}></div>
<div on:focus={() => (x = 3)} on:highlighted></div>
{x}
