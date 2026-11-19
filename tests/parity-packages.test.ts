// svelte-check and svelte-typecheck on imports of packages, and on a
// SvelteKit project.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { binOf, ours, root, svelte5, svelteCheck } from "./parity.ts";

describe("svelte-check parity, machine output", () => {
  // An import of the package's own name reads the package.json above the
  // importing file, not the one beside the tsconfig.
  it("matches svelte-check on an import of the package's own name from another folder", () => {
    const cwd = join(svelte5, ".tmp/self-exports");
    const files = {
      "package.json": JSON.stringify({
        name: "lib",
        type: "module",
        exports: { "./src/*.svelte": { types: "./src/*.svelte.d.ts" } },
      }),
      "src/Button.svelte": "<button>x</button>\n",
      "src/Button.svelte.d.ts": [
        'import { SvelteComponent } from "svelte";',
        "export default class Button extends SvelteComponent<{ size: number }> {}",
      ].join("\n"),
      "check/package.json": JSON.stringify({ name: "check", private: true }),
      "check/tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          moduleResolution: "bundler",
          paths: { "lib/*": ["../src/*"] },
        },
        include: ["../tests"],
      }),
      "tests/App.svelte": [
        '<script lang="ts">',
        '  import Button from "lib/src/Button.svelte";',
        '  import Missing from "lib/src/Missing.svelte";',
        "</script>",
        '<Button size="l" />',
        "<Missing />",
      ].join("\n"),
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), content);
    }
    const args = [
      "--workspace",
      join(cwd, "tests"),
      "--tsconfig",
      join(cwd, "check/tsconfig.json"),
    ];
    const expected = svelteCheck(args, cwd);
    expect(expected.filter((line) => line.startsWith("ERROR"))).toHaveLength(2);
    expect(ours(args, cwd)).toEqual(expected);
  }, 60_000);

  it("matches svelte-check in a SvelteKit project", () => {
    const cwd = join(root, "tests/projects/kit");
    // SvelteKit writes `./$types` and the tsconfig the project extends.
    const [node = "", kit = ""] = binOf(cwd, "@sveltejs/kit", "svelte-kit.js");
    spawnSync(node, [kit, "sync"], { cwd });
    expect(ours([], cwd)).toEqual(svelteCheck([], cwd));
  }, 60_000);

  // A package with a JS entry, and types the import can't use: TypeScript
  // says where they are, and svelte-check's TypeScript doesn't know.
  it.each([
    [
      "types only in exports, under moduleResolution node",
      "untyped-node10",
      { moduleResolution: "node", ignoreDeprecations: "6.0" },
      "pkg",
      {
        "package.json": {
          name: "pkg",
          version: "1.0.0",
          exports: {
            ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
          },
        },
        "index.js": "export const c = 1;\n",
        "dist/index.d.ts": "export declare const c: number;\n",
        "dist/index.js": "export const c = 1;\n",
      },
    ],
    [
      "types outside exports, in a scoped package",
      "untyped-bundler",
      { moduleResolution: "bundler" },
      "@scope/pkg",
      {
        "package.json": {
          name: "@scope/pkg",
          version: "1.0.0",
          exports: { ".": { import: "./dist/index.js" } },
        },
        "index.d.ts": "export declare const c: number;\n",
        "dist/index.js": "export const c = 1;\n",
      },
    ],
  ])(
    "matches svelte-check on an untyped package import with %s",
    (_, name, options, pkg, files) => {
      const cwd = join(svelte5, ".tmp", name);
      const write = (file: string, content: unknown) => {
        mkdirSync(dirname(join(cwd, file)), { recursive: true });
        writeFileSync(
          join(cwd, file),
          typeof content === "string" ? content : JSON.stringify(content),
        );
      };
      write("tsconfig.json", {
        // Without skipLibCheck, Svelte's own types fail to resolve under
        // `node`; that's #74.
        compilerOptions: {
          strict: true,
          module: "esnext",
          skipLibCheck: true,
          ...options,
        },
      });
      for (const [file, content] of Object.entries(files))
        write(`node_modules/${pkg}/${file}`, content);
      write("y.ts", `import { c } from "${pkg}";\nexport const d = c;\n`);
      write(
        "App.svelte",
        `<script lang="ts">\n  import { c } from "${pkg}";\n</script>\n\n{c}\n`,
      );
      const expected = svelteCheck([], cwd);
      expect(
        expected.filter((line) => line.includes("Try `npm i")),
      ).toHaveLength(2);
      expect(ours([], cwd)).toEqual(expected);
    },
    60_000,
  );

  // Under `moduleResolution: node`, TypeScript adds where it found types
  // that the import can't use.
  it("matches svelte-check on an import that finds types only in exports", () => {
    const cwd = join(svelte5, ".tmp/exports-only-types");
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "node",
          ignoreDeprecations: "6.0",
        },
      }),
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        exports: { "./sub": { types: "./dist/sub.d.ts" } },
      }),
      "node_modules/pkg/dist/sub.d.ts": "export const a: number;\n",
      "x.ts": 'import { a } from "pkg/sub";\nexport const b = a;\n',
      "App.svelte": [
        '<script lang="ts">',
        '  import { a } from "pkg/sub";',
        "</script>",
        "{a}",
      ].join("\n"),
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), content);
    }
    const unresolved = (lines: string[]) =>
      lines.filter((line) => line.includes("pkg/sub"));
    const expected = unresolved(svelteCheck([], cwd));
    expect(expected).toHaveLength(2);
    expect(unresolved(ours([], cwd))).toEqual(expected);
  }, 60_000);

  // A Svelte library's `exports` can name a component as its types.
  it("matches svelte-check on a package whose exports' types are components", () => {
    const cwd = join(svelte5, ".tmp/exports-components");
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, moduleResolution: "bundler" },
      }),
      "node_modules/lib/package.json": JSON.stringify({
        name: "lib",
        type: "module",
        exports: {
          "./editor": {
            types: "./src/Editor.svelte",
            svelte: "./src/Editor.svelte",
          },
          "./components/*": {
            types: "./src/*.svelte",
            svelte: "./src/*.svelte",
          },
        },
      }),
      "node_modules/lib/src/types.ts": "export type Version = number;\n",
      "node_modules/lib/src/Editor.svelte": [
        '<script lang="ts">',
        '  import type { Version } from "./types.js";',
        '  import Toolbar from "./Toolbar.svelte";',
        "  let { onversion }: { onversion: (v: Version) => void } = $props();",
        "</script>",
        "<Toolbar /><button onclick={() => onversion(1)}>x</button>",
      ].join("\n"),
      // svelte-check reports nothing in a package's component.
      "node_modules/lib/src/Toolbar.svelte": [
        '<script lang="ts">',
        '  let { label = "x" }: { label?: string } = $props();',
        '  const unused: number = "a";',
        "</script>",
        "<span>{label}</span>",
      ].join("\n"),
      "node_modules/@scope/ui/package.json": JSON.stringify({
        name: "@scope/ui",
        type: "module",
        exports: { ".": { types: "./Button.svelte" } },
      }),
      "node_modules/@scope/ui/Button.svelte": [
        '<script lang="ts">',
        '  let { size }: { size: "s" | "m" } = $props();',
        "</script>",
        "<button>{size}</button>",
      ].join("\n"),
      "App.svelte": [
        '<script lang="ts">',
        '  import Editor from "lib/editor";',
        '  import Toolbar from "lib/components/Toolbar";',
        '  import Button from "@scope/ui";',
        '  import Missing from "lib/components/Missing";',
        "</script>",
        "<Editor onversion={(v) => v.toFixed()} />",
        '<Editor onversion="nope" />',
        "<Toolbar label={1} />",
        '<Button size="l" />',
        "<Missing />",
      ].join("\n"),
      "props.ts": [
        'import type { ComponentProps } from "svelte";',
        'import type Toolbar from "lib/components/Toolbar";',
        "export const props: ComponentProps<typeof Toolbar> = { label: 2 };",
      ].join("\n"),
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), content);
    }
    const expected = svelteCheck([], cwd);
    expect(expected.filter((line) => line.startsWith("ERROR"))).toHaveLength(5);
    expect(ours([], cwd)).toEqual(expected);
  }, 60_000);
});
