# How it works

1. **Find the project.** The tsconfig svelte-check would use (the nearer of tsconfig.json and jsconfig.json from the workspace up), and the components its `include` names.
2. **Parse.** [sveast](https://github.com/metonym/sveast) parses each component and resolves its scopes: props, `$:` declarations, runes, stores, `{#each}`, `let:` and snippet scopes, every read and write.
3. **Generate.** Each component becomes TypeScript (or JS with JSDoc) the way svelte2tsx writes it, with a map from each piece back to its source ([examples](#the-generated-code)). The code, the helper types it calls and a tsconfig that extends yours go to `node_modules/.cache/svelte-typecheck`. The helpers are svelte-typecheck's own, except the few names a message prints, which keep svelte2tsx's (MIT) so messages read as svelte-check's do.
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

## The generated code

Each component becomes one TypeScript file, or a JS file with JSDoc for a component without `lang="ts"`. The instance script is copied into a `$$render` function, the markup becomes statements inside an `async () => {}` arrow in that function, and the component's type is built from what `$$render` returns. None of it runs. The arrow is never called, and it's `async` so that `{#await}` can use `await`.

The samples below put svelte-typecheck's output next to svelte2tsx's (0.7.63, which svelte-check uses) for the same component. Both have been run through `bun fmt` to make them readable. The generator itself writes one line per markup node and wraps each copied expression in parentheses, so that text such as `{a, b}` or an object literal is read as an expression and not as a block. The formatter removes those parentheses.

### Where the files go

For a project with `src/Counter.svelte`, the output folder (`node_modules/.cache/svelte-typecheck` by default) holds:

```
tsconfig.json                   extends the project's tsconfig
shims.d.ts                      the $$check helpers
svelte/src/++Counter.svelte.ts  the generated component
svelte/src/Counter.d.svelte.ts  export { default } from "./++Counter.svelte.js"; export * from …
tsbuildinfo                     the checker's build cache
*.json                          svelte-typecheck's own caches
```

The generated tsconfig lists its files instead of globbing them, in the order svelte-check's program has them: the components, the project's own TS and JS, then `shims.d.ts` and Svelte's `svelte-html.d.ts`. It sets `rootDirs: ["../../..", "svelte"]`, so `svelte/src/` is treated as the same folder as `src/` and a component's relative imports of `.ts` files still resolve. It also sets `allowArbitraryExtensions`, so `import Counter from "./Counter.svelte"` resolves to `Counter.d.svelte.ts`. That file re-exports `++Counter.svelte.ts`. `noEmit`, `composite: false` and its own `tsBuildInfoFile` keep the checker from writing anything of the project's.

### A runes component

```svelte
<script lang="ts">
  let { count = 0 }: { count?: number } = $props();
  let items = ["a", "b"];
</script>

<button onclick={() => count++} disabled={count > 3}>{count.toFixed(1)}</button>
{#each items as item}
  <p>{item.toUpperCase()}</p>
{/each}
```

svelte-typecheck writes:

```ts
function $$render() {
  type $$ComponentProps = { count?: number };
  let { count = 0 }: $$ComponentProps = $props();
  let items = ["a", "b"];

  async () => {
    {
      const $$_el0 = svelteHTML.createElement("button", {
        onclick: () => count++,
        disabled: count > 3,
      });
      count.toFixed(1);
    }
    for (let item of $$check.each(items)) {
      {
        const $$_el1 = svelteHTML.createElement("p", {});
        item.toUpperCase();
      }
    }
  };
  return {
    props: {} as any as $$ComponentProps,
    exports: {},
    bindings: $$check.bindings(""),
    slots: {},
    events: {},
  };
}
type $$Rendered = ReturnType<typeof $$render>;
declare const $$Component: import("svelte").Component<
  $$Rendered["props"],
  $$Rendered["exports"],
  $$Rendered["bindings"]
>;
type $$Component = ReturnType<typeof $$Component>;
export default $$Component;
```

svelte2tsx writes:

```ts
///<reference types="svelte" />
type $$ComponentProps = { count?: number };
function $$render() {
  let { count = 0 }: /*Ωignore_startΩ*/ $$ComponentProps /*Ωignore_endΩ*/ =
    $props();
  let items = ["a", "b"];
  async () => {
    {
      svelteHTML.createElement("button", {
        onclick: () => count++,
        disabled: count > 3,
      });
      count.toFixed(1);
    }
    for (let item of __sveltets_2_ensureArray(items)) {
      {
        svelteHTML.createElement("p", {});
        item.toUpperCase();
      }
    }
  };
  return {
    props: {} as any as $$ComponentProps,
    exports: {},
    bindings: __sveltets_$$bindings(""),
    slots: {},
    events: {},
  };
}
const Counter__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/ type Counter__SvelteComponent_ = ReturnType<
  typeof Counter__SvelteComponent_
>;
/*Ωignore_endΩ*/ export default Counter__SvelteComponent_;
```

The two have the same structure, and that is deliberate. The checker sees the same program svelte-check's language service sees, so it reports the same errors with the same messages.

- `$props()`'s type annotation is pulled out as `$$ComponentProps`, so the component's type can name it. svelte2tsx moves it above `$$render`. svelte-typecheck leaves it where the script declared it, inside `$$render`.
- Each element is a `svelteHTML.createElement(tag, attributes)` call. `svelteHTML` comes from Svelte's own `svelte-html.d.ts`, which maps each tag to its attribute types, so `disabled={count > 3}` is checked against `HTMLButtonAttributes`. svelte-typecheck names the result `$$_el0` so that `bind:this={el}` can be written as `el = $$_el0`, which checks that `el` can hold that element type.
- `{expr}` becomes an expression statement, and `{#each items as item}` becomes a `for…of` loop. `$$check.each` (svelte2tsx's `__sveltets_2_ensureArray`) accepts an array-like or iterable value and returns its items, so `item` is a `string` here.
- The returned object describes the component: its props, exports, bindable props, slots and events. The component's type is computed from `ReturnType<typeof $$render>`.
- At the end, svelte2tsx calls a helper, `__sveltets_2_fn_component($$render())`, and the checker infers the component's type from that call. svelte-typecheck declares `$$Component` with its type written out as Svelte's `Component<Props, Exports, Bindings>`.

### Components, `bind:` and `{#if}`

```svelte
<script lang="ts">
  import Field from "./Field.svelte";
  let value = $state("");
  let { onsave }: { onsave: (v: string) => void } = $props();
</script>

<Field label="Name" bind:value />
{#if value.length > 0}
  <button onclick={() => onsave(value)}>Save</button>
{:else}
  <p>Empty</p>
{/if}
```

The markup becomes:

```ts
async () => {
  {
    const $$_c0C = $$check.component(Field);
    const $$_c0 = new $$_c0C({
      target: $$check.any(),
      props: { label: "Name", value: value },
    });
    () => (value = $$check.any(null));
    $$_c0.$$bindings = "value";
    {
    }
  }
  if (value.length > 0) {
    {
      const $$_el1 = svelteHTML.createElement("button", {
        onclick: () => onsave(value),
      });
    }
  } else {
    {
      const $$_el2 = svelteHTML.createElement("p", {});
    }
  }
};
```

svelte2tsx writes the same statements, with `__sveltets_2_ensureComponent` in place of `$$check.component` and a scrambled variable name (`$$_dleiF0`, the tag's name reversed). It also wraps the `bind:` check in ignore comments.

- `$$check.component(Field)` accepts a Svelte 5 function component, a Svelte 4 class, or anything typed as `ConstructorOfATypedSvelteComponent`, and returns a constructor. Constructing it with `props` checks each attribute against the child's props, including that a required prop isn't missing.
- `bind:value` produces two checks. `() => (value = $$check.any(null))` checks that `value` can be assigned to, so binding a `const` or an import is an error. `$$_c0.$$bindings = "value"` checks that `Field` marks `value` as `$bindable()`. Field's own output returns `bindings: $$check.bindings("value")`, and that becomes the type `$$bindings` accepts.
- `{#if}` and `{:else}` become `if` and `else`, so TypeScript narrows inside them as it does in a script.
- The empty `{}` after the component is where its slot content and snippets would go.

### Svelte 4 syntax

```svelte
<script lang="ts">
  import { writable } from "svelte/store";
  export let name: string;
  const count = writable(0);
  $: greeting = `Hello ${name}`;
</script>

<h1>{greeting}</h1>
<p on:click={() => $count++}>{$count}</p>
<slot item={name} />
```

svelte-typecheck writes:

```ts
import { writable } from "svelte/store";
function $$render() {
  let $$props = $$check.props();
  let $$restProps = $$check.props();
  let $$slots = $$check.any(0);

  let name: string;
  name = $$check.any(0);
  const count = writable(0);
  let $count = $$check.store(count);
  let greeting = $$check.reactive(() => `Hello ${name}`);

  async () => {
    {
      const $$_el0 = svelteHTML.createElement("h1", {});
      greeting;
    }
    {
      const $$_el1 = svelteHTML.createElement("p", {
        "on:click": () => $count++,
      });
      $count;
    }
    ({ item: name });
    {
    }
  };
  return {
    props: { name: name } as { name: string },
    exports: {},
    bindings: "",
    slots: { default: { item: name } },
    events: {},
  };
}
type $$Rendered = ReturnType<typeof $$render>;
declare const $$Component: __sveltets_2_IsomorphicComponent<
  __sveltets_2_PropsWithChildren<$$Rendered["props"], $$Rendered["slots"]>,
  $$Rendered["events"] & { [evt: string]: CustomEvent<any> },
  $$Rendered["slots"],
  $$Rendered["exports"],
  $$Rendered["bindings"]
>;
type $$Component = InstanceType<typeof $$Component>;
export default $$Component;
```

svelte2tsx writes:

```ts
///<reference types="svelte" />
import { writable } from "svelte/store";
function $$render() {
  let name: string; /*Ωignore_startΩ*/
  name = __sveltets_2_any(name); /*Ωignore_endΩ*/
  const count = writable(0); /*Ωignore_startΩ*/
  let $count = __sveltets_2_store_get(count); /*Ωignore_endΩ*/
  let greeting = __sveltets_2_invalidate(() => `Hello ${name}`);

  /*Ωignore_startΩ*/ const __sveltets_createSlot =
    __sveltets_2_createCreateSlot(); /*Ωignore_endΩ*/
  async () => {
    {
      svelteHTML.createElement("h1", {});
      greeting;
    }
    {
      svelteHTML.createElement("p", { "on:click": () => $count++ });
      $count;
    }
    {
      __sveltets_createSlot("default", { item: name });
    }
  };
  return {
    props: { name: name } as { name: string },
    exports: {},
    bindings: "",
    slots: { default: { item: name } },
    events: {},
  };
}
const Legacy__SvelteComponent_ = __sveltets_2_isomorphic_component_slots(
  __sveltets_2_with_any_event($$render()),
);
/*Ωignore_startΩ*/ type Legacy__SvelteComponent_ = InstanceType<
  typeof Legacy__SvelteComponent_
>;
/*Ωignore_endΩ*/ export default Legacy__SvelteComponent_;
```

- Imports move above `$$render`, since a function body can't contain them. Both tools do this.
- `export let name: string` becomes a plain `let`, followed by an assignment from `any` so that TypeScript doesn't report it as used before assignment. The prop and its type go into `props`.
- Each store a component reads as `$count` gets a `let $count = $$check.store(count)` declaration right after the store's own. If `count` isn't a store, the error is at that generated declaration. svelte-check reports it at each `$count` in the source, and svelte-typecheck does the same: it records where the declaration and each use are, and reports the error once per use.
- `$: greeting = …` becomes `let greeting = $$check.reactive(() => …)`. The helper returns what the arrow returns, so `greeting` gets the expression's type, as it would from a plain `let`.
- `<slot item={name} />` becomes an object literal so its props are checked. The slot's props also go into the returned `slots`, which is where a parent's `let:item` gets its type. svelte2tsx calls a slot helper instead. svelte-typecheck calls one, `$$slot`, only when the component declares `$$Slots`, to check the slot's props against it.
- svelte-typecheck declares `$$props`, `$$restProps` and `$$slots` in every legacy component. svelte2tsx declares them only when the component uses them.
- A legacy component's type is `__sveltets_2_IsomorphicComponent`, which can be constructed with `new`, as Svelte 4 does, and also called, as Svelte 5 does. This name, and the few other names a type error can print, keep svelte2tsx's spelling in `shims.d.ts` so the messages read as svelte-check's do. Every other helper is in svelte-typecheck's `$$check` namespace. A Svelte script can't declare a `$$` name, so they can't collide with a component's own names.

### Generics, snippets and `{#await}`

```svelte
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  let { items, row }: { items: T[]; row: Snippet<[T]> } = $props();
</script>

{#each items as item, i (i)}
  {@render row(item)}
{/each}
{#snippet empty()}<p>None</p>{/snippet}
{#await Promise.resolve(items.length) then n}
  <span>{n}</span>
{/await}
```

svelte-typecheck writes:

```ts
import type { Snippet } from "svelte";
function $$render<T>() {
  const empty = (): ReturnType<import("svelte").Snippet> => {
    async () => {
      {
        const $$_el0 = svelteHTML.createElement("p", {});
      }
    };
    return $$check.any(0);
  };

  type $$ComponentProps = { items: T[]; row: Snippet<[T]> };
  let { items, row }: $$ComponentProps = $props();

  async () => {
    for (let item of $$check.each(items)) {
      let i = 1;
      i;
      $$check.snippet(row(item));
    }
    {
      const $$_p1 = Promise.resolve(items.length);
      {
      }
      {
        const n = await $$_p1;
        {
          const $$_el2 = svelteHTML.createElement("span", {});
          n;
        }
      }
      {
        const $$_e = $$check.any(0);
      }
    }
  };
  return {
    props: {} as any as $$ComponentProps,
    exports: {},
    bindings: $$check.bindings(""),
    slots: {},
    events: {},
  };
}
class $$Render<T> {
  props(): ReturnType<typeof $$render<T>>["props"] {
    return null as any;
  }
  events(): ReturnType<typeof $$render<T>>["events"] {
    return null as any;
  }
  slots(): ReturnType<typeof $$render<T>>["slots"] {
    return null as any;
  }
  bindings() {
    return $$check.bindings("");
  }
  exports(): ReturnType<typeof $$render<T>>["exports"] {
    return null as any;
  }
}
interface $$Generic {
  new <T>(
    options: import("svelte").ComponentConstructorOptions<
      ReturnType<$$Render<T>["props"]>
    >,
  ): import("svelte").SvelteComponent<
    ReturnType<$$Render<T>["props"]>,
    ReturnType<$$Render<T>["events"]>,
    ReturnType<$$Render<T>["slots"]>
  > & { $$bindings?: ReturnType<$$Render<T>["bindings"]> } & ReturnType<
      $$Render<T>["exports"]
    >;
  <T>(
    internal: unknown,
    props: ReturnType<$$Render<T>["props"]> & {},
  ): ReturnType<$$Render<T>["exports"]>;
  z_$$bindings?: ReturnType<$$Render<any>["bindings"]>;
}
const $$Component: $$Generic = null as any;
type $$Component<T> = InstanceType<typeof $$Component<T>>;
export default $$Component;
```

- `generics="T"` becomes `$$render<T>`. A function's return type can't be read for a particular `T`, so the `$$Render<T>` class wraps each part of it, and `$$Generic` is a type that can be both called and constructed, with its own `<T>`. Using `<List items={[1, 2]} … />` then infers `T` as `number`, as calling a generic function would. svelte2tsx's output is the same apart from its names (`__sveltets_Render`, `$$IsomorphicComponent`).
- A snippet becomes a `const` arrow function at the top of the fragment it's declared in, so the markup can use it before its `{#snippet}` tag. svelte2tsx moves snippets to the top in the same way. A root-level snippet goes first in `$$render`.
- `{@render row(item)}` becomes `$$check.snippet(row(item))`, which checks that `row` is a snippet and that `item` matches its parameter.
- `{#each … , i (i)}` declares the index as a number and checks the key expression.
- `{#await}` stores the promise in a variable and then writes each branch in its own block. The pending branch is empty here. The `then` branch awaits the promise, and the `catch` branch declares its error as `any`. svelte2tsx writes only the branches the block has. svelte-typecheck always writes all three.

### JS with JSDoc

A component without `lang="ts"` becomes a `.js` file, and the types that would be annotations become JSDoc. It's part of the program when the project sets `allowJs`, and TypeScript checks it when the project sets `checkJs`, as it would any JS file. Without `allowJs`, the component's importers see it as `any`, as they do with svelte-check.

```svelte
<script>
  /** @type {{ size?: number }} */
  let { size = 1 } = $props();
</script>

<div style:width="{size}px">{size}</div>
```

The end of its output is:

```js
  return {
    props: /** @type {{ size?: number }} */ ({}),
    exports: {},
    bindings: $$check.bindings(""),
    slots: {},
    events: {},
  };
}
/** @typedef {ReturnType<typeof $$render>} $$Rendered */
const $$Component =
  /** @type {import("svelte").Component<$$Rendered["props"], $$Rendered["exports"], $$Rendered["bindings"]>} */ (
    /** @type {unknown} */ (null)
  );
/** @typedef {ReturnType<typeof $$Component>} $$Component */
export default $$Component;
```

`style:width="{size}px"` becomes the template literal `` `${size}px` ``, so `size` is still checked as an expression.

### Mapping an error back

If `items` in the first sample is `[1, 2]`, tsgo reports the error in the generated file:

```
svelte/src/++Counter.svelte.ts(8,96): error TS2339: Property 'toUpperCase' does not exist on type 'number'.
```

svelte-typecheck reports it in the component:

```
src/Counter.svelte:8:12 Property 'toUpperCase' does not exist on type 'number'.
```

The mapping comes from `Output` (`src/output.ts`), which records every piece of text as the generator writes it.

- `copy(start, end)` writes a range of the source unchanged and records `[generated start, source start, length]`. A position inside a copy maps to the same character in the source. Scripts, expressions, `{#each}` patterns and component names are written this way, so most errors land on the exact token.
- `from(offset, fn)` records a range of generated text that maps to one source offset. It's used where TypeScript reports an error on generated code that stands for something in the source. For example, an error about an element's whole attributes object goes to the last letter of the tag name, which is where svelte2tsx's source map puts it. When spans are nested, the smallest one wins.
- Anything else written with `raw` has no source. An error there is about generated code only, such as a helper's internals, and it's dropped. The one exception is the store error described above.

To map the error above, the checker's line and column are turned into an offset in the generated file. A binary search over the copies finds the one containing that offset (`item.toUpperCase()`, copied from the `{…}` on line 8), and the offset is converted back to a line and column in the `.svelte` file. The diagnostics are then rewritten and filtered as svelte-check does (a non-bindable `bind:`, a `$:` label, and so on) and sorted into svelte-check's order. If the generated code fails to parse, the run fails and reports it as a svelte-typecheck bug, instead of passing with no errors.

Svelte's compiler warnings take a separate path. The compiler runs on the original source after the project's preprocessors, and its warnings come with source positions, which are mapped through the preprocessors' source maps when they provide one (`src/sourcemap.ts`).

## Compared with svelte2tsx

svelte2tsx is the transform behind svelte-check and the Svelte language server. svelte-typecheck generates the same program, but it builds that program differently and checks it differently.

|                            | svelte2tsx in svelte-check                                                                                                                      | svelte-typecheck                                                                                                                    |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| How the code is produced   | Edits the component's text in place with MagicString, moving, overwriting and inserting around the source, which keeps the source's line layout | Writes new text from sveast's AST, copying source ranges into it and writing everything else itself                                 |
| Parsing                    | `svelte/compiler`'s parser for the markup, and TypeScript's `ts.createSourceFile` to analyze the scripts, so `typescript` is a peer dependency  | sveast parses the component and resolves its scopes (props, runes, stores, `{#each}`, `let:` and snippet scopes) without TypeScript |
| Position mapping           | A source map from MagicString, which svelte-check uses to map each diagnostic back                                                              | A table of copied ranges and spans, searched by offset                                                                              |
| Hiding errors in helpers   | Helper code is wrapped in `/*Ωignore_startΩ*/ … /*Ωignore_endΩ*/` comments, and svelte-check's `isInGeneratedCode` drops errors between them    | No markers: text that wasn't copied or spanned has no source position, so an error there is dropped                                 |
| Helpers                    | `__sveltets_2_*` functions in `svelte-shims-v4.d.ts`, which svelte-check adds to the language service's files                                   | `$$check.*` in `shims.d.ts`, listed in the generated tsconfig. The names a message can print keep svelte2tsx's spelling             |
| Component type             | Inferred from a helper call on `$$render()`, in a variable named after the file (`Counter__SvelteComponent_`)                                   | Declared with the type written out (`declare const $$Component: Component<…>`)                                                      |
| Where the code lives       | In memory, as a snapshot per file in TypeScript's language service                                                                              | On disk in the output folder, so any checker that reads a tsconfig can check it, and you can open the files                         |
| How the program is checked | The language service is asked for each file's diagnostics, one file at a time                                                                   | One run of `tsc`, tsgo, tsrs or `bun check` over the whole program, with incremental build info kept between runs                   |

The helpers do the same jobs under different names:

| svelte2tsx                                                             | svelte-typecheck                     | Checks                                                        |
| :--------------------------------------------------------------------- | :----------------------------------- | :------------------------------------------------------------ |
| `__sveltets_2_ensureArray`                                             | `$$check.each`                       | `{#each}` gets an array-like value, and what its items are    |
| `__sveltets_2_store_get`                                               | `$$check.store`                      | `$name` reads a store, and gives the store's value type       |
| `__sveltets_2_invalidate`                                              | `$$check.reactive`                   | A `$:` declaration's type                                     |
| `__sveltets_2_ensureComponent`                                         | `$$check.component`                  | A tag names a component, and its constructor                  |
| `__sveltets_2_ensureSnippet`                                           | `$$check.snippet`                    | `{@render}` calls a snippet                                   |
| `__sveltets_$$bindings`                                                | `$$check.bindings`                   | Which props are bindable                                      |
| `__sveltets_2_any`                                                     | `$$check.any`                        | A value of any type, where only the shape of the code matters |
| `__sveltets_2_fn_component`, `__sveltets_2_isomorphic_component_slots` | the `declare const $$Component` type | The component's type                                          |

svelte-typecheck doesn't use svelte2tsx itself, for two reasons. svelte2tsx needs the `typescript` package to analyze scripts, and writing the code from sveast's AST removes that dependency, which is what lets the checker be TypeScript 7, tsrs or `bun check`. It's also faster: sveast parses and generates every component in carbon-components-svelte in about 0.4 s, and mapping a position is a lookup in a table the generator already has, with no source map to decode. Matching svelte2tsx's output closely is still necessary, because the messages users see come from TypeScript's view of that output. Where the two differ, the parity tests compare svelte-typecheck's diagnostics with svelte-check's on the same fixtures, and any difference kept on purpose is listed in [Compared with svelte-check](svelte-check.md#differences-from-svelte-check).
