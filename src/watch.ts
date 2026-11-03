import { type FSWatcher, watch as watchFiles } from "node:fs";
import { resolve, sep } from "node:path";
import { typecheck } from "./check.ts";
import type { TypecheckOptions, TypecheckResult } from "./types.ts";

const WATCHED = /\.(?:svelte|[cm]?[jt]sx?|json)$/;
const DEBOUNCE_MS = 100;

/**
 * Checks, then checks again whenever a component, TS or JS file, or a
 * config under the workspace changes, as svelte-check `--watch` does. Runs
 * are incremental. Returns a function that stops watching.
 */
export function watch(
  options: TypecheckOptions,
  onResult: (result: TypecheckResult | Error) => void,
): () => void {
  const cwd = resolve(options.cwd ?? process.cwd());
  const workspace = resolve(cwd, options.workspace ?? ".");
  const run = { ...options, cwd, incremental: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;

  const check = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      onResult(await typecheck(run));
    } catch (error) {
      onResult(error as Error);
    }
    running = false;
    if (again) {
      again = false;
      await check();
    }
  };

  const ignored = (path: string) =>
    path
      .split(sep)
      .some((part) => part === "node_modules" || part.startsWith("."));
  const watcher: FSWatcher = watchFiles(
    workspace,
    { recursive: true },
    (_, filename) => {
      if (!filename || ignored(filename) || !WATCHED.test(filename)) return;
      clearTimeout(timer);
      timer = setTimeout(check, DEBOUNCE_MS);
    },
  );
  void check();
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
