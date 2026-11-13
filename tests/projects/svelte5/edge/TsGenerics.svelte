<script lang="ts">
  const a = 1;
  const b = 2;
  let c = 0;
  let x = a<b>=c;
  class Box {
    get(readonly y: number) {
      return y;
    }
  }
  const n: string = 1;
</script>

<p>{x}{new Box().get(n.length)}</p>
