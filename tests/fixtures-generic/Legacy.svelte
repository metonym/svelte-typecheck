<script lang="ts">
  type T = $$Generic<string | number>;
  export let value: T;
</script>

<slot {value} />
