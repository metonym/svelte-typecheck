# How it works

1. **Find the project.** The tsconfig svelte-check would use (the nearer of tsconfig.json and jsconfig.json from the workspace up), and the components its `include` names.
2. **Parse.** [sveast](https://github.com/metonym/sveast) parses each component and resolves its scopes: props, `$:` declarations, runes, stores, `{#each}`, `let:` and snippet scopes, every read and write.
3. **Generate.** Each component becomes TypeScript (or JS with JSDoc) the way svelte2tsx writes it, with a map from each piece back to its source. The code, the helper types it calls and a tsconfig that extends yours go to `node_modules/.cache/svelte-typecheck`. The helpers are svelte-typecheck's own, except the few names a message prints, which keep svelte2tsx's (MIT) so messages read as svelte-check's do.
4. **Check and compile, at once.** One checker process type-checks the whole program while Svelte's compiler reports its warnings beside it.
5. **Map and order.** Each error maps back to its `.svelte` line, with svelte-check's rewrites and filters, in the order svelte-check prints them.
6. **Keep.** What each step learned is kept for the next run.

## What makes it fast

| Choice                                                                                                                    | Effect on carbon-components-svelte (1,276 components) |
| :------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------- |
| One batch run of a command-line checker, where svelte-check asks TypeScript's language service file by file               | 18.9 s against 40.5 s, on the same TypeScript 6       |
| Native checkers (TypeScript 7, tsrs, `bun check`) on every core                                                           | 3.6 s with `bun check`, 11× faster                    |
| sveast, a one-pass parser, instead of svelte2tsx and its source maps                                                      | Every component parsed and generated in about 0.4 s   |
| Svelte's compiler alongside the checker, not after it                                                                     | The slower of the two sets the time, not their sum    |
| Only what changed: components regenerated and recompiled, the checker's build cache, the last result when nothing changed | 0.72 s after one change (tsrs), 0.09 s with none      |
