import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { glob, matcher } from "./glob.ts";

const LINE_COMMENT = /\/\/[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const TRAILING_COMMA = /,(\s*[}\]])/g;
const STRING = /"(?:[^"\\]|\\.)*"/g;
const PLACEHOLDER = /"\0(\d+)"/g;
const WILDCARD = /[*?{]/;
/** A dot in the last segment, whichever separator: `D:\\a\\.tmp\\b` has none. */
const HAS_EXTENSION = /\.[^/\\]+$/;
const NODE_MODULES_JS = /\/node_modules\/.+\.[cm]?js$/;
const DEFAULT_EXCLUDE = ["node_modules", "bower_components", "jspm_packages"];
/** A spec TypeScript resolves from the tsconfig it's read from, not rebased. */
const CONFIG_DIR = "${configDir}";

/** A tsconfig's JSON, comments and trailing commas allowed. */
function parseJsonc(text: string): unknown {
  const strings: string[] = [];
  const stripped = text
    .replace(STRING, (s) => `"\0${strings.push(s) - 1}"`)
    .replace(LINE_COMMENT, "")
    .replace(BLOCK_COMMENT, "")
    .replace(TRAILING_COMMA, "$1")
    .replaceAll(PLACEHOLDER, (_, i: string) => strings[Number(i)] ?? "");
  return JSON.parse(stripped);
}

interface RawConfig {
  extends?: string | string[];
  include?: string[];
  exclude?: string[];
  files?: string[];
  references?: unknown[];
  compilerOptions?: {
    rootDirs?: string[];
    baseUrl?: string;
    paths?: Record<string, string[]>;
    checkJs?: boolean;
    allowJs?: boolean;
    skipLibCheck?: boolean;
    moduleResolution?: string;
    outDir?: string;
    declarationDir?: string;
  };
}

/** `include`, `exclude`, `files`, `rootDirs` and `paths` as absolute paths, `extends` applied. */
interface Inputs {
  include?: string[];
  exclude?: string[];
  files?: string[];
  rootDirs?: string[];
  baseUrl?: string;
  /** Relative to `baseUrl`, or the folder of the tsconfig that sets them. */
  paths?: Record<string, string[]>;
  checkJs?: boolean;
  allowJs?: boolean;
  skipLibCheck?: boolean;
  moduleResolution?: string;
  /** `include` and `exclude` as written, relative to the tsconfig read first. */
  includeSpecs?: string[];
  excludeSpecs?: string[];
  outDir?: string;
  declarationDir?: string;
}

function readInputs(path: string, read: string[] = []): Inputs {
  read.push(path);
  const config = parseJsonc(readFileSync(path, "utf-8")) as RawConfig;
  const dir = dirname(path);
  const absolute = (list: string[] | undefined) =>
    list?.map((p) => resolve(dir, p));
  let inputs: Inputs = {};
  const bases =
    typeof config.extends === "string" ? [config.extends] : config.extends;
  for (const base of bases ?? []) {
    const basePath = base.startsWith(".")
      ? resolve(dir, base)
      : createRequire(path).resolve(base);
    const baseInputs = readInputs(basePath, read);
    // As TypeScript rewrites them: from the base's folder to this one's.
    const difference = toPosix(relative(dir, dirname(basePath)));
    const rebase = (specs: string[] | undefined) =>
      specs?.map((spec) =>
        difference && !isAbsolute(spec) && !spec.startsWith(CONFIG_DIR)
          ? `${difference}/${spec}`
          : spec,
      );
    inputs = {
      ...inputs,
      ...defined({
        ...baseInputs,
        includeSpecs: rebase(baseInputs.includeSpecs),
        excludeSpecs: rebase(baseInputs.excludeSpecs),
      }),
    };
  }
  const options = config.compilerOptions;
  const baseUrl = options?.baseUrl ? resolve(dir, options.baseUrl) : undefined;
  const pathsBase = baseUrl ?? inputs.baseUrl ?? dir;
  return {
    ...inputs,
    ...defined({
      include: absolute(config.include),
      exclude: absolute(config.exclude),
      files: absolute(config.files),
      rootDirs: absolute(options?.rootDirs),
      checkJs: options?.checkJs,
      allowJs: options?.allowJs,
      skipLibCheck: options?.skipLibCheck,
      moduleResolution: options?.moduleResolution,
      includeSpecs: config.include,
      excludeSpecs: config.exclude,
      outDir: options?.outDir && resolve(dir, options.outDir),
      declarationDir:
        options?.declarationDir && resolve(dir, options.declarationDir),
      baseUrl,
      paths:
        options?.paths &&
        Object.fromEntries(
          Object.entries(options.paths).map(([key, targets]) => [
            key,
            targets.map((t) => resolve(pathsBase, t)),
          ]),
        ),
    }),
  };
}

function defined(inputs: Inputs): Inputs {
  return Object.fromEntries(
    Object.entries(inputs).filter(([, value]) => value !== undefined),
  );
}

function findUp(from: string, name: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
    if (dirname(dir) === dir) return;
  }
}

/** The nearer of tsconfig.json and jsconfig.json, from `dir` up, as svelte-check picks. */
function findTsconfig(dir: string): string | undefined {
  const ts = findUp(dir, "tsconfig.json");
  const js = findUp(dir, "jsconfig.json");
  return ts && (!js || ts.length >= js.length) ? ts : js;
}

const toPosix = (path: string) => path.split(sep).join("/");
/** A path as svelte-check's TypeScript prints it: `/`-separated, a Windows drive lowercase. */
export const asTypeScriptPath = (path: string): string =>
  toPosix(path).replace(/^[A-Z]:/, (drive) => drive.toLowerCase());

/** Splits an absolute glob into the folder before its first wildcard and the rest. */
function splitGlob(pattern: string): [base: string, rest: string] {
  const parts = toPosix(pattern).split("/");
  const at = parts.findIndex((part) => WILDCARD.test(part));
  if (at === -1) return [pattern, ""];
  return [parts.slice(0, at).join("/") || "/", parts.slice(at).join("/")];
}

/** A tsconfig `include` entry as a glob for `.svelte` files, as svelte-check reads it. */
function svelteGlobOf(pattern: string): string | undefined {
  if (pattern.endsWith(".svelte")) return pattern;
  if (WILDCARD.test(pattern))
    return pattern.endsWith("*")
      ? `${pattern.slice(0, -1)}*.svelte`
      : undefined;
  // A folder, or a file that isn't a component.
  return HAS_EXTENSION.test(pattern) ? undefined : `${pattern}/**/*.svelte`;
}

/** A matcher for absolute paths, from absolute tsconfig-style patterns. */
function absoluteMatcher(patterns: string[]): (path: string) => boolean {
  const globs = patterns.flatMap((p) => {
    const posix = toPosix(p);
    return WILDCARD.test(posix) ? [posix] : [posix, `${posix}/**`];
  });
  const matches = matcher(globs.map((g) => g.replace(/^\//, "")));
  return (path) => matches(toPosix(path).replace(/^\//, ""));
}

/** What a run checks and reports, by svelte-check's rules. */
export interface Project {
  /** The tsconfig, or `undefined` for none. */
  tsconfig?: string;
  /** The components to check, as absolute paths. */
  components: string[];
  /** The tsconfig's `files`, `include` and `exclude`, as absolute paths and patterns. */
  files: string[];
  include: string[];
  exclude: string[];
  /** The tsconfig's `rootDirs`, as absolute paths. */
  rootDirs: string[];
  /** The tsconfig and those it extends. */
  configFiles: string[];
  /** The tsconfig's `paths`, with absolute targets. */
  paths: Record<string, string[]>;
  /** Whether a JS component's types are checked. */
  checkJs: boolean;
  /** Whether a JS component is in the program at all, or untyped. */
  allowJs: boolean;
  /** Whether a declaration file's errors go unreported. */
  skipLibCheck: boolean;
  /**
   * The package's `exports`, as `paths`: what an import of its own name
   * finds, once `paths` finds nothing.
   */
  selfExports: Record<string, string[]>;
  /** The tsconfig's own `include` and `exclude`, as written. */
  raw: { include?: string[]; exclude?: string[] };
  /**
   * What TypeScript's "No inputs were found" names, when it would report
   * one: not with a `files` list or project `references`.
   */
  inputSpecs?: { include: string[]; exclude: string[] };
  /** Whether a TS or JS file's errors are reported. */
  reports(path: string): boolean;
}

export interface ProjectOptions {
  workspace: string;
  /** A path relative to the workspace, `false` for none, or found from the workspace up. */
  tsconfig?: string | false;
  /** With no tsconfig: folders and files to skip, relative to the workspace. */
  ignore?: string[];
  /** Globs of components relative to the workspace, instead of the tsconfig's. */
  components?: string[];
}

/**
 * The files to check. With a tsconfig (given, or the nearest from the
 * workspace up), the components it includes, and its TS and JS files'
 * errors reported too. With none, every component under the workspace but
 * `ignore`, and only theirs.
 */
export function projectOf(options: ProjectOptions): Project {
  const { workspace } = options;
  const tsconfig = tsconfigOf(workspace, options.tsconfig);
  if (options.tsconfig && tsconfig && !existsSync(tsconfig))
    throw new Error(`Could not find tsconfig/jsconfig file at ${tsconfig}`);

  if (!tsconfig) {
    const isIgnored = ignoreMatcher(options.ignore ?? []);
    const components = glob(workspace, options.components ?? ["**/*.svelte"])
      .filter((rel) => !isIgnored(rel))
      .map((rel) => join(workspace, rel));
    return {
      components,
      files: [],
      include: [],
      exclude: [],
      rootDirs: [],
      configFiles: [],
      paths: {},
      // svelte-check's options with no tsconfig.
      checkJs: true,
      allowJs: true,
      skipLibCheck: true,
      selfExports: {},
      raw: {},
      reports: () => false,
    };
  }

  const configFiles: string[] = [];
  const inputs = readInputs(tsconfig, configFiles);
  const raw = parseJsonc(readFileSync(tsconfig, "utf-8")) as RawConfig;
  const include =
    inputs.include ?? (inputs.files ? [] : [join(dirname(tsconfig), "**/*")]);
  const exclude =
    inputs.exclude ?? DEFAULT_EXCLUDE.map((p) => join(dirname(tsconfig), p));
  const files = new Set(inputs.files ?? []);
  const isExcluded = absoluteMatcher(exclude);

  let components: string[];
  if (options.components)
    components = glob(workspace, options.components).map((rel) =>
      join(workspace, rel),
    );
  else {
    const found = new Set<string>(
      [...files].filter((f) => f.endsWith(".svelte")),
    );
    for (const pattern of include) {
      const svelteGlob = svelteGlobOf(pattern);
      if (!svelteGlob) continue;
      const [base, rest] = splitGlob(svelteGlob);
      if (!rest) {
        if (existsSync(base)) found.add(base);
        continue;
      }
      if (!existsSync(base)) continue;
      for (const rel of glob(base, [rest])) found.add(join(base, rel));
    }
    components = [...found].sort();
  }
  components = components.filter((path) => !isExcluded(path));

  return {
    tsconfig,
    components,
    files: inputs.files ?? [],
    include,
    exclude,
    rootDirs: inputs.rootDirs ?? [],
    configFiles,
    // A package's subpath imports (`#lib/*`) work as `paths` do, after them.
    paths: { ...importsOf(dirname(tsconfig)), ...inputs.paths },
    checkJs: inputs.checkJs ?? false,
    // A jsconfig.json allows JS by default.
    allowJs: inputs.allowJs ?? basename(tsconfig) === "jsconfig.json",
    skipLibCheck: inputs.skipLibCheck ?? false,
    // Resolution from before `exports` doesn't read them.
    selfExports: LEGACY_RESOLUTION.test(inputs.moduleResolution ?? "")
      ? {}
      : exportsOf(dirname(tsconfig)),
    raw,
    inputSpecs:
      inputs.files || raw.references
        ? undefined
        : {
            include: inputs.includeSpecs ?? ["**/*"],
            exclude:
              inputs.excludeSpecs ??
              // With none, TypeScript excludes its outputs.
              [inputs.outDir, inputs.declarationDir].flatMap((dir) =>
                dir ? [asTypeScriptPath(dir)] : [],
              ),
          },
    // As svelte-check: every file in the program, but JS in node_modules.
    reports: (path) => !NODE_MODULES_JS.test(toPosix(path)),
  };
}

/** The nearest package.json's `imports`, as `paths` with absolute targets. */
function importsOf(dir: string): Record<string, string[]> {
  const path = findUp(dir, "package.json");
  if (!path) return {};
  let imports: unknown;
  try {
    ({ imports } = JSON.parse(readFileSync(path, "utf-8")) as {
      imports?: unknown;
    });
  } catch {
    return {};
  }
  const paths: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(imports ?? {})) {
    const target = importTarget(value);
    if (key.startsWith("#") && target?.startsWith("./"))
      paths[key] = [resolve(dirname(path), target)];
  }
  return paths;
}

/** A package's `exports` under its own name, in `paths`' shape. */
function exportsOf(dir: string): Record<string, string[]> {
  const path = findUp(dir, "package.json");
  if (!path) return {};
  let name: unknown;
  let exports: unknown;
  try {
    ({ name, exports } = JSON.parse(readFileSync(path, "utf-8")) as {
      name?: unknown;
      exports?: unknown;
    });
  } catch {
    return {};
  }
  if (typeof name !== "string" || exports == null) return {};
  // Subpaths start with `.`; anything else is one entry's conditions.
  const subpaths =
    typeof exports === "object" &&
    !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith("."))
      ? (exports as Record<string, unknown>)
      : { ".": exports };
  const paths: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(subpaths)) {
    if (!key.startsWith(".")) continue;
    const targets = exportTargets(value)
      .filter((target) => target.startsWith("./"))
      .map((target) => resolve(dirname(path), target));
    if (targets.length > 0)
      paths[key === "." ? name : `${name}/${key.slice(2)}`] = targets;
  }
  return paths;
}

/** An `exports` entry's targets, in the order TypeScript tries them. */
function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([condition, target]) =>
    EXPORT_CONDITIONS.has(condition) ? exportTargets(target) : [],
  );
}
const EXPORT_CONDITIONS = new Set(["types", "import", "default"]);
const LEGACY_RESOLUTION = /^(node|node10|classic)$/i;

/** An `imports` entry's target, preferring its `types` condition. */
function importTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return importTarget(value[0]);
  if (!value || typeof value !== "object") return;
  const conditions = value as Record<string, unknown>;
  for (const condition of ["types", "import", "default"])
    if (condition in conditions) return importTarget(conditions[condition]);
  return importTarget(Object.values(conditions)[0]);
}

const PROGRAM_FILE = /\.(svelte|[cm]?[jt]sx?)$/;
const JS_FILE = /\.[cm]?jsx?$/;

/**
 * Paths as TypeScript lists a folder: a folder's files before its
 * subfolders, each by name.
 */
export function byFolder(a: string, b: string): number {
  const pa = a.split(sep);
  const pb = b.split(sep);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    const aFile = i === pa.length - 1;
    const bFile = i === pb.length - 1;
    if (aFile !== bFile) return aFile ? -1 : 1;
    return (pa[i] ?? "") < (pb[i] ?? "") ? -1 : 1;
  }
  return pa.length - pb.length;
}

/**
 * A project's files in TypeScript's order of its root files: `files`,
 * then each `include` pattern's matches in turn, as svelte-check, which
 * adds `.svelte` to the extensions, has them.
 */
export function programFiles(project: Project): string[] {
  const isExcluded = absoluteMatcher(project.exclude);
  const found = new Set<string>(project.files);
  for (const pattern of project.include) {
    const fileGlob =
      WILDCARD.test(pattern) || HAS_EXTENSION.test(pattern)
        ? pattern
        : `${pattern}/**/*`;
    const [base, rest] = splitGlob(fileGlob);
    if (!rest) {
      if (
        existsSync(base) &&
        PROGRAM_FILE.test(base) &&
        (project.allowJs || !JS_FILE.test(base))
      )
        found.add(base);
      continue;
    }
    if (!existsSync(base)) continue;
    const matched = glob(base, [rest])
      .map((rel) => join(base, rel))
      .filter(
        (path) =>
          PROGRAM_FILE.test(path) &&
          (project.allowJs || !JS_FILE.test(path)) &&
          !isExcluded(path),
      )
      .sort(byFolder);
    for (const path of matched) found.add(path);
  }
  return [...found];
}

/** The TS and JS files a project's `include` names that pass `test`. */
export function scriptsOf(
  project: Project,
  test: (path: string) => boolean,
): string[] {
  const isExcluded = absoluteMatcher(project.exclude);
  const found = new Set<string>();
  for (const pattern of project.include) {
    const scriptGlob =
      WILDCARD.test(pattern) || HAS_EXTENSION.test(pattern)
        ? pattern
        : `${pattern}/**/*`;
    const [base, rest] = splitGlob(scriptGlob);
    if (!rest) {
      if (existsSync(base) && test(base)) found.add(base);
      continue;
    }
    if (!existsSync(base)) continue;
    for (const rel of glob(base, [rest])) {
      const path = join(base, rel);
      if (test(path) && !isExcluded(path)) found.add(path);
    }
  }
  return [...found].sort();
}

/** A path relative to `from`, `./`-prefixed when it doesn't climb, for tsconfig fields. */
export function relativeTo(from: string, path: string): string {
  const rel = toPosix(relative(from, path));
  return rel.startsWith(".") || isAbsolute(rel) ? rel : `./${rel}`;
}

/**
 * svelte-check's `--ignore`: a path prefix relative to the workspace, or
 * `**` at the start (anywhere in the path) or end (a prefix); no other `*`.
 */
function ignoreMatcher(patterns: string[]): (path: string) => boolean {
  const tests = patterns.map((raw) => {
    let pattern = raw.trim();
    if (pattern.endsWith("**")) pattern = pattern.slice(0, -2);
    if (pattern.startsWith("**")) {
      const rest = pattern.slice(2);
      if (rest.includes("*")) throw new Error(INVALID_IGNORE);
      return (path: string) => path.includes(rest);
    }
    if (pattern.includes("*")) throw new Error(INVALID_IGNORE);
    return (path: string) => path.startsWith(pattern);
  });
  return (path) => tests.some((test) => test(path));
}

const INVALID_IGNORE =
  "Invalid --ignore pattern: only ** at the start or end is supported";

function tsconfigOf(
  workspace: string,
  option: string | false | undefined,
): string | undefined {
  if (option === false) return;
  if (option) return resolve(workspace, option);
  return findTsconfig(workspace);
}
