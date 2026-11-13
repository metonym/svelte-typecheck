# CLI

A drop-in replacement for svelte-check: the same options, the same output in all four formats, the same exit codes.

```diff
- "check": "svelte-check --tsconfig ./tsconfig.json"
+ "check": "svelte-typecheck --tsconfig ./tsconfig.json"
```

| svelte-check's options        |                                                                                                                                                                                      |
| :---------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--workspace <dir>`           | Project folder (default: the current one)                                                                                                                                            |
| `--output <format>`           | `human`, `human-verbose` (default), `machine`, `machine-verbose` or `agent` (default when `AGENT`, `AI_AGENT`, `CLAUDECODE`, `CODEX_CI` or `CODEX_THREAD_ID` is set, and not to `0`) |
| `--tsconfig <path>`           | tsconfig or jsconfig, relative to the workspace (default: the nearest from the workspace up). The components it includes are checked, and its TS and JS files' errors reported       |
| `--no-tsconfig`               | Check every component under the workspace, and no TS or JS files                                                                                                                     |
| `--ignore <list>`             | With `--no-tsconfig`: paths to skip, comma-separated                                                                                                                                 |
| `--config <path>`             | The vite.config or svelte.config to read preprocessors and `compilerOptions` from                                                                                                    |
| `--diagnostic-sources <list>` | `js`, `svelte` and `css`, comma-separated (default: all)                                                                                                                             |
| `--threshold error`           | Print errors only                                                                                                                                                                    |
| `--compiler-warnings <list>`  | `code:ignore` or `code:error`, comma-separated                                                                                                                                       |
| `--fail-on-warnings`          | Exit 1 on a warning too                                                                                                                                                              |
| `--watch`                     | Check again when a file changes                                                                                                                                                      |
| `--color`, `--no-color`       | Force color on or off                                                                                                                                                                |
| `--tsgo`                      | Check with tsgo                                                                                                                                                                      |

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
| `--daemon`            | Run on a daemon kept alive for the folder; see [The daemon](#the-daemon)                                                                                       |
| `--no-daemon`         | Run here, whatever `SVELTE_TYPECHECK_DAEMON` says                                                                                                              |

## The daemon

Each run starts a runtime, loads and optimizes svelte-typecheck, loads the Svelte compiler and config, and reads its caches. With `--daemon`, a process kept alive for the folder does all of that once, and each run is handed to it. It's for tools that check again and again: an agent after each edit, a pre-commit hook, scripts that run several checks. For a terminal you're watching, `--watch` already keeps a process alive.

```sh
svelte-typecheck --daemon --changed     # started on the first run, reused after
export SVELTE_TYPECHECK_DAEMON=1        # or for every run, without the flag
```

On carbon-components-svelte (1,276 components), a run after one component changes is about 15 to 24% faster with tsrs, tsgo and `bun check`, and one with nothing changed about 10%. The checker still starts fresh each run.

A run on the daemon prints what it would print here, with its own arguments, environment and terminal: under Claude Code, machine output, as here. A daemon:

- serves one folder, built from one install of svelte-typecheck, and its runs one at a time.
- starts again when its config (`svelte.config.*`, `vite.config.*`), the lockfile or the installed Svelte changes, as it keeps them loaded.
- runs the check here instead when it can't start or fails partway; its output is printed once the run ends, so nothing is printed twice.
- exits after 10 idle minutes (`SVELTE_TYPECHECK_DAEMON_IDLE` in seconds).
- isn't used on CI (`CI` set), with `--watch` or with `--no-daemon`.

```sh
svelte-typecheck status   # whether one runs for this folder, and its log
svelte-typecheck start    # start one ahead of the first run
svelte-typecheck stop
```

Its socket and log are in a folder of the user's own (`$XDG_RUNTIME_DIR` or the temp folder), or a named pipe on Windows.
