<script>
  let { a, b = 1, c = $bindable() } = $props();
</script>

<p>{a}{b}{c}</p>
