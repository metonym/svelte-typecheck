import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import type { Diagnostic } from "./types.ts";

/** svelte-check's output formats, and `agent` for a coding agent. */
export type OutputFormat =
  "human" | "human-verbose" | "machine" | "machine-verbose" | "agent";

export const OUTPUT_FORMATS: OutputFormat[] = [
  "human",
  "human-verbose",
  "machine",
  "machine-verbose",
  "agent",
];

interface Colors {
  red(text: string): string;
  yellow(text: string): string;
  green(text: string): string;
  cyan(text: string): string;
  magenta(text: string): string;
}

/** ANSI colors, as picocolors decides them: a flag, then `NO_COLOR`/`FORCE_COLOR`, then a TTY. */
export function colors(force: boolean | undefined): Colors {
  const env = process.env;
  const enabled =
    force ??
    (env.FORCE_COLOR !== undefined
      ? env.FORCE_COLOR !== "0"
      : env.NO_COLOR === undefined &&
        Boolean(process.stdout.isTTY) &&
        env.TERM !== "dumb");
  const paint = (open: number, close: number) => (text: string) =>
    enabled ? `\u001B[${open}m${text}\u001B[${close}m` : text;
  return {
    red: paint(31, 39),
    yellow: paint(33, 39),
    green: paint(32, 39),
    cyan: paint(36, 39),
    magenta: paint(35, 39),
  };
}

/** Lines `from` to `to` (1-based) of a file, or `""` when it can't be read. */
function lineOf(text: string, line: number): string {
  return text.split("\n")[line - 1] ?? "";
}

/** The line before, the line with the range highlighted, and the line after. */
function codeFrame(d: Diagnostic, c: Colors): string {
  let text: string;
  try {
    text = readFileSync(d.file, "utf-8");
  } catch {
    return "";
  }
  const endLine = d.endLine ?? d.line;
  const endColumn = d.endColumn ?? d.column;
  const first = lineOf(text, d.line);
  const last = lineOf(text, endLine);
  const middle =
    d.line === endLine
      ? first.slice(0, d.column - 1) +
        c.magenta(first.slice(d.column - 1, endColumn - 1)) +
        first.slice(endColumn - 1)
      : first.slice(0, d.column - 1) +
        c.magenta(
          [
            first.slice(d.column - 1),
            ...text.split("\n").slice(d.line, endLine - 1),
            last.slice(0, endColumn - 1),
          ].join("\n"),
        ) +
        last.slice(endColumn - 1);
  const before = d.line > 1 ? `${lineOf(text, d.line - 1)}\n` : "";
  const after = lineOf(text, endLine + 1);
  return `${before}${middle}\n${after}`;
}

/**
 * `bun check`'s frame for a coding agent: the line before, the line with
 * carets under the range, and the line after, each with its number.
 */
function agentFrame(d: Diagnostic): string[] {
  let lines: string[];
  try {
    lines = readFileSync(d.file, "utf-8").split("\n");
  } catch {
    return [];
  }
  const width = String(d.line + 1).length;
  const row = (n: number) => {
    const text = lines[n - 1];
    return text === undefined ? [] : [`${String(n).padStart(width)} | ${text}`];
  };
  const end =
    (d.endLine ?? d.line) === d.line
      ? (d.endColumn ?? d.column)
      : (lines[d.line - 1]?.length ?? 0) + 1;
  const carets = "^".repeat(Math.max(1, end - d.column));
  return [
    ...row(d.line - 1),
    ...row(d.line),
    `${" ".repeat(width + 3 + d.column - 1)}${carets}`,
    ...row(d.line + 1),
  ];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The numeric code svelte-check reports for a TypeScript error, else the compiler's. */
function codeOf(d: Diagnostic): string | number {
  if (d.code.startsWith("TS")) return Number(d.code.slice(2));
  return NUMERIC.test(d.code) ? Number(d.code) : d.code;
}
const NUMERIC = /^-?\d+$/;

/** svelte-check names a diagnostic's source except for a TS or JS file's type error. */
function sourceOf(d: Diagnostic): string | undefined {
  return d.file.endsWith(".svelte") || d.source === "svelte"
    ? d.source
    : undefined;
}

const COMPILER_CODE = /^[a-z][\w-]*[-_][\w-]*$/;
const DASH = /-/g;

/** svelte-check's link to a compiler warning's or error's docs. */
function codeDescriptionOf(d: Diagnostic): { href: string } | undefined {
  if (d.source !== "svelte" || !COMPILER_CODE.test(d.code)) return;
  const page =
    d.severity === "warning" ? "compiler-warnings" : "compiler-errors";
  return {
    href: `https://svelte.dev/docs/svelte/${page}#${d.code.replace(DASH, "_")}`,
  };
}

export interface Summary {
  /** Files checked. */
  files: number;
  errors: number;
  warnings: number;
  filesWithProblems: number;
}

export function summarize(diagnostics: Diagnostic[], files: number): Summary {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  return {
    files,
    errors,
    warnings: diagnostics.length - errors,
    filesWithProblems: new Set(diagnostics.map((d) => d.file)).size,
  };
}

const DRIVE = /^[A-Z]:/;

/** A workspace as svelte-check prints it: a file URI's path, whose drive letter is lowercase on Windows. */
function displayed(workspace: string): string {
  return process.platform === "win32"
    ? workspace.replace(DRIVE, (drive) => drive.toLowerCase())
    : workspace;
}

/** Writes a run as svelte-check would, to `write`. */
export function writer(
  format: OutputFormat,
  write: (text: string) => void,
  c: Colors,
) {
  const machine = format.startsWith("machine");
  const verbose = format.endsWith("verbose");
  const log = (message: string) => write(`${Date.now()} ${message}\n`);
  if (format === "agent") return agentWriter(write);
  return {
    start(workspace: string, clearScreen = false) {
      if (!machine && clearScreen && process.stdout.isTTY)
        write("\u001B[2J\u001B[3J\u001B[H");
      if (machine) log(`START ${JSON.stringify(displayed(workspace))}`);
      else if (verbose)
        write(
          `Loading svelte-typecheck in workspace: ${displayed(workspace)}\nGetting Svelte diagnostics...\n\n`,
        );
    },
    diagnostic(d: Diagnostic, workspace: string) {
      const filename = relative(workspace, d.file);
      const type = d.severity === "error" ? "ERROR" : "WARNING";
      if (machine) {
        if (verbose)
          log(
            JSON.stringify({
              type,
              filename,
              start: { line: d.line - 1, character: d.column - 1 },
              end: {
                line: (d.endLine ?? d.line) - 1,
                character: (d.endColumn ?? d.column) - 1,
              },
              message: d.message,
              code: codeOf(d),
              codeDescription: codeDescriptionOf(d),
              source: sourceOf(d),
            }),
          );
        else
          log(
            `${type} ${JSON.stringify(filename)} ${d.line}:${d.column} ${JSON.stringify(d.message)}`,
          );
        return;
      }
      write(
        `${displayed(workspace)}${sep}${c.green(filename)}:${d.line}:${d.column}\n`,
      );
      const source = sourceOf(d) ? `(${d.source})` : "";
      const message = verbose
        ? `${d.message} ${source}\n${c.cyan(codeFrame(d, c).trimEnd())}`
        : `${d.message} ${source}`;
      write(
        `${d.severity === "error" ? c.red("Error") : c.yellow("Warn")}: ${message}\n\n`,
      );
    },
    /** A line svelte-check doesn't print, so only in the human formats. */
    note(text: string) {
      if (!machine) write(`${text}\n`);
    },
    completion(summary: Summary, watching = false) {
      const { files, errors, warnings, filesWithProblems } = summary;
      if (machine) {
        log(
          `COMPLETED ${files} FILES ${errors} ERRORS ${warnings} WARNINGS ${filesWithProblems} FILES_WITH_PROBLEMS`,
        );
        return;
      }
      if (filesWithProblems) write("====================================\n");
      const message = `svelte-typecheck found ${errors} ${errors === 1 ? "error" : "errors"} and ${warnings} ${warnings === 1 ? "warning" : "warnings"}${filesWithProblems ? ` in ${filesWithProblems} ${filesWithProblems === 1 ? "file" : "files"}` : ""}\n`;
      if (errors) write(c.red(message));
      else if (warnings) write(c.yellow(message));
      else write(c.green(message));
      if (watching) write("Watching for file changes...");
    },
    failure(error: Error) {
      if (machine) log(`FAILURE ${JSON.stringify(error.message)}`);
      else write(`${error.message}\n`);
    },
  };
}

/**
 * Writes a run as `bun check` does for a coding agent: each problem as a
 * tag with its source lines, then one summary line.
 */
function agentWriter(write: (text: string) => void) {
  return {
    start(_workspace: string, _clearScreen = false) {},
    diagnostic(d: Diagnostic, workspace: string) {
      const tag = d.severity === "error" ? "error" : "warning";
      const file = relative(workspace, d.file);
      const frame = agentFrame(d);
      write(
        [
          `<${tag} file="${file}" line="${d.line}" column="${d.column}" code="${d.code}">`,
          d.message,
          ...(frame.length > 0 ? ["<source>", ...frame, "</source>"] : []),
          `</${tag}>`,
          "",
        ].join("\n"),
      );
    },
    note(text: string) {
      write(`${text}\n`);
    },
    completion(summary: Summary, watching = false) {
      const { files, errors, warnings, filesWithProblems } = summary;
      const checked = plural(files, "component");
      if (errors + warnings === 0) write(`✓ No type errors in ${checked}\n`);
      else {
        const found = warnings
          ? `${plural(errors, "error")} and ${plural(warnings, "warning")}`
          : plural(errors, "error");
        write(
          `Found ${found} in ${plural(filesWithProblems, "file")}, checked ${checked}\n`,
        );
      }
      if (watching) write("Watching for file changes...\n");
    },
    failure(error: Error) {
      write(`${error.message}\n`);
    },
  };
}
