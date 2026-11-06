import { chmod, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BunPlugin } from "bun";

const root = resolve(import.meta.dir, "..");
const src = join(root, "src");
const dist = join(root, "dist");
const ENTRIES = ["index", "cli", "compile-worker"];
const DIST_PREFIX = /"(\.\/)?dist\//;
const IMPORT = /^\s*import\b/m;
const PACKAGE_JSON = /[\\/]package\.json$/;
const SHIMS = /[\\/]src[\\/]shims\.ts$/;
/** A string, which can hold `//`, or a comment. */
const STRING_OR_COMMENT =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*|\/\*[\s\S]*?\*\//g;
/** `/// <reference>` and `// @ts-nocheck`, which mean something. */
const DIRECTIVE = /^\/\/(?:\/|\s*@ts-)/;
const STRIP_FIELDS = ["devDependencies", "scripts", "workspaces"];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// src/ reads only the version from package.json; without this, the bundle
// would carry the whole manifest.
const versionOnly: BunPlugin = {
  name: "svelte-typecheck-version-only",
  setup(build) {
    build.onLoad({ filter: PACKAGE_JSON }, async ({ path }) => {
      const { version }: { version: string } = await Bun.file(path).json();
      return { contents: JSON.stringify({ version }), loader: "json" };
    });
  },
};

/** A shim as the checker needs it: no comments, no indentation. */
function strip(text: string): string {
  return text
    .replace(STRING_OR_COMMENT, (token) =>
      token.startsWith("/") && !DIRECTIVE.test(token) ? "" : token,
    )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// src/shims.ts reads each shim from disk; the bundle carries them inline.
const inlineShims: BunPlugin = {
  name: "svelte-typecheck-inline-shims",
  setup(build) {
    build.onLoad({ filter: SHIMS }, async () => {
      const dir = join(src, "shims");
      const shims = Object.fromEntries(
        await Promise.all(
          (await readdir(dir)).map(async (file) => [
            file,
            strip(await Bun.file(join(dir, file)).text()),
          ]),
        ),
      );
      return {
        contents: `const SHIMS = ${JSON.stringify(shims)};\nexport function shim(file) { return SHIMS[file]; }\n`,
        loader: "js",
      };
    });
  },
};

async function bundle() {
  const result = await Bun.build({
    entrypoints: ENTRIES.map((entry) => join(src, `${entry}.ts`)),
    root: src,
    outdir: dist,
    naming: { entry: "[name].[ext]", chunk: "shared-[hash].[ext]" },
    target: "node",
    format: "esm",
    splitting: true,
    // sveast is bundled, so the package has no dependencies. Svelte's
    // compiler is the project's own, loaded from the project.
    external: ["svelte", "svelte/*"],
    // Names stay readable in a stack trace from a user's CI log.
    minify: { whitespace: true, syntax: true, identifiers: false },
    plugins: [versionOnly, inlineShims],
  });
  if (!result.success) {
    fail(`build failed:\n${result.logs.map(String).join("\n")}`);
  }
  await chmod(join(dist, "cli.js"), 0o755);
}

// src/types.ts is the public API's declarations, written by hand, and
// imports nothing, so it's index.d.ts as is: a consumer sees only the API.
async function writeDeclarations() {
  const text = await Bun.file(join(src, "types.ts")).text();
  if (IMPORT.test(text)) fail("src/types.ts must import nothing");
  await writeFile(join(dist, "index.d.ts"), text);
}

async function writeManifest() {
  const manifest: Record<string, unknown> = await Bun.file(
    join(root, "package.json"),
  ).json();
  for (const field of STRIP_FIELDS) delete manifest[field];
  // `bin` paths have no `./`: `npm pkg fix` strips it, and publish drops
  // a bin it has to correct.
  const text = JSON.stringify(manifest, null, 2)
    .replaceAll('"./dist/', '"./')
    .replaceAll('"dist/', '"');
  if (DIST_PREFIX.test(text)) fail("package.json still points into dist/");
  await writeFile(join(dist, "package.json"), `${text}\n`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await bundle();
await writeDeclarations();
await writeManifest();
await Promise.all(
  ["README.md", "LICENSE"].map((file) =>
    cp(join(root, file), join(dist, file)),
  ),
);
console.log("✓ Build completed");
