<script lang="ts">
  const url: string = import.meta.url;
  const counts = new Map<string, number>();
  for (const [key] of counts) console.log(key, url);

  let count: number = "one";
</script>

<p>{count}</p>
