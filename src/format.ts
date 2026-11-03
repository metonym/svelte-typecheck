import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import type { Diagnostic } from "./types.ts";

/** svelte-check's output formats. */
export type OutputFormat =
  "human" | "human-verbose" | "machine" | "machine-verbose";

export const OUTPUT_FORMATS: OutputFormat[] = [
  "human",
  "human-verbose",
  "machine",
  "machine-verbose",
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

/** The numeric code svelte-check reports for a TypeScript error, else the compiler's. */
function codeOf(d: Diagnostic): string | number {
  return d.code.startsWith("TS") ? Number(d.code.slice(2)) : d.code;
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

/** Writes a run as svelte-check would, to `write`. */
export function writer(
  format: OutputFormat,
  write: (text: string) => void,
  c: Colors,
) {
  const machine = format.startsWith("machine");
  const verbose = format.endsWith("verbose");
  const log = (message: string) => write(`${Date.now()} ${message}\n`);
  return {
    start(workspace: string) {
      if (machine) log(`START ${JSON.stringify(workspace)}`);
      else if (verbose)
        write(
          `Loading svelte-typecheck in workspace: ${workspace}\nGetting Svelte diagnostics...\n\n`,
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
              source: d.file.endsWith(".svelte") ? d.source : undefined,
            }),
          );
        else
          log(
            `${type} ${JSON.stringify(filename)} ${d.line}:${d.column} ${JSON.stringify(d.message)}`,
          );
        return;
      }
      write(`${workspace}${sep}${c.green(filename)}:${d.line}:${d.column}\n`);
      // svelte-check names the source in components only.
      const source = d.file.endsWith(".svelte") ? `(${d.source})` : "";
      const message = verbose
        ? `${d.message} ${source}\n${c.cyan(codeFrame(d, c).trimEnd())}`
        : `${d.message} ${source}`;
      write(
        `${d.severity === "error" ? c.red("Error") : c.yellow("Warn")}: ${message}\n\n`,
      );
    },
    completion(summary: Summary) {
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
    },
    failure(error: Error) {
      if (machine) log(`FAILURE ${JSON.stringify(error.message)}`);
      else write(`${error.message}\n`);
    },
  };
}
