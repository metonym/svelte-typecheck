# Contributing

This guide covers how svelte-typecheck is built, the rules every change must keep, and how to verify a change before it merges. svelte-typecheck is meant as a drop-in for svelte-check, so most rules come back to one question: what does svelte-check report?

## Setup

[Bun](https://bun.sh/) is the package manager, test runner and bundler.

```sh
bun ci
bun run test           # unit and parity tests
bun run test:changed   # only the tests your changes can reach (bivium)
bun run typecheck      # bun check
bun run lint           # bun fmt --check and bun lint; `bun run fmt` formats
bun run knip           # unused files, exports and dependencies
bun run build          # dist/: the library and the bin as ESM for Node, one index.d.ts
bun run test:package   # build, pack, install, and use it as a consumer would
bun src/cli.ts         # the CLI from source, in the current folder
```

The SvelteKit fixture needs SvelteKit's generated files; its parity test runs `svelte-kit sync` first, and so can you: `bunx svelte-kit sync` in `tests/fixtures-kit`.

## How it works

`typecheck` (`src/check.ts`) runs these steps:

1. **Project.** `projectOf` (`src/project.ts`) finds the tsconfig as svelte-check does (the nearer of tsconfig.json and jsconfig.json from the workspace up) and reads it with the ones it extends: the components its `include` names, its `rootDirs`, `paths` (and package.json `imports`), `allowJs` and `checkJs`. `programFiles` lists the project's files in TypeScript's root order.
2. **Replay.** With nothing the run reads changed since the last one (each file known by a `stat`), the last result comes back here (`result.json`).
3. **Generate.** `emit` (`src/emit.ts`) turns each component into TypeScript, or JS with JSDoc, the way svelte2tsx does, and records where each piece came from (`src/output.ts`), so an error maps back to its `.svelte` line. `src/kit.ts` adds SvelteKit's types to route files, hooks and param matchers, in copies that replace them. The generated code, a copy of the shims (`src/shims/`, inlined in the bundle by the build: the `$$check` helpers, and the names a message prints, kept as svelte-check prints them) and a tsconfig that extends the project's go to the output folder; unchanged components aren't generated again (`emit-cache.json`).
4. **Check and compile.** The checker (`src/checker.ts`: the project's `tsc`, tsgo, tsrs or `bun check`) runs on the generated tsconfig while the Svelte compiler's pass (`src/compiler.ts`) runs here, after the Svelte config's preprocessors (`src/config.ts`: a vite.config through the project's own Vite, or a svelte.config). Compiler results are kept by component (`compile-cache.json`).
5. **Map.** Each checker error maps back to its source; errors in purely generated code are dropped, and svelte-check's rewrites and filters apply (store misuse, non-bindable `bind:`, `$:` labels and more).
6. **Order.** Diagnostics come out in TypeScript's program order, a file's imports before it, as svelte-check prints them. What's read from each file for this is kept by its `stat` (`files.json`).

`src/main.ts` is the CLI (svelte-check's options, plus `--checker`, `--baseline` and `--changed`), `src/format.ts` its four output formats, `src/watch.ts` `--watch`, `src/baseline.ts` baselines and `src/git.ts` the changed files. `src/cli.ts` is the bin.

## Rules every change must keep

- **svelte-check is the reference.** Where the output differs from svelte-check's, read what svelte2tsx and svelte-check do (`node_modules/svelte-check/dist/src/index.js` bundles both) and do the same, then add a fixture that shows it. A difference we keep on purpose goes in [docs/svelte-check.md](docs/svelte-check.md#differences-from-svelte-check).
- **Never pass silently.** Generated code that doesn't parse fails the run as our bug, and a checker error that names no file is reported on the tsconfig. A run that checked nothing must not look like a clean one.
- **Never write the project's files.** Everything goes to the output folder; the generated tsconfig sets its own `incremental`, `composite` and `tsBuildInfoFile` so the project's never come into play.
- **Bump `CACHE_FORMAT`** (`src/check.ts`) when a cache's shape changes, so a new run misses an old file instead of reading the wrong shape.
- **Zero runtime dependencies.** sveast is bundled, and Svelte is loaded from the project, so the package doesn't declare it, even as a peer; `src/` imports `node:` builtins otherwise and runs on Node ≥ 22 and Bun. `test:package` checks the bundle's imports.
- **Keep the public API small.** `src/index.ts` is the public API, and `src/types.ts` declares it by hand: its types and each function's signature, with their JSDoc. It imports nothing, and the build copies it as `index.d.ts`. Change a function's signature in both; `tests/api.test.ts` fails to type-check until they match.
- **Paths through `node:path`.** Never split a path on `/`: on Windows a `.tmp` folder read as an extension once dropped every component. Messages print paths `/`-separated, with a lowercase drive letter on Windows, as svelte-check's TypeScript does.
- **Comments say why.** JSDoc is for the public API; elsewhere a comment states a reason or a constraint the code can't. sveast's AST is untyped, so `any` stays on its nodes in `emit.ts` and `kit.ts`, with a disable comment, and nowhere else.

## Tests

| File                                           | Covers                                                                                                                                                                                                                               |
| :--------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/parity.test.ts`                         | Our machine output against svelte-check's, line for line, on each fixture, and the human and verbose formats                                                                                                                         |
| `tests/typecheck.test.ts`                      | The pinned errors with each checker, the compiler pass, preprocessors                                                                                                                                                                |
| `tests/emit.test.ts`                           | Generating code: mapping, widened props, repeated handlers, JSDoc generics, Svelte 3 classes                                                                                                                                         |
| `tests/watch.test.ts`                          | Incremental runs (a changed import, replay, the project's own build info) and `--watch`                                                                                                                                              |
| `tests/compile-cache.test.ts`                  | The compiler pass's cache, and the config left unloaded, across processes                                                                                                                                                            |
| `tests/baseline.test.ts`                       | `--baseline` through edits that move lines, new and fixed diagnostics                                                                                                                                                                |
| `tests/changed.test.ts`                        | `only` and its importers, and git's changed files                                                                                                                                                                                    |
| `tests/checker.test.ts`                        | Finding a checker, `PATHEXT` on Windows, the default                                                                                                                                                                                 |
| `tests/compiler.test.ts`, `tests/glob.test.ts` | `compilerDiagnostics`, the glob walker                                                                                                                                                                                               |
| `tests/api.test.ts`                            | The exports, and their signatures against `src/types.ts`                                                                                                                                                                             |
| `scripts/test-package.ts`                      | `bun run test:package`: the packed tarball installs, imports only builtins and Svelte's compiler, checks the fixtures from Node and Bun, runs the compiler's diagnostics with no checker installed, and its `index.d.ts` type-checks |

Each `tests/fixtures-*` folder is a small project for one area: `fixtures` (the basics), `-typed` (`$$Props`, `$$Events`, `$$Slots`), `-generic`, `-filters` (svelte-check's rewrites), `-preprocess`, `-runes`, `-kit` (SvelteKit 3) and `-edge` (markup that doesn't parse, TypeScript in JS, no `allowJs`). A behavior fix needs a test that fails before the fix and passes after; for a parity fix, that's usually a line in a fixture.

A pull request runs only the tests its changes can reach, which [bivium](https://github.com/metonym/bivium) finds from `bivium.config.ts`. A new test that reads a fixture or runs the CLI says so there; `bunx bivium check` lists a fixture no test reads, and a test that reads the disk without saying what.

To test config loading, run the CLI in a process of its own: within one process, Node caches an imported config, so a second load proves nothing.

## Checking real projects

The fixtures don't cover everything. `eval/` checks svelte-typecheck against svelte-check on a real project:

```sh
bun eval/diff.ts <project> --tsconfig tsconfig.json   # the two tools' output, line by line
bun eval/mutate.ts <project>/src                       # plant errors in every component (undo with git)
bun eval/diff.ts <project> --tsconfig tsconfig.json   # and again, with them
```

Never trust a run with 0 errors on its own: plant some first. bits-ui (runes, TypeScript), realworld (SvelteKit 2, JS, with `checkJs` on) and carbon-components-svelte's root (JS components, no `allowJs`) each found bugs the fixtures didn't. Two things to watch:

- `diff.ts` uses the project's own svelte-check where it has one: another install loads a second copy of Svelte's types, which reports false snippet errors.
- Compare on the project's own TypeScript: TypeScript 6's defaults report errors 5.9 doesn't (bits-ui has 231).

## Benchmarks

```sh
bun run bench            # ostia: every workload, against the saved baseline
bun run bench:baseline   # save this run as the baseline
```

The workloads (`ostia.config.ts`) generate code in process, and run the corpus (`bench/corpus.ts`, 400 components, half of them runes) with each checker cold and after one component changed, with nothing changed, and the compiler pass alone. The baseline lives in `.ostia/baselines/`, which isn't committed: save one on your machine before you change anything.

On a real project, `eval/ab.ts` compares two builds, runs interleaved:

```sh
bun run build && cp -R dist /tmp/before
# ...change, then:
bun run build && cp -R dist /tmp/after
bun eval/ab.ts /tmp/before /tmp/after <project> cold-tsrs
AB_CHANGE=<project>/src/Button.svelte bun eval/ab.ts /tmp/before /tmp/after <project> changed-tsgo
```

A shared machine is noisy: other processes put the load average past the core count, and wall time can vary 50% between identical runs. Run an A/A comparison (the same build on both sides) first to see the noise, and read CPU time (user and sys, the checker's included) beside wall time: it stays within a few percent under load. Report the load average with any number.

### Performance changes

A performance change is a `perf:` commit with a before-and-after table in its message, and only lands when it wins well beyond the noise. These were measured and didn't pay, so try them again only with new evidence:

| Idea                                                   | Why it didn't pay                                                                                            |
| :----------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| The compiler pass on worker threads                    | All of carbon-components-svelte compiles in 0.8 s on one thread, and the checker already has the other cores |
| One compiler thread with a capped heap                 | Our process's peak fell 60 MB, the run's didn't: the checker's peak overlaps ours                            |
| A `.noindex` output folder, against Spotlight on macOS | No measurable effect                                                                                         |
| A simpler `$$check.component`                          | Instantiations unchanged: the cost is checking each component's props                                        |

## Releasing

1. Move the `## Unreleased` entries in `CHANGELOG.md` under the new version.
2. Bump `version` in `package.json` and commit as `vX.Y.Z`.
3. Tag the commit (`git tag -s vX.Y.Z`) and push the tag. `release.yml` tests the packed package and publishes `dist/` to npm with provenance; it needs the `NPM_AUTH_TOKEN` secret.

## Before you finish

- [ ] `bun run lint`, `bun run typecheck`, `bun run knip`, `bun run test` and `bun run test:package` pass. Check the exit code: piping `bun run lint` into `tail` hides a failure.
- [ ] Parity changes: a fixture shows the behavior, and `bun eval/diff.ts` on a real project, with errors planted, still matches.
- [ ] Performance changes: `bun run bench` against your baseline, and `eval/ab.ts` on a real project.
- [ ] The README, `docs/` and this guide still describe what the code does.
