# svelte-typecheck

> Type-check Svelte components with `bun check`, tsrs, tsgo or `tsc`. Fast, light, svelte-check compatible.

svelte-typecheck is a zero-dependency, drop-in replacement for svelte-check. It takes the same options and prints the same output, but runs a command-line checker on the components instead of TypeScript's language service, which makes it up to 11 times faster. It runs on Node 22+ or Bun.

```diff
- "check": "svelte-check --tsconfig ./tsconfig.json"
+ "check": "svelte-typecheck --tsconfig ./tsconfig.json"
```

A cold run on carbon-components-svelte (1,200+ components) takes:

| Checker               | Time   | vs. svelte-check |
| :-------------------- | :----- | :--------------- |
| svelte-check          | 40.5 s | 1×               |
| TypeScript 6 (`tsc`)  | 18.9 s | 2.1×             |
| TypeScript 7 (`tsgo`) | 7.9 s  | 5.1×             |
| tsrs                  | 3.7 s  | 11.1×            |
| `bun check`           | 3.6 s  | 11.3×            |

The [benchmarks](https://github.com/metonym/svelte-typecheck/blob/master/docs/benchmarks.md) have more, including runs after a change.

## Quick start

```sh
bun add -d svelte-typecheck
bunx svelte-typecheck
```

It exits with 1 when there's an error and 0 otherwise.

## CLI

```sh
# Check the project with the nearest tsconfig and the project's TypeScript
svelte-typecheck

# Check with another checker
svelte-typecheck --checker tsgo
svelte-typecheck --checker tsrs
svelte-typecheck --checker bun

# Check part of a project
svelte-typecheck --workspace packages/ui
svelte-typecheck --tsconfig ./tsconfig.app.json
svelte-typecheck --components "src/lib/**/*.svelte"

# Check every component, without a tsconfig, skipping two folders
svelte-typecheck --no-tsconfig --ignore dist,build

# Print one line per diagnostic, which is easier for scripts and agents to read
svelte-typecheck --output machine

# Print errors only, or fail on warnings as well
svelte-typecheck --threshold error
svelte-typecheck --fail-on-warnings

# Ignore one compiler warning
svelte-typecheck --compiler-warnings a11y_missing_attribute:ignore

# Report only files changed from HEAD, or since the branch left main, and the files that import them
svelte-typecheck --changed
svelte-typecheck --since origin/main

# Record the current diagnostics, then report only new ones
svelte-typecheck --baseline errors.json --update-baseline
svelte-typecheck --baseline errors.json

# Also fail when fixed diagnostics are still in the baseline
svelte-typecheck --baseline errors.json --strict-baseline

# Check again on every change
svelte-typecheck --watch

# Ignore the cache from earlier runs
svelte-typecheck --no-incremental
```

## API

```ts
import { typecheck } from "svelte-typecheck";

const { diagnostics } = await typecheck({ checker: "tsgo" });

for (const d of diagnostics) {
  // file is absolute; line and column are 1-based, in the .svelte source
  console.log(
    `${d.file}:${d.line}:${d.column} ${d.severity} ${d.code} ${d.message}`,
  );
}
```

## Docs

- [CLI options](https://github.com/metonym/svelte-typecheck/blob/master/docs/cli.md)
- [API](https://github.com/metonym/svelte-typecheck/blob/master/docs/api.md)
- [Checkers](https://github.com/metonym/svelte-typecheck/blob/master/docs/checkers.md)
- [Compared with svelte-check](https://github.com/metonym/svelte-typecheck/blob/master/docs/svelte-check.md)
- [Benchmarks](https://github.com/metonym/svelte-typecheck/blob/master/docs/benchmarks.md)
- [How it works](https://github.com/metonym/svelte-typecheck/blob/master/docs/architecture.md)
