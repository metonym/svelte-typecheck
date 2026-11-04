import { spawnSync } from "node:child_process";
import { join } from "node:path";

const LINE_BREAK = /\r?\n/;

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0)
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`,
    );
  return result.stdout;
}

/**
 * The files git sees changed, as absolute paths: against `HEAD`, or with
 * `since`, against where the branch left it (`git merge-base`), so a
 * branch's commits count too; untracked files included.
 */
export function changedFiles(cwd: string, since?: string): string[] {
  const top = git(["rev-parse", "--show-toplevel"], cwd).trim();
  const base = since ? git(["merge-base", since, "HEAD"], cwd).trim() : "HEAD";
  const lines = [
    ...git(["diff", "--name-only", base], cwd).split(LINE_BREAK),
    ...git(["ls-files", "--others", "--exclude-standard"], top).split(
      LINE_BREAK,
    ),
  ];
  return [...new Set(lines.filter(Boolean).map((line) => join(top, line)))];
}
