<script lang="ts">
  interface $$Slots {
    default: { item: number };
    footer: { total: string };
  }
</script>

<slot item={1} />
<slot name="footer" total="all" />
<slot name="missing" />
