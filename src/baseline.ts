import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import type {
  Baseline,
  BaselineEntry,
  BaselineResult,
  Diagnostic,
} from "./types.ts";

const LINE_BREAK = /\r?\n/;

function keyer(workspace: string) {
  const lines = new Map<string, string[]>();
  const lineOf = (d: Diagnostic) => {
    let text = lines.get(d.file);
    if (!text) {
      try {
        text = readFileSync(d.file, "utf-8").split(LINE_BREAK);
      } catch {
        text = [];
      }
      lines.set(d.file, text);
    }
    return (text[d.line - 1] ?? "").trim();
  };
  // A message can name a file: as the workspace's, so the baseline is the
  // same on any machine.
  const prefix = `${workspace}${sep}`;
  return (d: Diagnostic): Omit<BaselineEntry, "count"> => ({
    file: relative(workspace, d.file).split(sep).join("/"),
    code: d.code,
    message: d.message.replaceAll(prefix, ""),
    line: lineOf(d),
  });
}

const keyOf = (e: Omit<BaselineEntry, "count">) =>
  JSON.stringify([e.file, e.code, e.message, e.line]);

/** A baseline of a run's diagnostics, sorted so it diffs well. */
export function createBaseline(
  diagnostics: Diagnostic[],
  workspace: string,
): Baseline {
  const toEntry = keyer(workspace);
  const entries = new Map<string, BaselineEntry>();
  for (const d of diagnostics) {
    const entry = toEntry(d);
    const key = keyOf(entry);
    const found = entries.get(key);
    if (found) found.count++;
    else entries.set(key, { ...entry, count: 1 });
  }
  return {
    version: 1,
    diagnostics: [...entries.entries()]
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([, entry]) => entry),
  };
}

/** A run's diagnostics less the baseline's: what's new since it. */
export function applyBaseline(
  diagnostics: Diagnostic[],
  baseline: Baseline,
  workspace: string,
): BaselineResult {
  const toEntry = keyer(workspace);
  const left = new Map(
    baseline.diagnostics.map((e) => [keyOf(e), e.count] as const),
  );
  const fresh: Diagnostic[] = [];
  let known = 0;
  for (const d of diagnostics) {
    const key = keyOf(toEntry(d));
    const count = left.get(key) ?? 0;
    if (count > 0) {
      left.set(key, count - 1);
      known++;
    } else fresh.push(d);
  }
  let fixed = 0;
  for (const count of left.values()) fixed += count;
  return { diagnostics: fresh, known, fixed };
}
