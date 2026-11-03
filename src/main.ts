import { parseArgs } from "node:util";
import { EmitError, typecheck } from "./check.ts";
import type { Checker } from "./types.ts";

const HELP = `Usage: svelte-typecheck [options]

Type-checks the Svelte components in a workspace.

Options:
  --workspace <dir>     Folder whose components to check (default: .)
  --tsconfig <path>     tsconfig to extend (default: <workspace>/tsconfig.json)
  --checker <name>      tsc, tsgo, tsrs or bun (default: the project's
                        TypeScript, then the first installed)
  --components <glob>   Components to check, relative to the workspace;
                        repeatable (default: **/*.svelte)
  --out-dir <dir>       Where to write the generated code
                        (default: node_modules/.cache/svelte-typecheck/<workspace>)
  --no-declarations     Resolve component imports to their own .svelte.d.ts
  --svelte <dir>        Svelte package to check against (default: resolved)
  --output <format>     human or machine (default: human)
  -h, --help            Show this help
  -v, --version         Show the version

Exits 1 on a type error, 2 on a usage or emit error.`;

/** Runs the CLI and returns its exit code. */
export async function main(argv: string[]): Promise<0 | 1 | 2> {
  let values: ReturnType<typeof parse>["values"];
  try {
    values = parse(argv).values;
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${HELP}`);
    return 2;
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
  try {
    const result = await typecheck({
      workspace: values.workspace,
      tsconfig: values.tsconfig,
      checker: values.checker as Checker | undefined,
      components: values.components,
      outDir: values["out-dir"],
      declarations: !values["no-declarations"],
      svelte: values.svelte,
    });
    const machine = values.output === "machine";
    for (const d of result.diagnostics)
      console.log(
        machine
          ? `ERROR ${JSON.stringify(d.file)} ${d.line}:${d.column} ${JSON.stringify(d.message)} ${d.code}`
          : `${d.file}:${d.line}:${d.column} - error ${d.code}: ${d.message}`,
      );
    for (const f of result.failed)
      console.error(`${f.file}: failed to parse: ${f.message}`);
    console.error(
      `${result.components} components, ${result.diagnostics.length} errors [emit ${Math.round(result.timings.emit)} ms, ${result.checker}${result.checkerVersion ? ` ${result.checkerVersion}` : ""} ${Math.round(result.timings.check)} ms]`,
    );
    if (result.failed.length > 0) return 2;
    return result.diagnostics.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(
      error instanceof EmitError
        ? `${error.message}\nThis is a svelte-typecheck bug; please report it.`
        : (error as Error).message,
    );
    return 2;
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      workspace: { type: "string" },
      tsconfig: { type: "string" },
      checker: { type: "string" },
      components: { type: "string", multiple: true },
      "out-dir": { type: "string" },
      "no-declarations": { type: "boolean", default: false },
      svelte: { type: "string" },
      output: { type: "string", default: "human" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
}
