import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkerArgs, checkerCommand, CHECKERS } from "./checker.ts";
import { compilerDiagnostics, svelteDirOf } from "./compiler.ts";
import { emit } from "./emit.ts";
import { glob, matcher } from "./glob.ts";
import { createLocator, type Output } from "./output.ts";
import type { Diagnostic, TypecheckOptions, TypecheckResult } from "./types.ts";

/** `path(line,col): error TSxxxx: message`, as tsc, tsgo, tsrs and `bun check` print. */
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const CONTINUATION = /^\s+\S/;
const JS_FILE = /\.[cm]?jsx?$/;
/** Errors that stop a checker before it type-checks anything. */
const SYNTAX_CODE = /^TS[18]\d{3}$/;
const STOPPED = /Stopped before type checking/;
const LINE_COMMENT = /\/\/[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const TRAILING_COMMA = /,(\s*[}\]])/g;
const STRING = /"(?:[^"\\]|\\.)*"/g;

const SHIMS = fileURLToPath(new URL("./shims/", import.meta.url));

/** Thrown when generated code doesn't parse: an emitter bug, not a type error. */
export class EmitError extends Error {}

/** A tsconfig's JSON, comments and trailing commas allowed. */
function parseJsonc(text: string): unknown {
  const strings: string[] = [];
  const stripped = text
    .replace(STRING, (s) => `"\0${strings.push(s) - 1}"`)
    .replace(LINE_COMMENT, "")
    .replace(BLOCK_COMMENT, "")
    .replace(TRAILING_COMMA, "$1")
    .replaceAll(/"\0(\d+)"/g, (_, i: string) => strings[Number(i)] ?? "");
  return JSON.parse(stripped);
}

/** The `exclude` a tsconfig ends up with: the nearest one in its `extends` chain. */
function excludeOf(path: string): { exclude: string[]; from: string } {
  const config = parseJsonc(readFileSync(path, "utf-8")) as {
    extends?: string;
    exclude?: string[];
  };
  if (config.exclude) return { exclude: config.exclude, from: dirname(path) };
  if (!config.extends) return { exclude: [], from: dirname(path) };
  const base = config.extends.startsWith(".")
    ? resolve(dirname(path), config.extends)
    : createRequire(path).resolve(config.extends);
  return excludeOf(base);
}

function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", fail);
    child.on("close", () => done(output));
  });
}

/** Errors as the checker prints them, multi-line messages joined. */
function parseDiagnostics(text: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  let continues = false;
  for (const line of text.split("\n")) {
    const m = DIAGNOSTIC.exec(line);
    if (m) {
      const file = m[1] ?? "";
      found.push({
        file,
        line: Number(m[2]),
        column: Number(m[3]),
        severity: "error",
        source: JS_FILE.test(file) ? "js" : "ts",
        code: m[4] ?? "",
        message: m[5] ?? "",
      });
    } else if (continues && CONTINUATION.test(line)) {
      const last = found.at(-1);
      if (last) last.message += `\n${line}`;
    }
    // A blank line ends the errors: `bun check` follows them with a summary.
    continues = m !== null || (continues && line.trim() !== "");
  }
  return found;
}

/**
 * Type-checks a workspace's Svelte components: each one becomes TypeScript
 * (or JS with JSDoc) under `outDir`, next to a tsconfig that extends the
 * workspace's, a checker runs on it, and each error maps back to its
 * `.svelte` line. Errors in generated code are dropped.
 */
export async function typecheck(
  options: TypecheckOptions = {},
): Promise<TypecheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const workspace = resolve(cwd, options.workspace ?? ".");
  const baseConfig = resolve(
    cwd,
    options.tsconfig ?? join(workspace, "tsconfig.json"),
  );
  const outDir = resolve(
    cwd,
    options.outDir ??
      join("node_modules/.cache/svelte-typecheck", relative(cwd, workspace)),
  );
  const genDir = join(outDir, "svelte");
  const declarations = options.declarations ?? true;
  const svelteDir = svelteDirOf(cwd, options.svelte);
  const sources = new Set(options.diagnosticSources ?? ["js", "svelte"]);
  const errorsOnly = options.threshold === "error";
  const { version } = JSON.parse(
    readFileSync(join(svelteDir, "package.json"), "utf-8"),
  ) as { version: string };
  const svelteMajor = Number(version.split(".")[0]);
  // Svelte 4 and 5 ship element typings; Svelte 3 doesn't.
  const svelteHtml =
    svelteMajor === 3
      ? join(SHIMS, "svelte3-elements.d.ts")
      : join(svelteDir, "svelte-html.d.ts");

  const checker =
    options.checker ??
    CHECKERS.find((c) => checkerCommand(c, cwd) !== undefined);
  const command = checker && checkerCommand(checker, cwd);
  if (!(checker && command))
    throw new Error(
      `No type checker found: install \`typescript\` (or one of ${CHECKERS.slice(1).join(", ")}), or name one with \`checker\`.`,
    );

  const base = excludeOf(baseConfig);
  const excluded = base.exclude
    .map((pattern) => relative(workspace, resolve(base.from, pattern)))
    .filter((pattern) => !pattern.startsWith(".."));

  const started = performance.now();
  await rm(outDir, { recursive: true, force: true });
  const isExcluded = matcher(excluded);
  const files = glob(workspace, options.components ?? ["**/*.svelte"]).filter(
    (rel) => !isExcluded(rel),
  );
  const texts = await Promise.all(
    files.map((rel) => readFile(join(workspace, rel), "utf-8")),
  );

  const outputs = new Map<
    string,
    { output: Output; source: string; svelte: string; isTs: boolean }
  >();
  const writes: Promise<void>[] = [];
  const write = (path: string, content: string) =>
    writes.push(
      mkdir(dirname(path), { recursive: true }).then(() =>
        writeFile(path, content),
      ),
    );
  const failed: TypecheckResult["failed"] = [];
  for (const [i, rel] of files.entries()) {
    const path = join(workspace, rel);
    const genFrom = join(genDir, dirname(rel));
    let result: ReturnType<typeof emit>;
    try {
      result = emit(texts[i] ?? "", {
        svelte: svelteMajor,
        // A relative import that leaves the workspace is relative to the
        // generated file's folder instead.
        rewriteImport(specifier) {
          if (!specifier.startsWith(".")) return;
          const target = resolve(dirname(path), specifier);
          if (target.startsWith(`${workspace}/`)) return;
          const next = relative(genFrom, target);
          return next.startsWith(".") ? next : `./${next}`;
        },
      });
    } catch (error) {
      failed.push({
        file: relative(cwd, path),
        message: (error as Error).message,
      });
      continue;
    }
    const name = rel.slice(rel.lastIndexOf("/") + 1, -".svelte".length);
    const genPath = join(
      genFrom,
      `++${name}.svelte.${result.isTs ? "ts" : "js"}`,
    );
    outputs.set(genPath, {
      output: result.out,
      source: texts[i] ?? "",
      svelte: path,
      isTs: result.isTs,
    });
    write(genPath, result.out.code);
    if (declarations)
      write(
        join(genFrom, `${name}.d.svelte.ts`),
        `export { default } from "./++${name}.svelte.js";\nexport * from "./++${name}.svelte.js";\n`,
      );
  }

  const tsconfig = join(outDir, "tsconfig.json");
  const workspaceRel = relative(outDir, workspace);
  write(
    tsconfig,
    JSON.stringify(
      {
        extends: relative(outDir, baseConfig),
        compilerOptions: {
          rootDirs: [workspaceRel, "svelte"],
          allowArbitraryExtensions: true,
          noEmit: true,
        },
        // Listed rather than globbed: `include` skips dot folders and
        // `node_modules`, where the generated code lives by default.
        files: [join(SHIMS, "shims.d.ts"), svelteHtml, ...outputs.keys()].map(
          (path) => relative(outDir, path),
        ),
        // The workspace's own TypeScript, which can import components.
        include: declarations ? [workspaceRel] : [],
        exclude: [
          `${workspaceRel}/**/node_modules`,
          ...excluded.map((pattern) => join(workspaceRel, pattern)),
        ],
      },
      null,
      2,
    ),
  );
  await Promise.all(writes);
  const emitted = performance.now();

  // The compiler pass runs while the checker's process works.
  const checking = sources.has("js")
    ? run(
        command.command,
        [...command.prefix, ...checkerArgs(checker, tsconfig)],
        cwd,
      ).then((output) => ({ output, at: performance.now() }))
    : Promise.resolve({ output: "", at: emitted });
  const compiled: Diagnostic[] = [];
  if (sources.has("svelte"))
    for (const [i, rel] of files.entries()) {
      const file = relative(cwd, join(workspace, rel));
      for (const d of compilerDiagnostics(texts[i] ?? "", file, {
        cwd,
        svelte: svelteDir,
      })) {
        const level = options.compilerWarnings?.[d.code];
        if (d.severity === "warning" && level === "ignore") continue;
        const severity = level === "error" ? "error" : d.severity;
        compiled.push({ file, ...d, severity, source: "svelte" });
      }
    }
  const compiledAt = performance.now();
  const { output: text, at: checked } = await checking;

  const raw = parseDiagnostics(text);
  const inOutput = (file: string) =>
    resolve(cwd, file).startsWith(`${outDir}/`);
  // A syntax error in generated code stops the checker before it
  // type-checks anything, so it must fail the run, not pass it.
  const syntax = raw.filter(
    (d) => inOutput(d.file) && SYNTAX_CODE.test(d.code),
  );
  if (syntax.length > 0 || STOPPED.test(text))
    throw new EmitError(
      `Generated code has syntax errors:\n${syntax
        .slice(0, 20)
        .map((d) => `${d.file}(${d.line},${d.column}): ${d.code} ${d.message}`)
        .join("\n")}`,
    );

  const locators = new Map<string, ReturnType<typeof createLocator>>();
  const locator = (key: string, content: string) => {
    let found = locators.get(key);
    if (!found) {
      found = createLocator(content);
      locators.set(key, found);
    }
    return found;
  };
  const diagnostics: Diagnostic[] = [];
  const dropped: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const d of raw) {
    const abs = resolve(cwd, d.file);
    const gen = outputs.get(abs);
    let mapped: Diagnostic;
    if (gen) {
      const offset = locator(abs, gen.output.code).offset(d.line, d.column);
      const source = gen.output.toSource(offset);
      if (source === null) {
        dropped.push(d);
        continue;
      }
      const { line, column } = locator(gen.svelte, gen.source).position(source);
      mapped = {
        ...d,
        file: relative(cwd, gen.svelte),
        line,
        column,
        source: gen.isTs ? "ts" : "js",
      };
    } else if (inOutput(d.file)) {
      dropped.push(d);
      continue;
    } else mapped = { ...d, file: relative(cwd, abs) };
    const key = `${mapped.file}:${mapped.line}:${mapped.column}:${mapped.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(mapped);
  }
  diagnostics.push(...compiled);
  if (errorsOnly) {
    const kept = diagnostics.filter((d) => d.severity === "error");
    diagnostics.length = 0;
    diagnostics.push(...kept);
  }
  diagnostics.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
  return {
    diagnostics,
    components: outputs.size,
    dropped,
    failed,
    checker,
    checkerVersion: command.version,
    timings: {
      emit: emitted - started,
      check: checked - emitted,
      compile: compiledAt - emitted,
    },
  };
}
