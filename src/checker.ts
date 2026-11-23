import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Checker } from "./types.ts";
import { field, stringOf } from "./unknown.ts";

/**
 * In the order picked when none is named: the project's own TypeScript
 * first.
 */
export const CHECKERS: Checker[] = ["tsc", "tsgo", "tsrs", "bun"];

/**
 * A package that provides a checker, its bin, and the least major version
 * that counts.
 */
type Provider = [name: string, bin: string, major?: number];

/**
 * The packages that provide each checker, in the order they're looked for.
 * tsgo is TypeScript 7, under the alias svelte-check's `--tsgo` looks for
 * first (`@typescript/native@npm:typescript@7`, beside a `typescript@6`),
 * then the preview build, then the project's own `typescript` if it's 7.
 */
const PACKAGES: Record<Exclude<Checker, "bun">, Provider[]> = {
  tsc: [["typescript", "tsc"]],
  tsgo: [
    ["@typescript/native", "tsc", 7],
    ["@typescript/native-preview", "tsgo"],
    ["typescript", "tsc", 7],
  ],
  tsrs: [["tsrs", "tsrs"]],
};
const NODE_SHEBANG = /^#!.*\bnode\b/;

/**
 * How to run a checker: the command, and arguments before the checker's
 * own.
 */
interface CheckerCommand {
  command: string;
  prefix: string[];
  /** The providing package's version, when it's known. */
  version?: string | undefined;
  /** Run through the shell: a Windows `.cmd` or `.bat` shim needs it. */
  shell?: boolean | undefined;
}

const WINDOWS_SHIM = /\.(cmd|bat)$/i;
/** A path whose file is `bun` or `bun.exe`, with either separator. */
const BUN_BINARY = /(^|[\\/])bun(\.exe)?$/i;

/**
 * The Bun binary, when the run is on Bun under that name. A package bin
 * run with `--bun` (or `[run] bun = true`) runs on Bun under the name
 * `node`, so its `#!/usr/bin/env node` shebang finds it, and Bun under
 * that name runs as Node: `node check` looks for a script named `check`.
 * On Windows, its path is a `bun-node-*\\node.exe` copy, not `bun.exe`.
 */
export function runtimeBun(
  execPath: string,
  version: string | undefined,
): string | undefined {
  return version && BUN_BINARY.test(execPath) ? execPath : undefined;
}

/**
 * A command on `PATH`. On Windows, a command is `name` plus one of
 * `PATHEXT`'s extensions (`tsc.cmd`, `bun.exe`), as the shell finds it.
 */
export function onPath(
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const extensions =
    platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
          .flatMap((ext) => [ext.toLowerCase(), ext])
      : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return;
}

/** `node_modules/<name>`, from `cwd` up, as Node resolves a package. */
function packageDir(name: string, cwd: string): string | undefined {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return;
  }
}

/**
 * Finds a checker: the project's installed package (hoisted or not), then
 * `PATH`. A Node launcher runs on the current runtime, so it works where
 * shebangs don't (Windows).
 */
export function checkerCommand(
  checker: Checker,
  cwd: string,
): CheckerCommand | undefined {
  if (checker === "bun") {
    const bun =
      runtimeBun(process.execPath, process.versions.bun) ?? onPath("bun");
    return bun
      ? { command: bun, prefix: [], version: process.versions.bun }
      : undefined;
  }
  for (const [name, bin, major] of PACKAGES[checker]) {
    const dir = packageDir(name, cwd);
    if (!dir) continue;
    const pkg: unknown = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf-8"),
    );
    const version = stringOf(pkg, "version");
    if (major !== undefined && !(Number.parseInt(version ?? "") >= major))
      continue;
    const bins = field(pkg, "bin");
    const relative = typeof bins === "string" ? bins : stringOf(bins, bin);
    if (!relative) continue;
    const path = join(dir, relative);
    const head = readFileSync(path, "utf-8").slice(0, 100);
    return NODE_SHEBANG.test(head)
      ? { command: process.execPath, prefix: [path], version }
      : { command: path, prefix: [], version };
  }
  const found = onPath(checker);
  if (!found) return;
  return WINDOWS_SHIM.test(found)
    ? { command: found, prefix: [], shell: true }
    : { command: found, prefix: [] };
}

/**
 * The native binary a checker's Node launcher would start, found with the
 * package's own lookup (`lib/getExePath.js`, which tsgo, TypeScript 7's
 * `tsc` and tsrs ship, with their platform packages and overrides), so a
 * run doesn't start a runtime only for it to start the binary: 15 to 35
 * ms, and under Bun, whose launcher waits on the binary, a process kept
 * for the whole check. The launcher, when there's no such lookup or it
 * fails.
 */
export async function nativeCommand(
  command: CheckerCommand,
): Promise<CheckerCommand> {
  const [launcher, ...rest] = command.prefix;
  if (!launcher || rest.length > 0) return command;
  const lookup = join(dirname(launcher), "..", "lib", "getExePath.js");
  if (!existsSync(lookup)) return command;
  try {
    const mod: unknown = await import(pathToFileURL(lookup).href);
    const getExePath = field(mod, "default");
    if (typeof getExePath !== "function") return command;
    const exe: unknown = Reflect.apply(getExePath, undefined, []);
    return typeof exe === "string"
      ? { ...command, command: exe, prefix: [] }
      : command;
  } catch {
    return command;
  }
}

/**
 * The arguments that check a project and print errors as `tsc` does.
 * `bun check` runs a package.json `check` script in its place, unless
 * `--no-script`.
 */
export function checkerArgs(checker: Checker, tsconfig: string): string[] {
  return checker === "bun"
    ? ["check", "--no-script", "-p", tsconfig, "--no-pretty", "--all"]
    : ["-p", tsconfig, "--pretty", "false"];
}

/**
 * The environment variables that change what the checker reports, as
 * sorted pairs: tsrs reads `TSRS_FAST` and other `TSRS_` settings. tsc
 * and tsgo read only watch-mode ones.
 */
export function checkerEnv(
  checker: Checker,
  env: Record<string, string | undefined> = process.env,
): [string, string][] {
  if (checker !== "tsrs") return [];
  return Object.entries(env)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].startsWith("TSRS_") && entry[1] !== undefined,
    )
    .sort(([a], [b]) => Number(a > b) - Number(a < b));
}

/**
 * Flags a user can't pass the checker, and why: each changes how it runs,
 * what it prints, or what it writes. `tsc`'s names are case-insensitive,
 * so they're kept lowercase.
 */
const BLOCKED: [reason: string, flags: string[]][] = [
  [
    "svelte-typecheck sets it",
    [
      "-p",
      "--project",
      "--pretty",
      "--noemit",
      "--incremental",
      "--tsbuildinfofile",
      "--ignoredeprecations",
      "--ignoreconfig",
    ],
  ],
  [
    "it changes how the checker runs",
    [
      "-b",
      "--build",
      "-w",
      "--watch",
      "--init",
      "--showconfig",
      "--listfilesonly",
      "-v",
      "--version",
      "-h",
      "-?",
      "--help",
      "--all",
    ],
  ],
  [
    "it changes the output svelte-typecheck reads",
    [
      "--quiet",
      "--listfiles",
      "--explainfiles",
      "--diagnostics",
      "--extendeddiagnostics",
    ],
  ],
  ["it writes files", ["--outdir", "--declaration"]],
];
const BLOCKED_BUN: [reason: string, flags: string[]][] = [
  ["svelte-typecheck sets it", ["--no-pretty", "--no-script", "--cwd"]],
  [
    "it changes what bun check checks",
    ["--no-follow-imports", "--aot", "--timing"],
  ],
];

/**
 * The arguments a user passes the checker, as they are, or an error
 * naming the first that would break the run.
 */
export function forwardedArgs(checker: Checker, args: string[]): string[] {
  const blocked = checker === "bun" ? [...BLOCKED, ...BLOCKED_BUN] : BLOCKED;
  for (const arg of args) {
    const name = arg.split("=")[0]?.toLowerCase() ?? "";
    const hit = blocked.find(([, flags]) => flags.includes(name));
    if (hit) throw new Error(`Can't pass ${arg} to ${checker}: ${hit[0]}`);
  }
  return args;
}
