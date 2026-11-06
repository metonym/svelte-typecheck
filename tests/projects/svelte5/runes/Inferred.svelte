<script lang="ts">
  let { a, b = 1, c: renamed = "s", d = $bindable(true), ...rest } = $props();
</script>

<p {...rest}>{a}{b}{renamed}{d}</p>
