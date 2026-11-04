# svelte-typecheck

> Type-check Svelte components with the checker of your choice: `bun check`, tsrs, tsgo or `tsc`.

svelte-typecheck turns each component into TypeScript, runs a type checker on it, and maps every error back to its line and column in the `.svelte` file. It reports what svelte-check reports, 7 to 14× faster, with a third of the memory.

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
| Dependencies   | 6, plus `typescript` (24 MB)    | 1: [sveast](https://github.com/metonym/sveast), which has none    |
| Svelte 3, 4, 5 | Yes                             | Yes, runes included                                               |
| SvelteKit      | `./$types`, typed `load`, hooks | The same                                                          |

Measured on carbon-components-svelte, where it replaced svelte-check:

| Check                                  | svelte-check | svelte-typecheck |
| :------------------------------------- | :----------- | :--------------- |
| Tests on Svelte 5, CI (866 components) | 6 to 14 s    | 1 to 2 s         |
| Tests on Svelte 4, CI                  | 26 to 28 s   | 1 to 2 s         |
| Tests on Svelte 3, CI                  | 27 to 30 s   | 2 to 3 s         |
| Library's own components, local (398)  | 9.1 s        | 0.7 s            |
| Peak memory, tests (`bun check`)       | 1.6 GB       | 0.5 GB           |

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
| `--changed`           | Report only the files changed from `HEAD` (and untracked ones), and the files that import them; see [Beyond svelte-check](#beyond-svelte-check) |
| `--since <ref>`       | As `--changed`, from where the branch left `<ref>`: `--since origin/main`                                                                       |

## Beyond svelte-check

What svelte-typecheck does that svelte-check doesn't:

|                               |                                                                                                                                                                                                                                                                 |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Any checker, TypeScript 7** | Checks with your project's `tsc`, including TypeScript 7's native one, or tsgo, tsrs or `bun check`; svelte-check needs TypeScript 5 or 6's JS API. See [Bring your own checker](#bring-your-own-checker).                                                      |
| **Changed files only**        | `--changed` and `--since <ref>` report the files git sees changed and the files that import them, whose errors a change can cause. The whole program is still checked, so the errors are the same ones, fewer to read: for a pre-commit hook, or a PR's CI run. |

### Differences from svelte-check

- **CSS diagnostics** (`--diagnostic-sources css`): accepted, but nothing is reported. svelte-check runs a CSS language service on `<style>`, a dependency this package leaves out; Svelte's compiler still reports invalid CSS.
- **`COMPLETED <n> FILES`** counts components, not every file in TypeScript's program.
- **`--diagnostic-sources svelte`** with a tsconfig reports no type errors, as svelte-check's docs say; svelte-check itself reports them.
- **`--tsgo-experimental-api`** is accepted, and does what `--tsgo` does.
- **tsconfig option errors** that only matter to an emitting build, such as a JS file that `tsc` would overwrite, aren't reported: the checker runs with `noEmit`.
- **A union's members** can print in another order, as TypeScript orders them by when it first meets each type: `Element | Document` where svelte-check has `Document | Element`.
- **A syntax error in a TS or JS file** stops `tsc` and the other CLI checkers from type-checking at all, so only syntax errors are reported until it's fixed; svelte-check's language service reports the type errors in other files too. A component's syntax errors don't do this.
- **Svelte 3 and 4 with `lang="ts"` and no preprocessors**: svelte-check strips the types with a fallback preprocessor and reports the compiler's warnings; here the compiler can't read the script, so there are none.
- **`--out-dir` outside the project** can't find its packages from the generated code; the default is inside `node_modules`.

### API

```ts
import { compilerDiagnostics, typecheck } from "svelte-typecheck";

const { diagnostics, components, timings } = await typecheck({
  workspace: "src",
  checker: "tsgo",
});

// Svelte's own warnings and errors (a11y, unused CSS, invalid markup).
compilerDiagnostics(source, "Button.svelte");
```

## Bring your own checker

The generated code and its tsconfig are plain files on disk, so any checker that takes `-p tsconfig.json` and prints errors as `tsc` does works:

| Checker                                     | Install                      | Notes                                                                                                      |
| :------------------------------------------ | :--------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `tsc`                                       | `typescript`                 | Default: your project's TypeScript. Native in TypeScript 7; with 6, reads JSDoc in JS as svelte-check does |
| `bun check`                                 | [Bun](https://bun.sh) 1.4    | Fastest and leanest; Bun's own TypeScript version                                                          |
| [tsrs](https://github.com/oxc-project/tsrs) | `tsrs`                       | oxc's Rust port of TypeScript 7                                                                            |
| tsgo                                        | `@typescript/native-preview` | TypeScript 7                                                                                               |

TypeScript 7 reads JSDoc in JS files more strictly than 6, so a JS codebase's error count can move a little between them.

## How it works

1. [sveast](https://github.com/metonym/sveast) parses each component and resolves its scopes: `$:` declarations, props, store subscriptions, `{#each}` and `let:` scopes, and every read and write.
2. The emitter writes TypeScript (or JS with JSDoc) the way svelte2tsx does, keeping a map from each piece of output to its source.
3. A checker runs on the output; each error maps back to the `.svelte` file. Errors in generated scaffolding map to their element or component, and those in purely generated code are dropped.

The helper types the generated code calls are adapted from svelte2tsx's (MIT), and keep its names.

## Limits

- No CSS diagnostics.
- Your editor still runs the Svelte language server, so the two can disagree at the edges.

## License

[MIT](LICENSE)
