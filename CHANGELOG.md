# Changelog

## Unreleased

**Fixes**

- `--checker tsgo` (and `--tsgo`) finds TypeScript 7 where svelte-check's
  `--tsgo` does: `@typescript/native`, an alias such as
  `@typescript/native@npm:typescript@7` installed beside `typescript@6`,
  then `@typescript/native-preview`. It also uses the project's own
  `typescript` when that's 7. It looked only for
  `@typescript/native-preview`, which stopped at a 7.0 preview, so
  TypeScript 7.0 and 7.1 releases weren't found.
- A project whose tsconfig declares `contentMappers`, such as
  `@sveltejs/ts-content-mapper`, checks with TypeScript 7.1 and tsrs.
  The checker reported "Content mappers require the
  '--runExternalCode' command line flag" on the tsconfig in every run,
  and the run failed. The generated tsconfig now turns content mappers
  off, since the components it lists are already TypeScript.

## 0.1.11 — 2026-11-05

**Fixes**

- With `SVELTE_TYPECHECK_DAEMON=1`, a run no longer starts daemons
  without end: the daemon it started inherited the variable, took itself
  for a run to hand to a daemon, and started another, which did the
  same. A daemon now never hands its runs on, and starts without the
  variable. `--daemon` alone wasn't affected.

## 0.1.10 — 2026-11-05

**Features**

- `--daemon` runs on a process kept alive for the folder, started on the
  first such run, so a run doesn't start a runtime, load svelte-typecheck,
  the compiler and the config, and read its caches each time. For agents
  and hooks that check again and again: on carbon-components-svelte, a
  run after one change is 15 to 24% faster. `SVELTE_TYPECHECK_DAEMON=1`
  turns it on for every run, and `svelte-typecheck start`, `stop` and
  `status` manage it. It starts again when the config, the lockfile or
  Svelte changes, runs the check here if it fails, exits after 10 idle
  minutes, and isn't used on CI.

**Performance**

- tsgo, tsrs and TypeScript 7's `tsc` start as their native binary,
  found with each package's own lookup, rather than through their Node
  launcher, which started a runtime only to start the binary. A run that
  checks is about 40 to 50 ms faster, and on Bun, where the launcher
  waited on the binary, there's no idle process beside the checker.
- The generated code leaves out what can't report anything: the
  `createElement` call for an element whose attributes write nothing
  (none, static `data-` ones, a slot's name), the names of elements and
  component instances nothing reads, `$$props`, `$$restProps` and
  `$$slots` where a legacy component doesn't use them, and static
  `data-` attributes. On carbon-components-svelte it's 10% smaller, and
  the checker builds 1 to 4% fewer types, instantiations and symbols
  (tsgo, tsrs and `bun check`), with about 1.8% less memory.
- A run that compiles every component, such as the first or one with
  `--no-incremental`, starts compiling them on the worker as soon as it
  has found them: the worker reads them, and loads the compiler and the
  Svelte config, while the run reads them too and generates code. A
  component edited between the two reads compiles again as the run read
  it. A component that no preprocessor reads is compiled
  without calling Svelte's `preprocess` on it, which parsed it for
  nothing: none of the preprocessors has a markup hook, or a hook for a
  `<script>` or `<style>` it has. On carbon-components-svelte (1,276
  components, `vite-preprocess` with a style hook only), cold runs are
  12% faster with `bun check` and 7% faster with tsrs from starting to
  load the compiler early and skipping `preprocess`, and 8 to 12% faster
  again with every checker from compiling early.
- Diagnostics are put in TypeScript's program order while the checker
  runs, rather than after it: reading each program file's imports took
  95 to 180 ms of a run on carbon-components-svelte, all of it after the
  checker finished. And without `allowJs`, the project's TS files are
  read all at once to find their imports of JS components, rather than
  one at a time, and that text isn't read again to order them.
- `--no-incremental` moves the last run's output folder aside and deletes
  it while the run goes on, rather than first: on
  carbon-components-svelte, deleting it took 100 to 150 ms.

**Fixes**

- The compiler's pass runs on the worker when the workspace is given
  through a symlink (`/tmp` on macOS) that leads to the working
  directory, where it ran on the main thread and held up the run.

## 0.1.9 — 2026-11-05

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
