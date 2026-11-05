# Changelog

## Unreleased

**Fixes**

- An incremental run checks again when a component's own
  `X.svelte.d.ts` appears, changes or goes, such as one a build writes
  beside it, where it returned the last run's result. Outside the
  tsconfig's `include`, it wasn't one of the files the run watched.

**Performance**

- An incremental run compiles a changed component without loading the
  Svelte config, which through Vite can take half a second, when no
  preprocessor that can change code reads it: none of its preprocessors'
  hooks for markup, or for a `<script>` or `<style>` it has. The config's
  preprocessors (by name and hook) and compiler options are kept from the
  run that loaded it. SvelteKit's own preprocessor only warns, so it
  never needs the config; a function in the compiler options always does.

## 0.1.8 — 2026-11-04

**Performance**

- The compiler's pass starts on a worker thread before code is
  generated, when 16 components or more need compiling, so loading the
  Svelte config (Vite's included) and the compiler overlaps generating
  code and the checker. Cold runs on the bench corpus are 15 to 21%
  faster with tsrs, tsgo and `bun check`, and 16% faster with a SvelteKit
  vite.config.
- A run that returns the last result no longer loads the parser.

## 0.1.7 — 2026-11-04

**Internal**

- The package is smaller, 124.5KB packed from 129.5KB: the README is a
  quick start, with the rest of the docs in `docs/` on GitHub, and
  `index.d.ts` drops its leading comment.

## 0.1.6 — 2026-11-04

**Fixes**

- A compiler-only run (`--diagnostic-sources svelte`) works without a
  type checker installed, as svelte-check's does (#23). A result's
  `checker` is unset when none ran and none is installed.
- Without `allowJs`, a JS component is `any` to TypeScript, as in
  svelte-check, rather than Svelte's `*.svelte` type, so its use is
  checked as svelte-check checks it.
- An untyped import of a JS component is reported where TypeScript
  reports it: not under `skipLibCheck` or `@ts-ignore`, and through the
  package's own name too.
- A snippet passed to a component is written as a bare key, so messages
  name it as svelte-check does, with its "Did you mean" hints.
- tsgo's paths are read when `$PWD` names the folder through a symlink,
  such as macOS's `/tmp`, where a run crashed.

**Internal**

- The generated code is checked with svelte-typecheck's own helpers, and
  the shims are inlined in the bundle.

## 0.1.5 — 2026-11-04

**Fixes**

- A `<svelte:element>` whose tag may be any element, such as a
  component's generic `Tag extends keyof HTMLElementTagNameMap`, is
  checked: its attributes are checked as an element's, where
  svelte-check reports TypeScript's "union type too complex" and checks
  none of them. A tag from a few elements keeps its own attributes.
- An error on a `<svelte:element>`'s whole attributes object is placed
  after its tag, where svelte-check places it.

## 0.1.4 — 2026-11-04

**Fixes**

- An incremental run checks again when the declarations beside an
  imported JS file change, outside the tsconfig's `include` too (#16).
- A JSDoc cast in a template expression is read, as svelte-check reads
  it (#17).
- An error on `<svelte:element>` is placed on its `<`, as svelte-check
  places it (#18).
- More of svelte-check's diagnostics, matching its output: a second
  `$: x = …` of the same name; an action, transition or animation on an
  element it doesn't take, and their return types; a `<slot name>`
  `$$Slots` doesn't declare, and slot content for a slot the component
  doesn't have; svelte-check's hints on a component's errors; a `$x`
  that isn't a store, after the component's other errors; and a
  TypeScript component's props.

## 0.1.3 — 2026-11-04

**Features**

- `--strict-baseline` fails a run while the baseline has diagnostics the
  run no longer reports, until `--update-baseline` drops them, so a
  baseline only goes down.

**Fixes**

- `--no-declarations` no longer drops the tsconfig's own TS and JS files
  from the program: their errors are reported again.

## 0.1.2 — 2026-11-04

**Performance**

- `--diagnostic-sources svelte` (the compiler's diagnostics alone) no
  longer writes generated code no checker reads: on
  carbon-components-svelte's 398 components, the run drops from 988 to
  746 ms.

## 0.1.1 — 2026-11-04

**Fixes**

- A tsconfig whose `include` matches nothing fails with TS18003, as
  svelte-check reports it, instead of passing with a warning. A typo in
  `include`, or `["."]` in a folder such as `my.app` (which TypeScript
  reads as a file), no longer passes CI with nothing checked.
- Svelte is no longer a peer dependency. svelte-typecheck always loads
  the project's own, so the range only got in the way: npm refuses to
  install alongside a Svelte outside it (a future Svelte 6), and installs
  one into a project that has none.

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
