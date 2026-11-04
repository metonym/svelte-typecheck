import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BunPlugin } from "bun";

const root = resolve(import.meta.dir, "..");
const src = join(root, "src");
const dist = join(root, "dist");
const ENTRIES = ["index", "cli"];
const DIST_PREFIX = /"(\.\/)?dist\//;
const IMPORT = /^\s*import\b/m;
const PACKAGE_JSON = /[\\/]package\.json$/;
const STRIP_FIELDS = ["devDependencies", "scripts"];

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
    plugins: [versionOnly],
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
  ["README.md", "LICENSE", "CHANGELOG.md"].map((file) =>
    cp(join(root, file), join(dist, file)),
  ),
);
// The generated code's ambient types, which the checker reads from disk.
await cp(join(src, "shims"), join(dist, "shims"), { recursive: true });
console.log("✓ Build completed");
