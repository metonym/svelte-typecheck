# Benchmarks

The fastest of 5 cold runs on an 8-core Apple M2, each factor against
svelte-check's default mode. svelte-check's own TypeScript 7 modes are
in for comparison: the same tsgo, driven differently.

| Tool                                   | Checker               | carbon-components-svelte | bits-ui      | realworld     |
| :------------------------------------- | :-------------------- | :----------------------- | :----------- | :------------ |
| svelte-check                           | TypeScript 6          | 40.5 s                   | 6.6 s        | 1.76 s        |
| svelte-check `--tsgo-experimental-api` | TypeScript 7          | 11.6 s (3.5×)            | 2.8 s (2.3×) | 1.17 s (1.5×) |
| svelte-typecheck                       | TypeScript 6 (`tsc`)  | 18.9 s (2.1×)            | 5.7 s (1.2×) | 1.24 s (1.4×) |
| svelte-typecheck                       | TypeScript 7 (`tsgo`) | 7.9 s (5.1×)             | 1.6 s (4.2×) | 0.79 s (2.2×) |
| svelte-typecheck                       | tsrs                  | 3.7 s (11.1×)            | 1.6 s (4.1×) | 0.70 s (2.5×) |
| svelte-typecheck                       | `bun check`           | 3.6 s (11.3×)            | 1.4 s (4.7×) | 0.67 s (2.6×) |

Peak memory falls with it: 0.85 GB against svelte-check's 1.74 GB on
carbon-components-svelte with `bun check`. There, it also replaced
svelte-check in CI, where the type tests went from 6 to 30 s to 1 to 3 s.

Those are cold runs. After the first, a run regenerates and recompiles
only the components that changed, the checker reuses its build cache,
and with nothing changed, the last result comes back without checking
at all. On carbon-components-svelte, with svelte-check's runs all cold:

| Run                                  | `tsc`  | tsgo   | tsrs   | `bun check` |
| :----------------------------------- | :----- | :----- | :----- | :---------- |
| Cold                                 | 18.9 s | 7.9 s  | 3.7 s  | 3.6 s       |
| One component changed                | 3.1 s  | 0.95 s | 0.72 s | 0.76 s      |
| Nothing changed                      | 0.09 s | 0.09 s | 0.14 s | 0.09 s      |
| `--watch`, from a save to its result | n/a    | 0.68 s | 0.37 s | 0.76 s      |

`bun check` has no build cache of its own, so it checks the whole
program again after a change. A run with nothing changed is known by
each input's size and modification time: the components, the files
the tsconfig includes and those it extends, the package manifests and
lockfiles, the Svelte config and the versions, and the files the last
run's program imported. An edit that none of those see, such as a
hand-patched package in `node_modules`, needs `--no-incremental`.

## Generated projects

`tests/generate.ts` writes projects of any size: here, a barrel
(`index.ts` re-exports every component, and each imports the next
through it), a hub (every component imports one), and a chain (each
imports the next). Each component has one planted error, and every run
that finished reported all of them. One cold run each, on the same
8-core Apple M2 with 8 GB of memory, while the machine ran other work (a load
average of about 15), so the times are approximate. Node 24, svelte-check
4.7.8, TypeScript 6.0.3 and 7.0.2, tsrs 0.22.

At 2,000 components:

| Shape  | svelte-check                              | svelte-check `--tsgo` | `tsc` (TypeScript 6) | tsgo  | tsrs  |
| :----- | :---------------------------------------- | :-------------------- | :------------------- | :---- | :---- |
| barrel | 12.6 s                                    | 11.5 s                | 4.0 s                | 2.1 s | 1.3 s |
| hub    | 10.3 s                                    | 8.3 s                 | 4.2 s                | 1.2 s | 1.0 s |
| chain  | fails: "Maximum call stack size exceeded" | 6.4 s                 | 3.1 s                | 1.1 s | 1.1 s |

At 8,000 components, where svelte-check runs out of Node's default heap
(2.35 GB here) after about 21 s, and finishes with
`--max-old-space-size=8192`:

| Shape  | svelte-check, 8 GB heap | svelte-check `--tsgo` | `tsc` (TypeScript 6) | tsgo  | tsrs  |
| :----- | :---------------------- | :-------------------- | :------------------- | :---- | :---- |
| barrel | 665 s                   | 54 s                  | 18.8 s               | 6.0 s | 3.8 s |
| hub    | 419 s                   | 59 s                  | 13.3 s               | 5.5 s | 4.9 s |

From 2,000 to 8,000 components, svelte-check's time grows 40 to 50
times, as it asks the language service for each file's diagnostics in
turn, and with `--tsgo` 5 to 7 times. svelte-typecheck's grows 3 to 5
times with each checker, about in proportion, which `tests/scale.test.ts`
checks. Peak memory at 8,000 is 2.3 to 2.8 GB for svelte-check and 0.4
GB for svelte-typecheck with tsrs. The components are small and alike,
so a real project's factors differ: see carbon-components-svelte's above.
