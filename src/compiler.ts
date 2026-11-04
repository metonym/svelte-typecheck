import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { lexComponent } from "sveast";
import type { Preprocessor, SvelteConfig } from "./config.ts";
import { createLocator } from "./output.ts";
import { originalPosition } from "./sourcemap.ts";
import type { CompilerDiagnostic } from "./types.ts";

interface Warning {
  code: string;
  message: string;
  start?: { line: number; column: number };
  end?: { line: number; column: number };
}
interface Compiler {
  compile(
    source: string,
    options: { filename: string; generate: false; dev?: boolean },
  ): { warnings: Warning[] };
  preprocess(
    source: string,
    preprocessors: Preprocessor | Preprocessor[],
    options: { filename: string },
  ): Promise<{ code: string; map?: string | { mappings: string } }>;
}

/** The Svelte package a project checks against: `svelte`, from `cwd`. */
export function svelteDirOf(cwd: string, svelte?: string): string {
  return svelte
    ? resolve(cwd, svelte)
    : dirname(
        createRequire(join(cwd, "package.json")).resolve("svelte/package.json"),
      );
}

const compilers = new Map<string, Compiler>();

/**
 * That Svelte's compiler, through `require`, which every version from 3
 * up exports, so a project's own version reports its own warnings.
 */
function compilerOf(svelteDir: string): Compiler {
  let compiler = compilers.get(svelteDir);
  if (!compiler) {
    compiler = createRequire(join(svelteDir, "package.json"))(
      "svelte/compiler",
    ) as Compiler;
    compilers.set(svelteDir, compiler);
  }
  return compiler;
}

function diagnosticsOf(
  compiler: Compiler,
  source: string,
  filename: string,
  compilerOptions: Record<string, unknown> = {},
): CompilerDiagnostic[] {
  try {
    const { warnings } = compiler.compile(source, {
      ...compilerOptions,
      filename,
      generate: false,
    });
    return warnings.map((w) => ({
      severity: "warning",
      code: w.code,
      message: w.message,
      ...positionsOf(w),
    }));
  } catch (error) {
    const e = error as Warning;
    return [
      {
        severity: "error",
        code: e.code ?? "compile_error",
        message: e.message,
        ...positionsOf(e),
      },
    ];
  }
}

/** Svelte's 1-based line and 0-based column, as 1-based both. */
function positionsOf(w: Warning) {
  const line = w.start?.line ?? 1;
  const column = (w.start?.column ?? 0) + 1;
  return {
    line,
    column,
    endLine: w.end?.line ?? line,
    endColumn: w.end ? w.end.column + 1 : column,
  };
}

/**
 * What `svelte/compiler` reports for a component (a11y, unused CSS, invalid
 * markup), without generating code. `<!-- svelte-ignore -->` applies, as in
 * a build. A compile error comes back as one `error`.
 */
export function compilerDiagnostics(
  source: string,
  filename: string,
  options: { cwd?: string; svelte?: string } = {},
): CompilerDiagnostic[] {
  const compiler = compilerOf(
    svelteDirOf(resolve(options.cwd ?? process.cwd()), options.svelte),
  );
  return diagnosticsOf(compiler, source, filename);
}

/**
 * `compilerDiagnostics` after svelte.config's preprocessors, with each
 * position mapped back to the source, as svelte-check does.
 */
export async function preprocessedDiagnostics(
  source: string,
  filename: string,
  svelteDir: string,
  config: SvelteConfig,
): Promise<CompilerDiagnostic[]> {
  const compiler = compilerOf(svelteDir);
  const { preprocess, compilerOptions } = config;
  let diagnostics: CompilerDiagnostic[];
  const processed = preprocess
    ? await compiler.preprocess(source, preprocess, { filename })
    : undefined;
  if (!processed || processed.code === source)
    diagnostics = diagnosticsOf(compiler, source, filename, compilerOptions);
  else {
    const map =
      typeof processed.map === "string"
        ? (JSON.parse(processed.map) as { mappings: string })
        : processed.map;
    const toOriginal = originalPosition(map);
    diagnostics = diagnosticsOf(
      compiler,
      processed.code,
      filename,
      compilerOptions,
    ).map((d) => {
      const start = toOriginal(d.line, d.column);
      const end = toOriginal(d.endLine ?? d.line, d.endColumn ?? d.column);
      return { ...d, ...start, endLine: end.line, endColumn: end.column };
    });
  }
  return asSvelteCheck(diagnostics, source, Boolean(preprocess));
}

const TEXT_TYPE = /^text\//;
const EXPORTED_TYPE = (name: string) =>
  new RegExp(`\\bexport\\s+?(enum|namespace)\\s+?${name}\\b`);

/**
 * What svelte-check does with the compiler's diagnostics. Without
 * preprocessors, a `lang` it can't compile (`lang="scss"`, a non-TS
 * script) makes a parse error and that section's warnings false
 * positives; a parse error in a script or style gets a hint about
 * preprocessors.
 */
function asSvelteCheck(
  diagnostics: CompilerDiagnostic[],
  source: string,
  preprocessed: boolean,
): CompilerDiagnostic[] {
  const lexed = lexComponent(source);
  const script = lexed.instance ?? lexed.module;
  const langOf = (
    attributes: { name: string; value: string | true }[] = [],
  ) => {
    const lang =
      attributes.find((a) => a.name === "lang") ??
      attributes.find((a) => a.name === "type");
    return typeof lang?.value === "string"
      ? lang.value.replace(TEXT_TYPE, "")
      : "";
  };
  const scriptLang = langOf(script?.attributes);
  const styleLang = langOf(lexed.css?.attributes);
  const ignoreScript =
    !preprocessed && scriptLang !== "" && scriptLang !== "ts";
  const ignoreStyle = !preprocessed && styleLang !== "";
  const offsetOf = createLocator(source).offset;
  const inside = (
    d: CompilerDiagnostic,
    tag?: { content: { start: number; end: number } } | null,
  ) => {
    if (!tag) return false;
    const at = offsetOf(d.line, d.column);
    return tag.content.start <= at && at <= tag.content.end;
  };
  const kept: CompilerDiagnostic[] = [];
  for (const d of diagnostics) {
    if (d.severity === "error") {
      if (d.message.includes("expected")) {
        if (!preprocessed && (scriptLang || styleLang)) continue;
        const inScript = inside(d, script);
        if (inScript || inside(d, lexed.css))
          d.message +=
            "\n\nIf you expect this syntax to work, here are some suggestions: " +
            (inScript
              ? '\nIf you use typescript with `svelte-preprocess`, did you add `lang="ts"` to your `script` tag? '
              : '\nIf you use less/SCSS with `svelte-preprocess`, did you add `lang="scss"`/`lang="less"` to your `style` tag? If you use SCSS, it may be necessary to add the path to your NODE runtime to the setting `svelte.language-server.runtime`, or use `sass` instead of `node-sass`. ') +
            "\nDid you setup a `svelte.config.js` or `vite.config.js`? \nSee https://github.com/sveltejs/language-tools/tree/master/docs#using-with-preprocessors for more info.";
      }
      kept.push(d);
      continue;
    }
    if (ignoreScript && !d.code.startsWith("a11y")) continue;
    if (
      ignoreStyle &&
      (d.code === "css_unused_selector" || d.code === "css-unused-selector")
    )
      continue;
    if (d.code === "export_let_unused" || d.code === "unused-export-let") {
      const name = d.message.slice(
        d.message.indexOf("'") + 1,
        d.message.lastIndexOf("'"),
      );
      if (EXPORTED_TYPE(name).test(source)) continue;
    }
    kept.push(d);
  }
  return kept;
}
