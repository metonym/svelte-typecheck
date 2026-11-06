# CLI

A drop-in replacement for svelte-check: the same options, the same output in all four formats, the same exit codes.

```diff
- "check": "svelte-check --tsconfig ./tsconfig.json"
+ "check": "svelte-typecheck --tsconfig ./tsconfig.json"
```

| svelte-check's options        |                                                                                                                                                                                                                                     |
| :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--workspace <dir>`           | Project folder (default: the current one)                                                                                                                                                                                           |
| `--output <format>`           | `human`, `human-verbose` (default), `machine` or `machine-verbose`                                                                                                                                                                  |
| `--tsconfig <path>`           | tsconfig or jsconfig, relative to the workspace (default: the nearest from the workspace up). The components it includes are checked, and its TS and JS files' errors reported; the human output names the components it leaves out |
| `--no-tsconfig`               | Check every component under the workspace, and no TS or JS files                                                                                                                                                                    |
| `--ignore <list>`             | With `--no-tsconfig`: paths to skip, comma-separated                                                                                                                                                                                |
| `--config <path>`             | The vite.config or svelte.config to read preprocessors and `compilerOptions` from                                                                                                                                                   |
| `--diagnostic-sources <list>` | `js`, `svelte` and `css`, comma-separated (default: all)                                                                                                                                                                            |
| `--threshold error`           | Print errors only                                                                                                                                                                                                                   |
| `--compiler-warnings <list>`  | `code:ignore` or `code:error`, comma-separated                                                                                                                                                                                      |
| `--fail-on-warnings`          | Exit 1 on a warning too                                                                                                                                                                                                             |
| `--watch`                     | Check again when a file changes                                                                                                                                                                                                     |
| `--color`, `--no-color`       | Force color on or off                                                                                                                                                                                                               |
| `--tsgo`                      | Check with tsgo                                                                                                                                                                                                                     |

| Its own               |                                                                                                                                                                |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--checker <name>`    | `tsc` (default: your `typescript`), `tsgo`, `tsrs` or `bun`                                                                                                    |
| `--components <glob>` | Components to check, relative to the workspace, instead of the tsconfig's; repeatable                                                                          |
| `--out-dir <dir>`     | Where the generated code goes (default: `node_modules/.cache/svelte-typecheck/<workspace>`)                                                                    |
| `--no-declarations`   | Type component imports only by their own `.svelte.d.ts`, never the generated code                                                                              |
| `--svelte <dir>`      | The Svelte install to check against, e.g. a Svelte 4 test harness's                                                                                            |
| `--no-incremental`    | Start from nothing: by default, the generated code and the checker's build cache are kept between runs                                                         |
| `--changed`           | Report only the files changed from `HEAD` (and untracked ones), and the files that import them; see [Beyond svelte-check](svelte-check.md#beyond-svelte-check) |
| `--since <ref>`       | As `--changed`, from where the branch left `<ref>`: `--since origin/main`                                                                                      |
| `--baseline <file>`   | Report only diagnostics the baseline doesn't have; see [Beyond svelte-check](svelte-check.md#beyond-svelte-check)                                              |
| `--update-baseline`   | Write the run's diagnostics to `--baseline`'s file                                                                                                             |
| `--strict-baseline`   | Exit 1 when diagnostics in the baseline are fixed, until `--update-baseline` drops them, so the baseline only goes down                                        |
