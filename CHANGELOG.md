# Changelog

## Unreleased

The first release of svelte-typecheck, the Svelte type checker extracted
from carbon-components-svelte's `scripts/typecheck`.

- A drop-in for svelte-check: its options, its four output formats, its
  exit codes, and its diagnostics, in its order, with its message rewrites
  and filters.
- Svelte 3, 4 and 5: legacy syntax, `$$Props`/`$$Events`/`$$Slots`,
  generics, and runes (`$props()`, `$bindable()`, snippets, `{@attach}`,
  function bindings, `<svelte:boundary>`).
- SvelteKit: `./$types`, typed `load`, `actions`, page options, request
  handlers, hooks and param matchers, and `paths` or `#imports` aliases.
- Any checker: the project's `tsc` (default), tsgo, tsrs or `bun check`.
- `--watch` and `--incremental`; Node 22+, Bun, macOS, Linux and Windows.
- Beyond svelte-check: `--baseline` and `--update-baseline` to fail only
  on new errors, and `--changed` and `--since <ref>` to report only the
  files a change reaches.
