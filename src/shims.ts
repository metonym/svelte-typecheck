import { readFileSync } from "node:fs";

/**
 * A file in `shims/`: the generated code's ambient types. The build inlines
 * each one, without its comments, so the package ships no `.d.ts` beside its
 * own.
 */
export function shim(file: "shims.d.ts" | "svelte3-elements.d.ts"): string {
  return readFileSync(new URL(`./shims/${file}`, import.meta.url), "utf-8");
}
