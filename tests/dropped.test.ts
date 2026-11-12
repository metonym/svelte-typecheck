// An error svelte-typecheck finds in generated code that maps to no
// source is dropped, as svelte-check drops its own. A gap in a source map
// drops a real error the same way, with no line to compare: parity can't
// see it. This lists, for each test project, the errors dropped and
// printed nowhere else, each with the reason svelte-check hides it too.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { typecheck } from "../src/check.ts";
import { unprinted } from "./unprinted.ts";

const projects = join(import.meta.dir, "projects");

/** Each folder checked, and the errors dropped there, as `path/File: message`. */
const DROPPED: [string, string[]][] = [
  ["svelte5/basic", []],
  ["svelte5/typed", []],
  [
    "svelte5/generic",
    // svelte2tsx copies a `$$Generic` type unmapped, so svelte-check
    // reports nothing there either.
    [
      "LegacyConstraint.svelte: Cannot find name 'Missing'.",
      // svelte2tsx keeps `const` on the type alias it declares too.
      "Pick.svelte: 'const' modifier can only appear on a type parameter of a function, method or class",
    ],
  ],
  ["svelte5/runes", []],
  ["svelte5/edge", []],
  ["svelte5/helpers", []],
  ["svelte5/untyped", []],
  ["svelte5/filters", []],
  [
    "kit",
    // An async `handle` gets the `ReturnType<Handle>` svelte2tsx gives it,
    // which isn't a Promise: svelte-check hides that error too.
    [
      "src/hooks.server.ts: The return type of an async function or method must be the global Promise<T> type. Did you mean to write 'Promise<Response>'?",
    ],
  ],
  ["svelte3", []],
  ["svelte4", []],
  ["preprocess", []],
  ["ts7", []],
];

describe("dropped errors", () => {
  beforeAll(() => {
    // SvelteKit writes `./$types` and the tsconfig the project extends.
    const cwd = join(projects, "kit");
    for (let dir = cwd; ; dir = dirname(dir)) {
      const kit = join(dir, "node_modules/@sveltejs/kit/svelte-kit.js");
      if (existsSync(kit)) {
        spawnSync("node", [kit, "sync"], { cwd });
        break;
      }
      if (dirname(dir) === dir) throw new Error("no @sveltejs/kit");
    }
  });

  it.each(DROPPED)(
    "drops only the known errors in %s",
    async (folder, expected) => {
      const cwd = realpathSync(join(projects, folder));
      const result = await typecheck({ cwd, incremental: false });
      expect(unprinted(cwd, result)).toEqual(expected);
    },
    60_000,
  );
});
