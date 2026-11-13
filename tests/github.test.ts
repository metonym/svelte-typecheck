import { join } from "node:path";
import { colors, writer } from "../src/format.ts";
import type { Diagnostic } from "../src/types.ts";

const root = join(import.meta.dir, "..");

const run = (diagnostics: Diagnostic[], env: Record<string, string> = {}) => {
  const saved = process.env.GITHUB_WORKSPACE;
  delete process.env.GITHUB_WORKSPACE;
  Object.assign(process.env, env);
  let out = "";
  const w = writer("github", (text) => (out += text), colors(false));
  w.start(join(root, "tests"));
  for (const d of diagnostics) w.diagnostic(d, join(root, "tests"));
  w.completion({
    files: 2,
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warning").length,
    filesWithProblems: new Set(diagnostics.map((d) => d.file)).size,
  });
  if (saved === undefined) delete process.env.GITHUB_WORKSPACE;
  else process.env.GITHUB_WORKSPACE = saved;
  return out;
};

const error: Diagnostic = {
  file: join(root, "tests/A.svelte"),
  line: 2,
  column: 7,
  endLine: 2,
  endColumn: 12,
  severity: "error",
  source: "js",
  code: "TS2322",
  message: "Type 'string' is not assignable to type 'number'.",
};

describe("github output", () => {
  it("prints each problem as an annotation, then the summary", () => {
    expect(run([error]).split("\n")).toEqual([
      "::error file=A.svelte,line=2,col=7,endLine=2,endColumn=12,title=TS2322::Type 'string' is not assignable to type 'number'.",
      "====================================",
      "svelte-typecheck found 1 error and 0 warnings in 1 file",
      "",
    ]);
  });

  it("names a file from the repository's root", () => {
    expect(run([error], { GITHUB_WORKSPACE: root })).toStartWith(
      "::error file=tests/A.svelte,",
    );
  });

  it("escapes what would end a command", () => {
    const warning: Diagnostic = {
      ...error,
      file: join(root, "tests/a,b:c.svelte"),
      severity: "warning",
      source: "svelte",
      code: "a11y_missing_attribute",
      message: "100% wrong\nhttps://svelte.dev/e/a11y_missing_attribute",
    };
    expect(run([warning]).split("\n")[0]).toBe(
      "::warning file=a%2Cb%3Ac.svelte,line=2,col=7,endLine=2,endColumn=12,title=a11y_missing_attribute::100%25 wrong%0Ahttps://svelte.dev/e/a11y_missing_attribute",
    );
  });
});
