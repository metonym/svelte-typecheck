import type Gone from "./lib/Gone.svelte";
import Real from "./lib/Real.svelte";
export { default as Again } from "./lib/ReExported.svelte";
import "$lib/SideEffect.svelte";

export type Props = typeof Gone;
export const loaded = [Real, import("./lib/Lazy.svelte")];
