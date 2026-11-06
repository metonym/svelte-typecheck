import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyBaseline, createBaseline } from "./baseline.ts";
import { EmitError, typecheck } from "./check.ts";
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
import { watch } from "./watch.ts";

const HELP = `Usage: svelte-typecheck [options]

Type-checks Svelte components, as svelte-check does.

svelte-check's options:
  --workspace <dir>         Project folder (default: the current one)
  --output <format>         human, human-verbose, machine or machine-verbose
                            (default: human-verbose)
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

The daemon:
  svelte-typecheck start    Start it for this folder
  svelte-typecheck stop     Stop it
  svelte-typecheck status   Show whether it runs, and its log

Exits 1 on an error, or a warning with --fail-on-warnings.`;

/** Runs the CLI and returns its exit code. */
export async function main(argv: string[]): Promise<0 | 1> {
  // A daemon `cli.ts` started for `--daemon`, serving runs.
  if (argv[0] === SERVE && argv[1]) {
    await serveDaemon(argv[1], main);
    return new Promise(() => {});
  }
  let values: ReturnType<typeof parse>["values"];
  try {
    values = parse(argv).values;
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${HELP}`);
    return 1;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    const { version } = await import("../package.json");
    console.log(version);
    return 0;
  }
  const format = formatOf(values.output);
  const out = writer(
    format,
    (text) => process.stdout.write(text),
    colors(colorFlag(values.color, values["no-color"])),
  );
  const options: TypecheckOptions = {
    workspace: values.workspace ?? ".",
    tsconfig: values["no-tsconfig"] ? false : values.tsconfig,
    ignore: values.ignore?.split(","),
    config: values.config,
    checker: (values.checker ??
      (values.tsgo || values["tsgo-experimental-api"] ? "tsgo" : undefined)) as
      Checker | undefined,
    components: values.components,
    outDir: values["out-dir"],
    declarations: !values["no-declarations"],
    svelte: values.svelte,
    diagnosticSources: values["diagnostic-sources"]
      ?.split(",")
      .map((source) => source.trim()) as DiagnosticSource[] | undefined,
    compilerWarnings: parseCompilerWarnings(values["compiler-warnings"]),
    // On unless `--no-incremental`; `--incremental` is svelte-check's flag.
    incremental: !values["no-incremental"],
  };
  if (values.changed || values.since) {
    try {
      options.only = changedFiles(process.cwd(), values.since);
    } catch (error) {
      out.failure(error as Error);
      return 1;
    }
  }
  const baselinePath = values.baseline && resolve(values.baseline);
  if (values["update-baseline"] && !baselinePath) {
    out.failure(new Error("--update-baseline needs --baseline <file>"));
    return 1;
  }
  const strict = values["strict-baseline"];
  if (strict && !baselinePath) {
    out.failure(new Error("--strict-baseline needs --baseline <file>"));
    return 1;
  }
  // A baseline of some files' diagnostics would drop the rest's, and the
  // rest would look fixed.
  for (const flag of ["update-baseline", "strict-baseline"] as const)
    if (values[flag] && (values.changed || values.since)) {
      out.failure(new Error(`--${flag} takes every file's: drop --changed`));
      return 1;
    }
  let baseline: Baseline | undefined;
  if (baselinePath && !values["update-baseline"]) {
    try {
      baseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as Baseline;
    } catch {
      out.failure(
        new Error(
          `No baseline at ${baselinePath}: write one with --update-baseline`,
        ),
      );
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
    return report(error as Error, false);
  }
}

/** svelte-check's default: human-verbose, or machine in Claude Code. */
function formatOf(output: string | undefined): OutputFormat {
  if (output && (OUTPUT_FORMATS as string[]).includes(output))
    return output as OutputFormat;
  return process.env.CLAUDECODE === "1" ? "machine" : "human-verbose";
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
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
    },
  });
}

/** `a11y_missing_attribute:ignore,css_unused_selector:error`, as svelte-check takes it. */
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
