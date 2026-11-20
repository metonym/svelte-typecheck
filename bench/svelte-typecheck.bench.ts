import { group, task } from "ostia";
import { parse } from "svelte-ast";
import { analyzeScopes } from "svelte-ast/scope";
import { emit } from "../src/emit.ts";
import { sources } from "./corpus.ts";

const components = await sources();

group(`per component (${components.length} components)`, () => {
  task(
    "svelte-ast: parse and scopes",
    () => {
      for (const [, source] of components)
        analyzeScopes(parse(source, { css: false }));
    },
    { baseline: true },
  );
  task("emit: parse, scopes and TypeScript", () => {
    for (const [, source] of components) emit(source);
  });
});
