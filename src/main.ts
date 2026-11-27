import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { applyBaseline, createBaseline } from "./baseline.ts";
import { EmitError, typecheck } from "./check.ts";
import { CHECKERS } from "./checker.ts";
import { SERVE, serveDaemon } from "./daemon.ts";
import {
  colors,
  OUTPUT_FORMATS,
  type OutputFormat,
  summarize,
  writer,
} from "./format.ts";
import { changedFiles } from "./git.ts";
import type {
  Baseline,
  Checker,
  DiagnosticSource,
  TypecheckOptions,
  TypecheckResult,
} from "./types.ts";
import { codeOf, errorOf, messageOf } from "./unknown.ts";
import { watch } from "./watch.ts";

const HELP = `Usage: svelte-typecheck [options] [-- checker args]

Type-checks Svelte components, as svelte-check does.

svelte-check's options:
  --workspace <dir>         Project folder (default: the current one)
  --output <format>         human, human-verbose, machine, machine-verbose,
                            agent or github, for GitHub Actions annotations
                            (default: human-verbose, or agent when
                            AGENT, AI_AGENT, CLAUDECODE, CODEX_CI or
                            CODEX_THREAD_ID is set, and not to 0, which it
                            says on stderr; SVELTE_TYPECHECK_OUTPUT sets
                            another)
  --tsconfig <path>         tsconfig or jsconfig, relative to the workspace;
                            its TS and JS files' errors are reported too
                            (default: the nearest from the workspace up)
  --no-tsconfig             Check every component under the workspace, and
                            no TS or JS files
  --ignore <list>           With --no-tsconfig: paths to skip, relative to
                            the workspace, comma-separated
  --config <path>           vite.config or svelte.config to read preprocessors
                            and compilerOptions from (default: the nearest)
  --diagnostic-sources <list>
                            js, svelte and css, comma-separated (default: all;
                            css reports nothing)
  --threshold <level>       error reports errors only (default: warning)
  --compiler-warnings <list>
                            code:ignore or code:error, comma-separated
  --fail-on-warnings        Exit 1 on a warning too
  --color, --no-color       Force color on or off
  --watch                   Check again when a file changes
  --preserveWatchOutput     Don't clear the screen between watch runs
  --incremental             Keep generated code between runs, and let the
                            checker reuse its last run (the default)
  --no-incremental          Start from nothing each run
  --tsgo                    Check with tsgo (same as --checker tsgo)
  -h, --help                Show this help
  -v, --version             Show the version

svelte-typecheck's own:
  --checker <name>          tsc, tsgo, tsrs or bun (default: the project's
                            TypeScript, then the first installed)
  --components <glob>       Components to check, relative to the workspace,
                            instead of the tsconfig's; repeatable
  --out-dir <dir>           Where to write the generated code (default:
                            node_modules/.cache/svelte-typecheck/<workspace>)
  --no-declarations         Resolve component imports to their own
                            .svelte.d.ts
  --svelte <dir>            Svelte package to check against
  --changed                 Report only files changed from HEAD (and
                            untracked), and the files that import them
  --since <ref>             As --changed, from where the branch left <ref>
  --baseline <file>         Report only diagnostics the baseline doesn't have
  --update-baseline         Write the run's diagnostics to the baseline
  --strict-baseline         Exit 1 when the baseline has fixed diagnostics,
                            so it only goes down
  --daemon                  Run on a process kept alive for this folder,
                            started if none runs (SVELTE_TYPECHECK_DAEMON=1
                            for every run; not on CI or with --watch)
  --no-daemon               Run here, whatever SVELTE_TYPECHECK_DAEMON says
  -- <args>                 Pass the rest to the checker, after its own:
                            -- --fast for tsrs's fast mode, or
                            -- --checkers 8 for tsgo's or tsrs's threads

The daemon:
  svelte-typecheck start    Start it for this folder
  svelte-typecheck stop     Stop it
  svelte-typecheck status   Show whether it runs, and its log

Exits 1 on an error, or a warning with --fail-on-warnings, and 2 when
called wrong: an unknown option, or a missing or bad value.`;

/** Runs the CLI and returns its exit code. */
export async function main(argv: string[]): Promise<0 | 1 | 2> {
  // A daemon `cli.ts` started for `--daemon`, serving runs.
  if (argv[0] === SERVE && argv[1]) {
    await serveDaemon(argv[1], main);
    return new Promise(() => {});
  }
  try {
    return await run(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    // One line that points the way: the whole usage would bury it.
    console.error(`svelte-typecheck: ${error.message} (${error.hint})`);
    return 2;
  }
}

// A separate class so a run called wrong exits 2, and a script tells it
// from a run that found problems, which exits 1.
class UsageError extends Error {
  readonly hint: string;
  constructor(message: string, hint = "see --help") {
    super(message);
    this.hint = hint;
  }
}

async function run(argv: string[]): Promise<0 | 1> {
  const { values, rest } = parse(argv);
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    const { version } = await import("../package.json");
    console.log(version);
    return 0;
  }
  const options = optionsOf(values, rest);
  const baselinePath = values.baseline && resolve(values.baseline);
  if (values["update-baseline"] && !baselinePath)
    throw new UsageError("--update-baseline needs --baseline <file>");
  const strict = values["strict-baseline"];
  if (strict && !baselinePath)
    throw new UsageError("--strict-baseline needs --baseline <file>");
  // A baseline of some files' diagnostics would drop the rest's, and the
  // rest would look fixed.
  for (const flag of ["update-baseline", "strict-baseline"] as const)
    if (values[flag] && (values.changed || values.since))
      throw new UsageError(`--${flag} takes every file's: drop --changed`);
  let baseline: Baseline | undefined;
  if (baselinePath && !values["update-baseline"]) {
    try {
      baseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as Baseline;
    } catch {
      throw new UsageError(
        `no baseline at ${baselinePath}: write one with --update-baseline`,
      );
    }
  }
  const { format, agentVariable } = formatOf(values.output);
  if (agentVariable) {
    process.stderr.write(
      `svelte-typecheck: ${agentVariable} is set, so --output agent; pass --output or set SVELTE_TYPECHECK_OUTPUT for another.\n`,
    );
  }
  const out = writer(
    format,
    (text) => process.stdout.write(text),
    colors(colorFlag(values.color, values["no-color"])),
  );
  if (values.changed || values.since) {
    try {
      options.only = changedFiles(process.cwd(), values.since);
    } catch (error) {
      out.failure(errorOf(error));
      return 1;
    }
  }
  const errorsOnly = values.threshold === "error";
  const failOnWarnings = values["fail-on-warnings"];

  /** Prints a run as svelte-check does and returns its exit code. */
  const report = (result: TypecheckResult | Error, watching: boolean) => {
    if (result instanceof Error) {
      out.failure(
        result instanceof EmitError
          ? new Error(
              `${result.message}\nThis is a svelte-typecheck bug; please report it.`,
            )
          : result,
      );
      return 1;
    }
    if (baselinePath && values["update-baseline"]) {
      const written = createBaseline(result.diagnostics, result.workspace);
      writeFileSync(baselinePath, `${JSON.stringify(written, null, 2)}\n`);
      out.note(
        `Wrote ${result.diagnostics.length} diagnostics to ${baselinePath}`,
      );
      return 0;
    }
    const known = baseline
      ? applyBaseline(result.diagnostics, baseline, result.workspace)
      : undefined;
    const shown = known ? known.diagnostics : result.diagnostics;
    out.start(result.workspace, watching && !values.preserveWatchOutput);
    // The threshold hides warnings, which still count, as in svelte-check.
    for (const d of shown)
      if (!errorsOnly || d.severity === "error")
        out.diagnostic(d, result.workspace);
    for (const f of result.failed)
      out.failure(new Error(`${f.file}: failed to parse: ${f.message}`));
    const summary = summarize(shown, result.components);
    if (known?.known)
      out.note(`${known.known} more in the baseline, not shown`);
    if (known?.fixed)
      out.note(
        `${known.fixed} in the baseline are fixed: --update-baseline drops them`,
      );
    if (result.skipped > 0)
      out.note(
        `${result.skipped} more in files the changes don't reach, not shown`,
      );
    out.completion(summary, watching);
    return summary.errors > 0 ||
      result.failed.length > 0 ||
      (failOnWarnings && summary.warnings > 0) ||
      (strict && (known?.fixed ?? 0) > 0)
      ? 1
      : 0;
  };

  if (values.watch) {
    watch(options, (result) => report(result, true));
    return new Promise(() => {});
  }
  try {
    return report(await typecheck(options), false);
  } catch (error) {
    return report(errorOf(error), false);
  }
}

const SOURCES: readonly DiagnosticSource[] = ["js", "svelte", "css"];

// Checked here, so a misspelled flag fails at once instead of finding no
// checker, or no diagnostics, later.
function checkerOf(name: string | undefined): Checker | undefined {
  if (name === undefined) return undefined;
  const checker = CHECKERS.find((c) => c === name);
  if (!checker)
    throw new UsageError(`--checker takes ${CHECKERS.join(", ")}, not ${name}`);
  return checker;
}

function sourceOf(name: string): DiagnosticSource {
  const source = SOURCES.find((s) => s === name);
  if (!source)
    throw new UsageError(
      `--diagnostic-sources takes ${SOURCES.join(", ")}, not ${name}`,
    );
  return source;
}

/**
 * The run's options from parsed flags, as the CLI passes them
 * to `typecheck`.
 */
function optionsOf(
  values: ReturnType<typeof parse>["values"],
  rest: string[],
): TypecheckOptions {
  return {
    workspace: values.workspace ?? ".",
    tsconfig: values["no-tsconfig"] ? false : values.tsconfig,
    ignore: values.ignore?.split(","),
    config: values.config,
    checker: checkerOf(
      values.checker ??
        (values.tsgo || values["tsgo-experimental-api"] ? "tsgo" : undefined),
    ),
    checkerArgs: rest.length > 0 ? rest : undefined,
    components: values.components,
    outDir: values["out-dir"],
    declarations: !values["no-declarations"],
    svelte: values.svelte,
    diagnosticSources: values["diagnostic-sources"]
      ?.split(",")
      .map((source) => sourceOf(source.trim())),
    compilerWarnings: parseCompilerWarnings(values["compiler-warnings"]),
    // On unless `--no-incremental`; `--incremental` is svelte-check's flag.
    incremental: !values["no-incremental"],
  };
}

/**
 * The options the CLI runs with for `argv`: the parity eval runs the
 * same check.
 */
export function cliOptions(argv: string[]): TypecheckOptions {
  const { values, rest } = parse(argv);
  return optionsOf(values, rest);
}

/**
 * Set by a coding agent: `AGENT` and `CLAUDECODE`, which `bun check`
 * reads; `AI_AGENT`, the shared name; and `CODEX_CI` and
 * `CODEX_THREAD_ID`, which Codex sets.
 */
export const AGENT_ENV: string[] = [
  "AGENT",
  "AI_AGENT",
  "CLAUDECODE",
  "CODEX_CI",
  "CODEX_THREAD_ID",
];

/**
 * svelte-check's default, human-verbose, or agent when an `AGENT_ENV`
 * variable is set to a value other than empty or `0`, as `bun check`
 * reads its own.
 */
function formatOf(output: string | undefined): {
  format: OutputFormat;
  agentVariable?: string;
} {
  const env = process.env;
  const given = output ?? env.SVELTE_TYPECHECK_OUTPUT;
  const format = OUTPUT_FORMATS.find((f) => f === given);
  if (format) return { format };
  const agentVariable = AGENT_ENV.find((name) => {
    const value = env[name];
    return value !== undefined && value !== "" && value !== "0";
  });
  return agentVariable
    ? { format: "agent", agentVariable }
    : { format: "human-verbose" };
}

/**
 * svelte-typecheck's flags, and the checker's: whatever follows `--`, as
 * `npm run` and `cargo test` take theirs.
 */
function parse(argv: string[]) {
  const end = argv.indexOf("--");
  const rest = end === -1 ? [] : argv.slice(end + 1);
  try {
    const { values } = parseArgs({
      args: end === -1 ? argv : argv.slice(0, end),
      options: OPTIONS,
    });
    return { values, rest };
  } catch (error) {
    throw usageOf(error) ?? error;
  }
}

const OPTIONS = {
  workspace: { type: "string" },
  output: { type: "string" },
  tsconfig: { type: "string" },
  "no-tsconfig": { type: "boolean", default: false },
  ignore: { type: "string" },
  config: { type: "string" },
  "diagnostic-sources": { type: "string" },
  threshold: { type: "string" },
  "compiler-warnings": { type: "string" },
  "fail-on-warnings": { type: "boolean", default: false },
  color: { type: "boolean", default: false },
  "no-color": { type: "boolean", default: false },
  tsgo: { type: "boolean", default: false },
  incremental: { type: "boolean", default: false },
  "no-incremental": { type: "boolean", default: false },
  watch: { type: "boolean", default: false },
  preserveWatchOutput: { type: "boolean", default: false },
  // svelte-check's, accepted for a drop-in.
  "tsgo-experimental-api": { type: "boolean", default: false },
  checker: { type: "string" },
  components: { type: "string", multiple: true },
  "out-dir": { type: "string" },
  "no-declarations": { type: "boolean", default: false },
  svelte: { type: "string" },
  changed: { type: "boolean", default: false },
  baseline: { type: "string" },
  "update-baseline": { type: "boolean", default: false },
  "strict-baseline": { type: "boolean", default: false },
  since: { type: "string" },
  // `cli.ts`'s, which hands the run to a daemon.
  daemon: { type: "boolean", default: false },
  "no-daemon": { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
} as const;

// compat: parseArgs's messages differ between Node and Bun, and run to
// several lines, so each is rewritten from its code; each names its
// option or argument first, in quotes.
function usageOf(error: unknown): UsageError | undefined {
  const message = messageOf(error);
  const named = /'([^' ]+)/.exec(message)?.[1] ?? "";
  const code = codeOf(error);
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    // compat: Bun names a short option in a group without its dash.
    const flag = named.startsWith("-") ? named : `-${named}`;
    const near = nearestOption(flag);
    return new UsageError(
      `unknown option ${flag}`,
      near ? `did you mean ${near}?` : undefined,
    );
  }
  if (code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL")
    return new UsageError(
      `unexpected argument ${named}: the checker's arguments go after --`,
    );
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE")
    return new UsageError(
      message.includes("does not take")
        ? `${named} takes no value`
        : `${named} needs a value`,
    );
  return undefined;
}

// A long option within a third of its length in edits, so a typo finds
// its flag and another word finds none. A short one is a letter from any
// other, so it gets none.
function nearestOption(flag: string): string | undefined {
  if (!flag.startsWith("--")) return undefined;
  const typed = flag.slice(2);
  let nearest: string | undefined;
  let best = Math.max(1, Math.floor(typed.length / 3)) + 1;
  for (const name of Object.keys(OPTIONS)) {
    const edits = distance(typed, name);
    if (edits < best) {
      nearest = `--${name}`;
      best = edits;
    }
  }
  return nearest;
}

// A swap of two neighbors, as in `--hlep`, counts as one edit, as typing
// fast swaps letters; Levenshtein would count two.
function distance(a: string, b: string): number {
  const width = b.length + 1;
  const cells = Array.from({ length: (a.length + 1) * width }, (_, k) =>
    k < width ? k : k % width === 0 ? k / width : 0,
  );
  const at = (i: number, j: number) => cells[i * width + j] ?? 0;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      let edits = Math.min(
        at(i - 1, j) + 1,
        at(i, j - 1) + 1,
        at(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        edits = Math.min(edits, at(i - 2, j - 2) + 1);
      cells[i * width + j] = edits;
    }
  return at(a.length, b.length);
}

/**
 * `a11y_missing_attribute:ignore,css_unused_selector:error`, as
 * svelte-check takes it.
 */
function parseCompilerWarnings(
  list: string | undefined,
): Record<string, "ignore" | "error"> | undefined {
  if (!list) return;
  const levels: Record<string, "ignore" | "error"> = {};
  for (const entry of list.split(",")) {
    const [code, level] = entry.trim().split(":");
    if (code && (level === "ignore" || level === "error")) levels[code] = level;
  }
  return levels;
}

function colorFlag(on: boolean, off: boolean): boolean | undefined {
  if (on) return true;
  if (off) return false;
  return;
}
