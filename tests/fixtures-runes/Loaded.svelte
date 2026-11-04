<script lang="ts">
  let { url }: { url: string } = $props();
  const before: string = 1;
  const data: number = await Promise.resolve(url);
  export function size() {
    return data;
  }
</script>

<p>{await Promise.resolve(data)}{before}</p>
