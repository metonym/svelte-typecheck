// svelte-check and svelte-typecheck on the tsconfig options that change
// what they check.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ours, svelte5, svelteCheck } from "./parity.ts";

describe("svelte-check parity, machine output", () => {
  // A deprecated option stops tsc before it type-checks, and svelte-check
  // checks anyway and warns of the option, at it or at `compilerOptions`.
  it("matches svelte-check with deprecated options in a tsconfig and its base", () => {
    const cwd = join(svelte5, "deprecated");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // svelte-check raises `target: "es5"` to ES2015 and `module: "commonjs"`
  // to ESNext, so a component's `import.meta` and `for...of` are valid.
  it("matches svelte-check with an ES5 target and a CommonJS module", () => {
    const cwd = join(svelte5, "old-module");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // Without `allowJs`, an import of a JS component has no declaration.
  it("matches svelte-check on imports of a JS component without allowJs", () => {
    const cwd = join(svelte5, "untyped");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // `${configDir}` is the folder of the tsconfig compiled, not of the
  // base that sets it.
  it("matches svelte-check with ${configDir} in an extended tsconfig", () => {
    const cwd = join(svelte5, "config-dir");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check with ${configDir} in the tsconfig", () => {
    const cwd = join(svelte5, ".tmp/config-dir");
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
        },
        include: ["${configDir}/src"],
      }),
    );
    writeFileSync(
      join(cwd, "src/App.svelte"),
      '<script lang="ts">\n  let n: number = "a";\n</script>\n\n{n}\n',
    );
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // TypeScript turns `allowJs` on with `checkJs`.
  it("matches svelte-check with checkJs and no allowJs", () => {
    const cwd = join(svelte5, "checkjs");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check's message rewrites and filters", () => {
    const cwd = join(svelte5, "filters");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  it("matches svelte-check with @ts-expect-error above an import", () => {
    const cwd = join(svelte5, "ts-comments");
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);
});
