import { mount, type Component, type ComponentProps } from "svelte";
import Legacy from "./Legacy.svelte";
import Typed from "./Typed.svelte";
import Runes from "./Runes.svelte";

mount(Legacy, { target: document.body, props: { count: "one" } });
mount(Runes, { target: document.body, props: { title: 1 } });
new Typed({ target: document.body, props: { size: "x" } });
const a: typeof Typed = Legacy;
const b: typeof Runes = Legacy;
const c: Component<{ title: number }> = Runes;
const d: ComponentProps<typeof Legacy> = { count: "x" };
const e: ComponentProps<typeof Runes> = {};
export { a, b, c, d, e };
