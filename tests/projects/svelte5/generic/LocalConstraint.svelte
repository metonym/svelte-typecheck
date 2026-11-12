<script lang="ts" generics="Row extends DataTableRow = DataTableRow, Key extends keyof Missing = never">
  interface DataTableRow {
    id: string;
  }

  let { rows }: { rows: Row[] } = $props();
</script>

{rows.length}
