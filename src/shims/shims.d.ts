/* eslint-disable typescript/no-explicit-any, typescript/consistent-type-imports, typescript/consistent-type-definitions, typescript/no-namespace --
   these stand in for Svelte's runtime, which accepts anything here; an
   ambient file can't import, so types come from `import("svelte")`; and
   the visible shapes are svelte-check's. */
// The types the generated code is checked against. Nothing here runs:
// each declaration tells the checker what Svelte does at runtime.
//
// Most of it is the `$$check` namespace, svelte-typecheck's own. A Svelte
// script can't declare a `$$` name, so none collides with a component's.
// The rest are the names a message can print, which svelte-check's
// messages print too: they keep svelte2tsx's names and shapes (MIT,
// https://github.com/sveltejs/language-tools), so the messages match.

// --- Printed in messages, as svelte-check prints them.

/** `$x` of a value that isn't one: "(store: SvelteStore<any>): any". */
type SvelteStore<T> = {
  subscribe: (run: (value: T) => any, invalidate?: any) => any;
};
/** What `use:action` may return. */
type __sveltets_2_SvelteActionReturnType = {
  update?: (args: any) => void;
  destroy?: () => void;
  $$_attributes?: Record<string, any>;
} | void;
type __sveltets_2_SvelteTransitionConfig = {
  delay?: number;
  duration?: number;
  easing?: (t: number) => number;
  css?: (t: number, u: number) => string;
  tick?: (t: number, u: number) => void;
};
/** What `transition:`, `in:` and `out:` may return. */
type __sveltets_2_SvelteTransitionReturnType =
  | __sveltets_2_SvelteTransitionConfig
  | (() => __sveltets_2_SvelteTransitionConfig);
/** What `animate:` may return. */
type __sveltets_2_SvelteAnimationReturnType = {
  delay?: number;
  duration?: number;
  easing?: (t: number) => number;
  css?: (t: number, u: number) => string;
  tick?: (t: number, u: number) => void;
};
/** What a component used in markup may be, besides a Svelte 5 one. */
declare type ConstructorOfATypedSvelteComponent = new (args: {
  target: any;
  props?: any;
}) => $$check.Typed;
/** A legacy component: both `new`-able (Svelte 4) and callable (Svelte 5). */
interface __sveltets_2_IsomorphicComponent<
  Props extends Record<string, any> = any,
  Events extends Record<string, any> = any,
  Slots extends Record<string, any> = any,
  Exports = {},
  Bindings = string,
> {
  new (
    options: import("svelte").ComponentConstructorOptions<Props>,
  ): import("svelte").SvelteComponent<Props, Events, Slots> & {
    $$bindings?: Bindings;
  } & Exports;
  (
    internal: unknown,
    props: Props extends Record<string, never>
      ? { $$events?: Events; $$slots?: Slots }
      : Props & { $$events?: Events; $$slots?: Slots },
  ): Exports & { $set?: any; $on?: any };
  z_$$bindings?: Bindings;
}
/** A component with a default `<slot>` also takes a `children` prop. */
type __sveltets_2_PropsWithChildren<Props, Slots> = Props &
  (Slots extends { default: any }
    ? Props extends Record<string, never>
      ? any
      : { children?: any }
    : {});

declare namespace $$check {
  // --- Values.

  /** A value of any type, after checking what it's given. */
  function any(...checked: any[]): any;
  /** Nothing, after checking what it's given: a `data-` attribute. */
  function none(...checked: any[]): {};
  /**
   * Slot content, as Svelte 5 passes it: svelte2tsx's `() => any` arrow,
   * one type for every use, so each component's `children` is compared
   * with it once.
   */
  const children: () => any;
  /** A component's `target`, which is never checked. */
  const target: any;
  /** `$$props` and `$$restProps`. */
  function props(): { [index: string]: any };
  /** `$: x = value` declares `x` with the value's type. */
  function reactive<T>(value: () => T): T;
  /** `$x`: the store's value. */
  function store<T = any>(store: SvelteStore<T>): T;
  function store<Store extends SvelteStore<any> | undefined | null>(
    store: Store,
  ): Store extends SvelteStore<infer T> ? T : Store;

  // --- Markup.

  /** `{#each}` takes an array or iterable, and in Svelte 5 `null`. */
  function each<T extends ArrayLike<unknown> | Iterable<unknown>>(
    array:
      | T
      | (typeof import("svelte") extends { mount: any }
          ? undefined | null
          : never),
  ): T extends ArrayLike<infer U>
    ? U[]
    : T extends Iterable<infer U>
      ? Iterable<U>
      : any[];
  /** An `{#each}` item, as a slot prop that is one is typed. */
  function item<T>(array: ArrayLike<T>): T;
  /** `use:action`: what it adds to the element's attributes. */
  function action<T extends __sveltets_2_SvelteActionReturnType>(
    returned: T,
  ): T extends { $$_attributes?: any } ? T["$$_attributes"] : {};
  /**
   * What an element's actions add to its attributes, together. Ten optional
   * parameters, as svelte2tsx's `__sveltets_2_union` has them: TypeScript
   * then infers the element's attributes from the attributes alone, as it
   * does for svelte-check, rather than from what's added too.
   */
  function attributes<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(
    t1: T1,
    t2?: T2,
    t3?: T3,
    t4?: T4,
    t5?: T5,
    t6?: T6,
    t7?: T7,
    t8?: T8,
    t9?: T9,
    t10?: T10,
  ): T1 & T2 & T3 & T4 & T5 & T6 & T7 & T8 & T9 & T10;
  function transition(returned: __sveltets_2_SvelteTransitionReturnType): {};
  function animation(returned: __sveltets_2_SvelteAnimationReturnType): {};
  /** An animation's second argument. */
  const move: { from: DOMRect; to: DOMRect };
  /** A DOM event an element forwards with a bare `on:event`. */
  function domEvent<K extends keyof HTMLElementEventMap>(
    event: K,
  ): HTMLElementEventMap[K];
  /** `bind:x={get, set}`: `set` takes what `get` returns. */
  function getSet<T>(get: (() => T) | null | undefined, set: (t: T) => void): T;
  /**
   * A `<svelte:element>` tag, as `string` when it may be any element (a
   * component's generic tag): typed as every element's tag, its attributes
   * are a union TypeScript can't represent. A smaller union keeps its tags.
   */
  function elementTag<T extends string>(
    tag: T | undefined | null,
  ): keyof HTMLElementTagNameMap extends T ? string : T;
  /** `{@render x()}`, which takes only a snippet's result. */
  function snippet(
    // @ts-ignore Svelte 5 only
    rendered: ReturnType<import("svelte").Snippet> | undefined | null,
  ): any;

  // --- `$$Props`, `$$Events` and `$$Slots`.

  /** Checks that `$$Props` agrees with the `export let`s. */
  function matches<Props>(props: Props): {};
  /** `$$Events` as `createEventDispatcher`'s type argument. */
  type Details<T> = {
    [K in KeysMatching<T, CustomEvent>]: T[K] extends CustomEvent
      ? T[K]["detail"]
      : T[K];
  };
  type KeysMatching<T, V> = {
    [K in keyof T]-?: T[K] extends V ? K : never;
  }[keyof T];
  /** `createEventDispatcher<Typings>()`'s events. */
  function dispatched<Typings>(): {
    [K in keyof Typings]: CustomEvent<Typings[K]>;
  };
  /** A `<slot>` whose props `$$Slots` declares. */
  function slots<Slots = Record<string, Record<string, any>>>(): <
    Name extends keyof Slots,
  >(
    slotName: Name,
    attrs: Slots[Name],
  ) => Record<string, any>;

  // --- Components.

  /** A component instance, as `new` makes one. */
  type Typed = {
    $$prop_def: any;
    $$events_def: any;
    $$slot_def: any;
    $on(event: string, handler: any): () => void;
  };
  /**
   * A component to `new` with its props: a class component (sveld's
   * `.d.ts`, Svelte 3 and 4) as it is, a Svelte 5 function one as a class.
   */
  function component<
    T extends
      | ConstructorOfATypedSvelteComponent
      | (typeof import("svelte") extends { mount: any }
          ? // @ts-ignore svelte.Component doesn't exist in Svelte 4
            import("svelte").Component<any, any, any>
          : never)
      | null
      | undefined,
  >(
    type: T,
  ): NonNullable<
    T extends ConstructorOfATypedSvelteComponent
      ? T
      : typeof import("svelte") extends { mount: any }
        ? // @ts-ignore svelte.Component doesn't exist in Svelte 4
          T extends import("svelte").Component<
            infer Props extends Record<string, any>,
            infer Exports extends Record<string, any>,
            infer Bindings extends string
          >
          ? new (
              options: import("svelte").ComponentConstructorOptions<Props>,
            ) => import("svelte").SvelteComponent<
              Props,
              Props["$$events"],
              Props["$$slots"]
            > &
              Exports & { $$bindings: Bindings }
          : never
        : never
  >;
  /** The props a runes component lets a parent `bind:`. */
  function bindings<B extends string[]>(...bindings: B): B[number];

  // --- A legacy component's type, from what `$$render` returns. Each
  // spells out a mapped type, so a message prints the props, not these.

  type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;
  /** A JS component's props: one that's only ever `undefined` is any. */
  type Loose<Props> = {
    [K in keyof Props]: Props[K] extends never
      ? never
      : Props[K] extends undefined
        ? any
        : Props[K];
  };
  type LooseSlots<Slots> = {
    [K in keyof Slots]: {
      [S in keyof Slots[K]]: Slots[K][S] extends undefined ? any : Slots[K][S];
    };
  };
  /** Props with a default are optional. */
  type WithOptional<Props, Keys extends keyof Props> = Omit<Props, Keys> &
    Partial<Pick<Props, Keys>>;
}
