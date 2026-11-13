<script lang="ts" generics="$Key /* a key */ extends `${string}=${string}`, Fallback extends string = 'a,b'">
  let { pair, fallback }: { pair: $Key; fallback?: Fallback } = $props();
</script>

{pair} {fallback}
