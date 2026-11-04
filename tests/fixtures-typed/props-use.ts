import Props from "./Props.svelte";
import Typed from "./Typed.svelte";

new Props({ target: document.body, props: { count: "one", class: 1, version: 2 } });
new Props({ target: document.body, props: {} });
export const wrong: typeof Typed = Props;
