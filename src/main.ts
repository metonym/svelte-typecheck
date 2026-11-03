import { parseArgs } from "node:util";
import { EmitError, typecheck } from "./check.ts";
import {
  colors,
  OUTPUT_FORMATS,
  type OutputFormat,
  summarize,
  writer,
} from "./format.ts";
import type { Checker, DiagnosticSource } from "./types.ts";

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
  --config <path>           svelte.config to read preprocessors from
  --diagnostic-sources <list>
                            js, svelte and css, comma-separated (default: all;
                            css reports nothing)
  --threshold <level>       error reports errors only (default: warning)
  --compiler-warnings <list>
                            code:ignore or code:error, comma-separated
  --fail-on-warnings        Exit 1 on a warning too
  --color, --no-color       Force color on or off
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

Exits 1 on an error, or a warning with --fail-on-warnings.`;

/** Runs the CLI and returns its exit code. */
export async function main(argv: string[]): Promise<0 | 1> {
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
  const workspace = values.workspace ?? ".";
  try {
    const result = await typecheck({
      workspace,
      tsconfig: values["no-tsconfig"] ? false : values.tsconfig,
      ignore: values.ignore?.split(","),
      config: values.config,
      checker: (values.checker ?? (values.tsgo ? "tsgo" : undefined)) as
        Checker | undefined,
      components: values.components,
      outDir: values["out-dir"],
      declarations: !values["no-declarations"],
      svelte: values.svelte,
      diagnosticSources: values["diagnostic-sources"]
        ?.split(",")
        .map((source) => source.trim()) as DiagnosticSource[] | undefined,
      compilerWarnings: parseCompilerWarnings(values["compiler-warnings"]),
    });
    out.start(result.workspace);
    // The threshold hides warnings, which still count, as in svelte-check.
    const errorsOnly = values.threshold === "error";
    for (const d of result.diagnostics)
      if (!errorsOnly || d.severity === "error")
        out.diagnostic(d, result.workspace);
    for (const f of result.failed)
      out.failure(new Error(`${f.file}: failed to parse: ${f.message}`));
    const summary = summarize(result.diagnostics, result.components);
    out.completion(summary);
    const fails =
      summary.errors > 0 ||
      result.failed.length > 0 ||
      (values["fail-on-warnings"] && summary.warnings > 0);
    return fails ? 1 : 0;
  } catch (error) {
    out.failure(
      error instanceof EmitError
        ? new Error(
            `${error.message}\nThis is a svelte-typecheck bug; please report it.`,
          )
        : (error as Error),
    );
    return 1;
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
      // svelte-check's, accepted for a drop-in; this always works like them.
      incremental: { type: "boolean", default: false },
      "tsgo-experimental-api": { type: "boolean", default: false },
      checker: { type: "string" },
      components: { type: "string", multiple: true },
      "out-dir": { type: "string" },
      "no-declarations": { type: "boolean", default: false },
      svelte: { type: "string" },
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
