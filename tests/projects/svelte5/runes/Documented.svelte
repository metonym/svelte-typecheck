<script>
  /** @type {{ size: number, title?: string }} */
  let { size, title = "t" } = $props();
  export const version = 1;
</script>

<p>{size}{title}</p>
