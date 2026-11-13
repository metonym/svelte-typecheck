<script lang="ts" generics="H extends Record<string, (x: number) => void> = Record<string, never>, K extends keyof H = keyof H">
  let { handlers, name }: { handlers: H; name: K } = $props();
</script>

<button onclick={() => handlers[name]?.(1)}>{String(name)}</button>
