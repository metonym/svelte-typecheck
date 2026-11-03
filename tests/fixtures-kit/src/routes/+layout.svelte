<script lang="ts">
  let { data, children } = $props();
  const user: number = data.user;
</script>

<p>{user}</p>
{@render children()}
