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
