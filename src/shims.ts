import { shimText } from "./shim-text.ts" with { type: "macro" };

/** A file in `shims/`: the generated code's ambient types. */
export function shim(file: "shims.d.ts" | "svelte3-elements.d.ts"): string {
  return file === "shims.d.ts"
    ? shimText("shims.d.ts")
    : shimText("svelte3-elements.d.ts");
}
