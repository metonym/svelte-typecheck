import { posix } from "node:path";
import type { TypecheckResult } from "../src/types.ts";

/**
 * The errors svelte-typecheck found in generated code that maps to no
 * source, and printed nowhere else in the same file, once each, as
 * `path/File.svelte: message` from `cwd`. svelte-check hides its generated
 * code's errors too, but a gap in a source map hides a real one this way,
 * and leaves no line to compare. Generated code repeats a component's type
 * parameters, so most copies of a printed error are dropped, and skipped.
 */
export function unprinted(
  cwd: string,
  { diagnostics, dropped }: Pick<TypecheckResult, "diagnostics" | "dropped">,
): string[] {
  // A generated file sits at `<outDir>/svelte/<path from cwd>/`, a
  // component's as `++File.svelte.ts`.
  const slashes = (path: string) => path.replaceAll("\\", "/");
  const source = (file: string) =>
    posix.relative(
      slashes(cwd),
      slashes(file).replace(
        /\/node_modules\/\.cache\/svelte-typecheck\/(?:.*?\/)?svelte\/(?:(.*)\/)?\+*([^/]+?)(?:(\.svelte)\.ts)?$/,
        (_, dir = "", name, svelte = "") => `/${dir}/${name}${svelte}`,
      ),
    );
  const printed = new Set(
    diagnostics.map((d) => `${source(d.file)}: ${d.message}`),
  );
  return [
    ...new Set(dropped.map((d) => `${source(d.file)}: ${d.message}`)),
  ].filter((line) => !printed.has(line));
}
