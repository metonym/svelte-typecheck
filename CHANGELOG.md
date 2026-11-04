# Changelog

## 0.1.0 — 2026-11-04

The first release of svelte-typecheck, the Svelte type checker extracted
from carbon-components-svelte's `scripts/typecheck`.

**Features**

- A drop-in for svelte-check: its options, its four output formats, its
  exit codes, and its diagnostics, in its order, with its message rewrites
  and filters.
- Svelte 3, 4 and 5: legacy syntax, `$$Props`/`$$Events`/`$$Slots`,
  generics, and runes (`$props()`, `$bindable()`, snippets, `{@attach}`,
  function bindings, `<svelte:boundary>`).
- SvelteKit: `./$types`, typed `load`, `actions`, page options, request
  handlers, hooks and param matchers, and `paths` or `#imports` aliases.
- The Svelte config as svelte-check finds it: a `vite.config`, through
  the project's own Vite, then a `svelte.config`, for its preprocessors
  and `compilerOptions`.
- Any checker: the project's `tsc` (default), tsgo, tsrs or `bun check`.
- Incremental by default: a run regenerates and rechecks only what
  changed, and returns the last result when nothing did;
  `--no-incremental` starts over. `--watch` checks again on each change.
- Beyond svelte-check: `--baseline` and `--update-baseline` to fail only
  on new errors, and `--changed` and `--since <ref>` to report only the
  files a change reaches.
- No dependencies: sveast is bundled and Svelte is a peer. Node 22+ or
  Bun, on macOS, Linux and Windows.
