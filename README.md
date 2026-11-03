# svelte-typecheck

> Type-check Svelte components with the checker of your choice: `bun check`, tsrs, tsgo or `tsc`.

svelte-typecheck turns each component into TypeScript, runs a type checker on it, and maps every error back to its line and column in the `.svelte` file. It reports what svelte-check reports, 7 to 14× faster, with a third of the memory.

```sh
bun add -d svelte-typecheck
bunx svelte-typecheck
```

Runs on Bun and on Node 22+ (`npx svelte-typecheck`). With Bun installed, `bun check` is the default checker: the fastest, and nothing more to install.

```
src/Errors.svelte:11:8 - error TS2322: Type '"tertiary"' is not assignable to type '"ghost" | "primary" | undefined'.
src/Errors.svelte:13:33 - error TS2339: Property 'nope' does not exist on type '{ text: "ghost" | "primary"; }'.
3 components, 2 errors [emit 15 ms, bun 33 ms]
```

## Why

|                | svelte-check                    | svelte-typecheck                                                  |
| :------------- | :------------------------------ | :---------------------------------------------------------------- |
| Type checker   | TypeScript's JS API (TS 5 or 6) | Any checker that reads a tsconfig: `bun check`, tsrs, tsgo, `tsc` |
| TypeScript 7   | Needs `typescript@~6` beside it | Works: never imports `typescript`                                 |
| Dependencies   | 6, plus `typescript` (24 MB)    | 1: [sveast](https://github.com/metonym/sveast), which has none    |
| Svelte 3, 4, 5 | Yes                             | Yes (runes not yet; see Limits)                                   |

Measured on carbon-components-svelte, where it replaced svelte-check:

| Check                                  | svelte-check | svelte-typecheck |
| :------------------------------------- | :----------- | :--------------- |
| Tests on Svelte 5, CI (866 components) | 6 to 14 s    | 1 to 2 s         |
| Tests on Svelte 4, CI                  | 26 to 28 s   | 1 to 2 s         |
| Tests on Svelte 3, CI                  | 27 to 30 s   | 2 to 3 s         |
| Library's own components, local (398)  | 9.1 s        | 0.7 s            |
| Peak memory, tests (`bun check`)       | 1.6 GB       | 0.5 GB           |

## Usage

```sh
svelte-typecheck [options]
```

| Option                | Default                                            |                                                                                                 |
| :-------------------- | :------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| `--workspace <dir>`   | `.`                                                | Folder whose components to check                                                                |
| `--tsconfig <path>`   | `<workspace>/tsconfig.json`                        | The tsconfig the generated one extends                                                          |
| `--checker <name>`    | first installed of `bun`, `tsrs`, `tsgo`, `tsc`    | Type checker to run                                                                             |
| `--components <glob>` | `**/*.svelte`                                      | Components to check, relative to the workspace; repeatable                                      |
| `--out-dir <dir>`     | `node_modules/.cache/svelte-typecheck/<workspace>` | Where the generated code goes                                                                   |
| `--no-declarations`   |                                                    | Resolve component imports to their own `.svelte.d.ts`, as a library's generated declarations do |
| `--svelte <dir>`      | `svelte`, resolved                                 | The Svelte install to check against, e.g. a Svelte 4 test harness's                             |
| `--output <format>`   | `human`                                            | `machine` prints `ERROR "file" line:col "message" TSxxxx`                                       |

It exits 1 on a type error and 2 on a usage error, or if the generated code doesn't parse (a svelte-typecheck bug, never a silent pass).

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

| Checker                                     | Install                      | Notes                                                      |
| :------------------------------------------ | :--------------------------- | :--------------------------------------------------------- |
| `bun check`                                 | [Bun](https://bun.sh) 1.4    | Default when Bun is installed. Fastest and leanest         |
| [tsrs](https://github.com/oxc-project/tsrs) | `tsrs`                       | oxc's Rust port of TypeScript 7                            |
| tsgo                                        | `@typescript/native-preview` | TypeScript 7                                               |
| `tsc`                                       | `typescript`                 | TypeScript 6. Reads JSDoc in JS files as svelte-check does |

TypeScript 7 reads JSDoc in JS files more strictly than 6, so a JS codebase's error count can move a little between them.

## How it works

1. [sveast](https://github.com/metonym/sveast) parses each component and resolves its scopes: `$:` declarations, props, store subscriptions, `{#each}` and `let:` scopes, and every read and write.
2. The emitter writes TypeScript (or JS with JSDoc) the way svelte2tsx does, keeping a map from each piece of output to its source.
3. A checker runs on the output; each error maps back to the `.svelte` file. Errors in generated scaffolding map to their element or component, and those in purely generated code are dropped.

The helper types the generated code calls are adapted from svelte2tsx's (MIT), and keep its names.

## Limits

- **Svelte 5 runes** (`$props()`, `$state`, snippet types for `{@render}`) aren't typed yet; legacy syntax is, on Svelte 3, 4 and 5.
- No SvelteKit auto-typing (`./$types`), preprocessors, CSS diagnostics or watch mode.
- Your editor still runs the Svelte language server, so the two can disagree at the edges.

## License

[MIT](LICENSE)
