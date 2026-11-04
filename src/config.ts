import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** A `preprocess` entry from a Svelte config. */
export type Preprocessor = Record<string, unknown>;

/** What the compiler pass reads from the project's Svelte config. */
export interface SvelteConfig {
  preprocess?: Preprocessor[];
  /** As svelte-check compiles: `dev`, then the config's. */
  compilerOptions: Record<string, unknown>;
}

interface RawConfig {
  preprocess?: Preprocessor | Preprocessor[];
  compilerOptions?: Record<string, unknown>;
}

const VITE_CONFIGS = ["js", "mjs", "ts", "cjs", "mts", "cts"].map(
  (ext) => `vite.config.${ext}`,
);
/** `svelte.config.ts` only where the runtime runs TypeScript: Bun, or Node 22.6+ stripping types. */
const SVELTE_CONFIGS = [
  "js",
  "cjs",
  "mjs",
  ...(process.versions.bun ||
  (process.features as { typescript?: unknown }).typescript
    ? ["ts", "mts"]
    : []),
].map((ext) => `svelte.config.${ext}`);
const SVELTE_CONFIG = /^svelte\.config\./;

/**
 * The project's Svelte config, found as svelte-check finds it (through
 * `@sveltejs/load-config`): from `dir` up, a folder's vite.config first,
 * resolved by the project's own Vite for SvelteKit's or vite-plugin-svelte's
 * options, then its svelte.config. Nothing found, or a config that fails
 * to load, is no config.
 */
export async function svelteConfigOf(
  dir: string,
  explicit?: string,
): Promise<SvelteConfig> {
  const config =
    (explicit ? await fromFile(explicit) : await fromDir(dir)) ?? {};
  const { preprocess } = config;
  return {
    preprocess:
      preprocess && (Array.isArray(preprocess) ? preprocess : [preprocess]),
    compilerOptions: { dev: true, ...config.compilerOptions },
  };
}

/**
 * What the config found from `dir` (or `explicit`) depends on: every
 * vite.config and svelte.config from there up, each path and its text.
 * Cheap to read, so a cache of the compiler pass can tell whether the
 * config changed without loading it.
 */
export function configFingerprint(dir: string, explicit?: string): string {
  const parts: string[] = [];
  const add = (path: string) => {
    try {
      parts.push(path, readFileSync(path, "utf-8"));
    } catch {
      // Gone between the check and the read.
    }
  };
  if (explicit) add(explicit);
  else
    for (let at = dir; ; at = dirname(at)) {
      for (const name of [...VITE_CONFIGS, ...SVELTE_CONFIGS]) {
        const path = join(at, name);
        if (existsSync(path)) add(path);
      }
      if (dirname(at) === at) break;
    }
  return JSON.stringify(parts);
}

const firstIn = (dir: string, names: string[]) =>
  names.map((name) => join(dir, name)).find((path) => existsSync(path));

async function fromFile(path: string): Promise<RawConfig | undefined> {
  if (SVELTE_CONFIG.test(basename(path))) return fromSvelteConfig(path);
  const result = await fromVite(dirname(path), path);
  return result === "error" ? undefined : (result ?? fromSvelteConfig(path));
}

async function fromDir(dir: string): Promise<RawConfig | undefined> {
  for (let at = dir; ; at = dirname(at)) {
    const vite = firstIn(at, VITE_CONFIGS);
    // eslint-disable-next-line eslint/no-await-in-loop -- the nearest folder with a config wins
    const result = vite ? await fromVite(at, vite) : undefined;
    if (result && result !== "error") return result;
    const svelte = firstIn(at, SVELTE_CONFIGS);
    if (svelte) return fromSvelteConfig(svelte);
    // A vite.config that fails, with no svelte.config beside it, ends the search.
    if (result === "error" || dirname(at) === at) return;
  }
}

async function fromSvelteConfig(path: string): Promise<RawConfig | undefined> {
  try {
    return ((await import(pathToFileURL(path).href)) as { default?: RawConfig })
      .default;
  } catch {
    return;
  }
}

interface VitePlugin {
  name: string;
  api?: { options?: RawConfig };
}
interface Vite {
  resolveConfig(
    config: { root: string; configFile: string; logLevel: "error" },
    command: "serve",
  ): Promise<{ plugins: readonly VitePlugin[] }>;
}

let resolving: Promise<unknown> = Promise.resolve();

/**
 * The options a vite.config gives SvelteKit's plugin or vite-plugin-svelte,
 * by the project's own Vite; `undefined` with neither (or no Vite), or
 * `"error"` when the config fails.
 */
async function fromVite(
  root: string,
  configFile: string,
): Promise<RawConfig | "error" | undefined> {
  const vite = await importVite(root);
  if (!vite) return;
  // One at a time: SvelteKit before 3 reads svelte.config.js from the cwd.
  const previous = resolving;
  let done = () => {};
  resolving = new Promise<void>((resolve) => {
    done = resolve;
  });
  await previous;
  const cwd = process.cwd();
  try {
    process.chdir(root);
  } catch {
    // A worker can't change its cwd.
  }
  try {
    const { plugins } = await vite.resolveConfig(
      { root, configFile, logLevel: "error" },
      "serve",
    );
    const options = (name: string) =>
      plugins.find((p) => p.name === name)?.api?.options;
    return (
      options("vite-plugin-sveltekit-setup") ??
      options("vite-plugin-svelte:config")
    );
  } catch {
    return "error";
  } finally {
    try {
      process.chdir(cwd);
    } catch {
      // As above.
    }
    done();
  }
}

/** The project's Vite, by its package's ESM entry; never a dependency of ours. */
async function importVite(root: string): Promise<Vite | undefined> {
  try {
    const pkgPath = createRequire(join(root, "package.json")).resolve(
      "vite/package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      exports?: Record<string, unknown>;
      module?: string;
      main?: string;
    };
    const entry = importEntry(pkg.exports?.["."]) ?? pkg.module ?? pkg.main;
    if (!entry) return;
    return (await import(
      pathToFileURL(join(dirname(pkgPath), entry)).href
    )) as Vite;
  } catch {
    return;
  }
}

function importEntry(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return;
  const { import: imported, default: fallback } = entry as Record<
    string,
    unknown
  >;
  if (typeof imported === "string") return imported;
  if (imported && typeof imported === "object") {
    const nested = (imported as Record<string, unknown>).default;
    if (typeof nested === "string") return nested;
  }
  return typeof fallback === "string" ? fallback : undefined;
}
