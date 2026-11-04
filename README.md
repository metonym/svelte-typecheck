# svelte-typecheck

> Type-check Svelte components with the checker of your choice: `bun check`, tsrs, tsgo or `tsc`.

svelte-typecheck turns each component into TypeScript, runs a type checker on it, and maps every error back to its line and column in the `.svelte` file. It reports what svelte-check reports, up to 11× faster, with about half the memory.

```sh
bun add -d svelte-typecheck
bunx svelte-typecheck
```

Runs on Bun and on Node 22+ (`npx svelte-typecheck`). It checks with your project's own TypeScript, so the errors match your editor and build; TypeScript 7's `tsc` is native and fast. `--checker bun` or `--checker tsrs` is faster still.

```
/my-app/src/Errors.svelte:11:8
Error: Type '"tertiary"' is not assignable to type '"primary" | "ghost" | undefined'. (ts)

/my-app/src/Errors.svelte:13:33
Error: Property 'nope' does not exist on type '{ text: "primary" | "ghost"; }'. (ts)

====================================
svelte-typecheck found 2 errors and 0 warnings in 1 file
```

## Why

|                | svelte-check                    | svelte-typecheck                                                  |
| :------------- | :------------------------------ | :---------------------------------------------------------------- |
| Type checker   | TypeScript's JS API (TS 5 or 6) | Any checker that reads a tsconfig: `bun check`, tsrs, tsgo, `tsc` |
| TypeScript 7   | Needs `typescript@~6` beside it | Works: never imports `typescript`                                 |
| Dependencies   | 6, plus `typescript` (24 MB)    | None: [sveast](https://github.com/metonym/sveast) is bundled      |
| Svelte 3, 4, 5 | Yes                             | Yes, runes included                                               |
| SvelteKit      | `./$types`, typed `load`, hooks | The same                                                          |

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

## Usage

A drop-in replacement for svelte-check: the same options, the same output in all four formats, the same exit codes.

```diff
- "check": "svelte-check --tsconfig ./tsconfig.json"
+ "check": "svelte-typecheck --tsconfig ./tsconfig.json"
```

| svelte-check's options        |                                                                                                                                                                                |
| :---------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--workspace <dir>`           | Project folder (default: the current one)                                                                                                                                      |
| `--output <format>`           | `human`, `human-verbose` (default), `machine` or `machine-verbose`                                                                                                             |
| `--tsconfig <path>`           | tsconfig or jsconfig, relative to the workspace (default: the nearest from the workspace up). The components it includes are checked, and its TS and JS files' errors reported |
| `--no-tsconfig`               | Check every component under the workspace, and no TS or JS files                                                                                                               |
| `--ignore <list>`             | With `--no-tsconfig`: paths to skip, comma-separated                                                                                                                           |
| `--config <path>`             | The vite.config or svelte.config to read preprocessors and `compilerOptions` from                                                                                              |
| `--diagnostic-sources <list>` | `js`, `svelte` and `css`, comma-separated (default: all)                                                                                                                       |
| `--threshold error`           | Print errors only                                                                                                                                                              |
| `--compiler-warnings <list>`  | `code:ignore` or `code:error`, comma-separated                                                                                                                                 |
| `--fail-on-warnings`          | Exit 1 on a warning too                                                                                                                                                        |
| `--color`, `--no-color`       | Force color on or off                                                                                                                                                          |
| `--tsgo`                      | Check with tsgo                                                                                                                                                                |

| Its own               |                                                                                                                                                 |
| :-------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--checker <name>`    | `tsc` (default: your `typescript`), `tsgo`, `tsrs` or `bun`                                                                                     |
| `--components <glob>` | Components to check, relative to the workspace, instead of the tsconfig's; repeatable                                                           |
| `--out-dir <dir>`     | Where the generated code goes (default: `node_modules/.cache/svelte-typecheck/<workspace>`)                                                     |
| `--no-declarations`   | Type component imports only by their own `.svelte.d.ts`, never the generated code                                                               |
| `--svelte <dir>`      | The Svelte install to check against, e.g. a Svelte 4 test harness's                                                                             |
| `--no-incremental`    | Start from nothing: by default, the generated code and the checker's build cache are kept between runs                                          |
| `--changed`           | Report only the files changed from `HEAD` (and untracked ones), and the files that import them; see [Beyond svelte-check](#beyond-svelte-check) |
| `--since <ref>`       | As `--changed`, from where the branch left `<ref>`: `--since origin/main`                                                                       |
| `--baseline <file>`   | Report only diagnostics the baseline doesn't have; see [Beyond svelte-check](#beyond-svelte-check)                                              |
| `--update-baseline`   | Write the run's diagnostics to `--baseline`'s file                                                                                              |
| `--strict-baseline`   | Exit 1 when diagnostics in the baseline are fixed, until `--update-baseline` drops them, so the baseline only goes down                         |

## Beyond svelte-check

What svelte-typecheck does that svelte-check doesn't:

|                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Any checker, TypeScript 7**   | Checks with your project's `tsc`, including TypeScript 7's native one, or tsgo, tsrs or `bun check`; svelte-check needs TypeScript 5 or 6's JS API. See [Bring your own checker](#bring-your-own-checker).                                                                                                                                                                                                                                                                                                                                                                 |
| **Baselines**                   | `--update-baseline --baseline errors.json` records today's diagnostics; `--baseline errors.json` then reports, and fails on, only new ones. A diagnostic is known by its file, code, message and line's text, not its line number, so edits around it don't make it new; fixed ones are counted, to drop with `--update-baseline`, and `--strict-baseline` fails until they are, so it only goes down. For turning on `strict`, a new rule, or a checker upgrade without fixing everything first. Its paths are the workspace's, so the file is the same on every machine. |
| **Changed files only**          | `--changed` and `--since <ref>` report the files git sees changed and the files that import them, whose errors a change can cause. The whole program is still checked, so the errors are the same ones, fewer to read: for a pre-commit hook, or a PR's CI run.                                                                                                                                                                                                                                                                                                            |
| **Speed and memory**            | Up to 11× faster than svelte-check with `bun check` or tsrs, at about half its memory, and 1.2 to 2× with TypeScript 6's own `tsc`: one checker process over files on disk, beside the compiler pass, where svelte-check drives TypeScript's language service file by file.                                                                                                                                                                                                                                                                                                |
| **Zero dependencies**           | One bundle: it uses the project's own Svelte and checker, and installs nothing else.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Generated code you can read** | The TypeScript it writes and its tsconfig are plain files in `--out-dir`: open them, or run any checker on them yourself. They're kept between runs, with the checker's own build cache, so a run after a change rewrites and rechecks only what it touches (`--no-incremental` starts over).                                                                                                                                                                                                                                                                              |
| **No silent passes**            | Generated code that doesn't parse fails the run as a svelte-typecheck bug, and a checker error that names no file (a tsconfig option, a root file) is reported on the tsconfig. svelte-check's language service reads past broken generated code.                                                                                                                                                                                                                                                                                                                          |

### Differences from svelte-check

- **CSS diagnostics** (`--diagnostic-sources css`): accepted, but nothing is reported. svelte-check runs a CSS language service on `<style>`, a dependency this package leaves out; Svelte's compiler still reports invalid CSS.
- **`COMPLETED <n> FILES`** counts components, not every file in TypeScript's program.
- **`--diagnostic-sources svelte`** with a tsconfig reports no type errors, as svelte-check's docs say; svelte-check itself reports them.
- **`--tsgo-experimental-api`** is accepted, and does what `--tsgo` does.
- **tsconfig option errors** that only matter to an emitting build, such as a JS file that `tsc` would overwrite, aren't reported: the checker runs with `noEmit`.
- **A union's members** can print in another order, as TypeScript orders them by when it first meets each type: `Element | Document` where svelte-check has `Document | Element`.
- **A syntax error in a TS or JS file** stops `tsc` and the other CLI checkers from type-checking at all, so only syntax errors are reported until it's fixed; svelte-check's language service reports the type errors in other files too. A component's syntax errors don't do this.
- **Svelte 3 and 4 with `lang="ts"` and no preprocessors**: svelte-check strips the types with a fallback preprocessor and reports the compiler's warnings; here the compiler can't read the script, so there are none.
- **Svelte 3's element types** are Svelte 4's, read from the project's `svelte/elements`, without svelte2tsx's deprecated `svelte.JSX` namespace: a project that augments or references `svelte.JSX` should move to `svelteHTML` or `svelte/elements`. An ARIA attribute's type prints as `Booleanish` where svelte-check spells out `boolean | "true" | "false"`.
- **`--out-dir` outside the project** can't find its packages from the generated code; the default is inside `node_modules`.

### API

```ts
import {
  applyBaseline,
  compilerDiagnostics,
  createBaseline,
  typecheck,
} from "svelte-typecheck";

const { diagnostics, components, timings } = await typecheck({
  workspace: "src",
  checker: "tsgo",
});

// Svelte's own warnings and errors (a11y, unused CSS, invalid markup).
compilerDiagnostics(source, "Button.svelte");

// What's new since a baseline, in the files a change reaches.
const result = await typecheck({ only: ["src/Button.svelte"] });
const baseline = createBaseline(result.diagnostics, result.workspace);
applyBaseline(result.diagnostics, baseline, result.workspace).diagnostics; // []
```

## Bring your own checker

svelte-typecheck doesn't bundle or import TypeScript. It writes the generated code and a tsconfig to disk and runs a checker on them as a separate process, so any of these works, at whatever version your project installs:

| `--checker` | Install                                       | Runs                                         | Notes                                                                                               |
| :---------- | :-------------------------------------------- | :------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `tsc`       | `typescript`                                  | `tsc -p <generated tsconfig> --pretty false` | The default. TypeScript 7's `tsc` is native; with 6, JS files' JSDoc reads as svelte-check reads it |
| `tsgo`      | `@typescript/native-preview`                  | `tsgo -p … --pretty false`                   | TypeScript 7's preview build. `--tsgo` (svelte-check's flag) picks it too                           |
| `tsrs`      | [`tsrs`](https://github.com/oxc-project/tsrs) | `tsrs -p … --pretty false`                   | oxc's Rust port of TypeScript 7                                                                     |
| `bun`       | [Bun](https://bun.sh) 1.4                     | `bun check -p … --no-pretty --all`           | Bun's own TypeScript; no build cache, so it checks the whole program after a change                 |

```sh
svelte-typecheck                    # your project's typescript: tsc
svelte-typecheck --checker tsgo     # or tsrs, or bun
```

```ts
const result = await typecheck({ checker: "tsrs" });
result.checker; // "tsrs"
result.checkerVersion; // "0.20.1", from its package.json
```

### How a checker is found and run

| Step      | What happens                                                                                                                                                                                                                                                                                           |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pick      | `--checker`, or else the first of `tsc`, `tsgo`, `tsrs`, `bun` that's installed: your project's own TypeScript when it has one                                                                                                                                                                         |
| Find      | Its package in `node_modules`, from the workspace up, as Node resolves one (a hoisted install counts), then its `bin` in the package's `package.json`; failing that, the command on `PATH` (on Windows, by `PATHEXT`: `tsc.cmd`, `bun.exe`). `bun` is the running Bun, if svelte-typecheck runs on Bun |
| Launch    | A Node launcher (all three packages ship one) runs on the current runtime, Node or Bun, rather than through its shebang, so it works on Windows too; a native binary runs directly; a Windows `.cmd` shim runs through the shell                                                                       |
| Configure | The generated tsconfig `extends` yours, so your compiler options (`strict`, `paths`, `lib`, `types`…) apply. It adds the generated code to `files` and `rootDirs`, and sets `noEmit` and its own `incremental` build info, so your files are never written                                             |
| Read      | The checker prints errors as `tsc` does, `file(line,col): error TSxxxx: message`; each one maps back to its `.svelte` line, or to your TS file as it is. An error that names no file (a bad option) is reported on your tsconfig                                                                       |

Any version works as long as it reads a tsconfig and prints `tsc`'s format: to pin one, install it in the project. TypeScript 7 reads JSDoc in JS files more strictly than 6, so a JS codebase's error count can move a little between them.

## How it works

1. **Find the project.** The tsconfig svelte-check would use (the nearer of tsconfig.json and jsconfig.json from the workspace up), and the components its `include` names.
2. **Parse.** [sveast](https://github.com/metonym/sveast) parses each component and resolves its scopes: props, `$:` declarations, runes, stores, `{#each}`, `let:` and snippet scopes, every read and write.
3. **Generate.** Each component becomes TypeScript (or JS with JSDoc) the way svelte2tsx writes it, with a map from each piece back to its source. The code, the helper types it calls (adapted from svelte2tsx's, MIT) and a tsconfig that extends yours go to `node_modules/.cache/svelte-typecheck`.
4. **Check and compile, at once.** One checker process type-checks the whole program while Svelte's compiler reports its warnings beside it.
5. **Map and order.** Each error maps back to its `.svelte` line, with svelte-check's rewrites and filters, in the order svelte-check prints them.
6. **Keep.** What each step learned is kept for the next run.

### What makes it fast

| Choice                                                                                                                    | Effect on carbon-components-svelte (1,276 components) |
| :------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------- |
| One batch run of a command-line checker, where svelte-check asks TypeScript's language service file by file               | 18.9 s against 40.5 s, on the same TypeScript 6       |
| Native checkers (TypeScript 7, tsrs, `bun check`) on every core                                                           | 3.6 s with `bun check`, 11× faster                    |
| sveast, a one-pass parser, instead of svelte2tsx and its source maps                                                      | Every component parsed and generated in about 0.4 s   |
| Svelte's compiler alongside the checker, not after it                                                                     | The slower of the two sets the time, not their sum    |
| Only what changed: components regenerated and recompiled, the checker's build cache, the last result when nothing changed | 0.72 s after one change (tsrs), 0.09 s with none      |

## Limitations

- **Type-checking only:** no editor support. Your editor keeps the Svelte language server, which can disagree with it at the edges.
- **No CSS diagnostics.**

The rest of what differs from svelte-check is under [Differences from svelte-check](#differences-from-svelte-check).

## Contributing

How it's built, the rules a change keeps, and how to check it against svelte-check and benchmark it: [CONTRIBUTING.md](CONTRIBUTING.md).
