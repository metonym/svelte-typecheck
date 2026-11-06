<script>
  interface Item {
    id: number;
  }
  let count: number = 1;
  const items = [] as Item[];
  const first = items[0]!;
</script>

<p>{count}{first}</p>
