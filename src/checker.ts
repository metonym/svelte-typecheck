import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { Checker } from "./types.ts";

/** In the order picked when none is named: the project's own TypeScript first. */
export const CHECKERS: Checker[] = ["tsc", "tsgo", "tsrs", "bun"];

/** The package and bin that provide each checker. */
const PACKAGES: Record<Exclude<Checker, "bun">, [string, string]> = {
  tsc: ["typescript", "tsc"],
  tsgo: ["@typescript/native-preview", "tsgo"],
  tsrs: ["tsrs", "tsrs"],
};
const NODE_SHEBANG = /^#!.*\bnode\b/;

/** How to run a checker: the command, and arguments before the checker's own. */
export interface CheckerCommand {
  command: string;
  prefix: string[];
  /** The providing package's version, when it's known. */
  version?: string;
}

function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
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
    const bun = process.versions.bun ? process.execPath : onPath("bun");
    return bun
      ? { command: bun, prefix: [], version: process.versions.bun }
      : undefined;
  }
  const [name, bin] = PACKAGES[checker];
  const dir = packageDir(name, cwd);
  if (dir) {
    const pkg = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf-8"),
    ) as {
      version?: string;
      bin?: string | Record<string, string>;
    };
    const relative = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[bin];
    if (relative) {
      const path = join(dir, relative);
      const head = readFileSync(path, "utf-8").slice(0, 100);
      return NODE_SHEBANG.test(head)
        ? { command: process.execPath, prefix: [path], version: pkg.version }
        : { command: path, prefix: [], version: pkg.version };
    }
  }
  const found = onPath(bin);
  return found ? { command: found, prefix: [] } : undefined;
}

/** The arguments that check a project and print errors as `tsc` does. */
export function checkerArgs(checker: Checker, tsconfig: string): string[] {
  return checker === "bun"
    ? ["check", "-p", tsconfig, "--no-pretty", "--all"]
    : ["-p", tsconfig, "--pretty", "false"];
}
