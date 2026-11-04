/* eslint-disable typescript/no-explicit-any, typescript/consistent-type-imports -- the shapes keep Svelte's. */
// Element typings for Svelte 3, which ships `svelte/elements` but no
// `svelteHTML` (Svelte 4 and 5 have svelte/svelte-html.d.ts). Adapted from
// Svelte 4's svelte-html.d.ts (MIT, https://github.com/sveltejs/svelte),
// without the deprecated `svelte.JSX` namespace svelte2tsx still declares.
/// <reference lib="dom" />
// @ts-nocheck
// nocheck: Svelte before 3.55 has no `svelte/elements`.

declare namespace svelteHTML {
  function mapElementTag<K extends keyof ElementTagNameMap>(
    tag: K,
  ): ElementTagNameMap[K];
  function mapElementTag<K extends keyof SVGElementTagNameMap>(
    tag: K,
  ): SVGElementTagNameMap[K];
  function mapElementTag(tag: any): any; // `<svelte:element>`

  function createElement<
    Elements extends IntrinsicElements,
    Key extends keyof Elements,
  >(
    element: Key | undefined | null,
    attrs: string extends Key
      ? import("svelte/elements").HTMLAttributes<any>
      : Elements[Key],
  ): Key extends keyof ElementTagNameMap
    ? ElementTagNameMap[Key]
    : Key extends keyof SVGElementTagNameMap
      ? SVGElementTagNameMap[Key]
      : any;
  function createElement<
    Elements extends IntrinsicElements,
    Key extends keyof Elements,
    T,
  >(
    element: Key | undefined | null,
    attrsEnhancers: T,
    attrs: (string extends Key
      ? import("svelte/elements").HTMLAttributes<any>
      : Elements[Key]) &
      T,
  ): Key extends keyof ElementTagNameMap
    ? ElementTagNameMap[Key]
    : Key extends keyof SVGElementTagNameMap
      ? SVGElementTagNameMap[Key]
      : any;

  // For a project to augment, as with Svelte 4's.
  interface HTMLAttributes<T extends EventTarget = any> {}
  interface SVGAttributes<T extends EventTarget = any> {}

  type HTMLProps<Property, Override> = Omit<
    import("svelte/elements").SvelteHTMLElements[Property],
    keyof Override
  > &
    Override;

  /** Svelte 4's list, mapped rather than spelled out per element. */
  type MappedElements = {
    [
      K in keyof import("svelte/elements").SvelteHTMLElements
    ]: K extends `svelte:${string}`
      ? import("svelte/elements").SvelteHTMLElements[K]
      : HTMLProps<
          K,
          K extends keyof HTMLElementTagNameMap
            ? HTMLAttributes
            : K extends keyof SVGElementTagNameMap
              ? SVGAttributes
              : HTMLAttributes
        >;
  };
  interface IntrinsicElements extends MappedElements {}
}
