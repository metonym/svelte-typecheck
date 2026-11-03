import { parseModule } from "sveast";
import { Output } from "./output.ts";

// eslint-disable-next-line typescript/no-explicit-any -- sveast's AST is untyped here
type Node = any;

/**
 * SvelteKit's files, typed as svelte-check types them (svelte2tsx's
 * `upsertKitFile`): a route's `load`, `actions`, page options and request
 * handlers, the hooks and the param matchers get the types in `./$types`
 * and `@sveltejs/kit` where they have none of their own.
 */
const ROUTE_FILES = new Set([
  "+page",
  "+layout",
  "+page.server",
  "+layout.server",
  "+server",
]);
const EXTENSION = /\.[^./]+$/;
const SCRIPT = /\.[cm]?[jt]s$/;
const TS_FILE = /\.[cm]?ts$/;
const JSDOC_BLOCK = /\/\*\*[\s\S]*?\*\//g;
const JSDOC_FUNCTION = /@(type|param)\b/;
const JSDOC_VARIABLE = /@(type|satisfies)\b/;
const API_METHODS = [
  "GET",
  "PUT",
  "POST",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "fallback",
];
const PAGE_OPTIONS: [string, string][] = [
  ["prerender", "boolean | 'auto'"],
  ["trailingSlash", "'never' | 'always' | 'ignore'"],
  ["ssr", "boolean"],
  ["csr", "boolean"],
];

/** `+page`, `+layout.server`, `+page@group`…: a route's own files. */
export function isKitRouteFile(basename: string): boolean {
  const name = basename.includes("@")
    ? basename.split("@")[0]
    : basename.replace(EXTENSION, "");
  return ROUTE_FILES.has(name ?? "");
}

export function isKitErrorFile(basename: string): boolean {
  return basename.replace(EXTENSION, "") === "+error";
}

function isHooksFile(path: string, basename: string, hooks: string) {
  return (
    ((basename === "index.ts" || basename === "index.js") &&
      path.slice(0, -basename.length - 1).endsWith(hooks)) ||
    path.replace(EXTENSION, "").endsWith(hooks)
  );
}

function isParamsFile(path: string, basename: string) {
  return (
    path.slice(0, -basename.length - 1).endsWith("src/params") &&
    !basename.includes(".test") &&
    !basename.includes(".spec")
  );
}

/** Whether svelte-check types a script as one of SvelteKit's files. */
export function isKitFile(path: string): boolean {
  const posix = path.replaceAll("\\", "/");
  const basename = posix.slice(posix.lastIndexOf("/") + 1);
  if (!SCRIPT.test(basename)) return false;
  return (
    isKitRouteFile(basename) ||
    ["src/hooks.server", "src/hooks.client", "src/hooks"].some((hooks) =>
      isHooksFile(posix, basename, hooks),
    ) ||
    isParamsFile(posix, basename)
  );
}

interface Export {
  type: "function" | "var";
  /** The function, or the variable's declarator. */
  node: Node;
  /** The `export` statement. */
  statement: Node;
  typed: boolean;
}

/**
 * A SvelteKit file with the types svelte-check adds, mapped back to the
 * source. `hooksModule` is where the hooks' types are:
 * `@sveltejs/kit/hooks` from SvelteKit 3, `@sveltejs/kit` before.
 */
export function kitFile(
  path: string,
  source: string,
  hooksModule: string,
): Output | undefined {
  const posix = path.replaceAll("\\", "/");
  const basename = posix.slice(posix.lastIndexOf("/") + 1);
  if (!isKitFile(posix)) return;
  const isTs = TS_FILE.test(basename);
  const inserts: [number, string][] = [];
  const insert = (at: number, text: string) => inserts.push([at, text]);
  const exports = exportsOf(source, isTs);

  const paramEnd = (fn: Node) => fn.params[0].end;
  const returnAt = (fn: Node) =>
    fn.type === "ArrowFunctionExpression"
      ? source.lastIndexOf("=>", fn.body.start)
      : fn.body.start;
  /** Where TypeScript reads a function's JSDoc: before `export function`, or the arrow. */
  const jsdocAt = (e: Export) =>
    e.node.type === "FunctionDeclaration" ? e.statement.start : e.node.start;
  const jsdocParam = (e: Export, type: string) => {
    const p = e.node.params[0];
    const name = p?.type === "Identifier" ? p.name : "arg0";
    insert(jsdocAt(e), `/** @param {${type}} ${name} */ `);
  };
  const wrap = (init: Node, before: string, after: string) => {
    insert(init.start, before);
    insert(init.end, after);
  };
  const typeFunction = (
    name: string,
    type: string,
    returnType?: string,
    asyncReturnType?: string,
  ) => {
    const fn = exports.get(name);
    if (fn?.type !== "function" || fn.node.params.length !== 1 || fn.typed)
      return;
    if (!isTs) {
      insert(
        jsdocAt(fn),
        `/** @type {${returnType === undefined ? type : `(arg0: ${type}) => ${returnType}`}} */ `,
      );
      return;
    }
    insert(
      paramEnd(fn.node),
      returnType === undefined ? `: Parameters<${type}>[0]` : `: ${type}`,
    );
    if (fn.node.returnType || !fn.node.body) return;
    const effective =
      fn.node.async && asyncReturnType ? asyncReturnType : returnType;
    insert(
      returnAt(fn.node),
      effective === undefined ? `: ReturnType<${type}> ` : `: ${effective} `,
    );
  };
  const typeVariable = (name: string, type: string) => {
    const v = exports.get(name);
    if (v?.type !== "var" || v.typed || !v.node.init) return;
    if (isTs) insert(v.node.id.end, ` : ${type}`);
    else wrap(v.node.init, `/** @type {${type}} */ (`, ")");
  };

  if (isKitRouteFile(basename)) {
    const kind = basename.includes("layout") ? "Layout" : "Page";
    const loadType = `import('./$types.js').${kind}${basename.includes("server") ? "Server" : ""}Load`;
    const load = exports.get("load");
    if (load?.type === "function" && load.node.params.length === 1) {
      if (!load.typed) {
        if (isTs) insert(paramEnd(load.node), `: ${loadType}Event`);
        else jsdocParam(load, `${loadType}Event`);
      }
    } else if (load?.type === "var" && !load.typed && load.node.init) {
      if (isTs) wrap(load.node.init, "(", `) satisfies ${loadType}`);
      else wrap(load.node.init, `/** @satisfies {${loadType}} */ (`, ")");
    }
    const entries = exports.get("entries");
    if (
      entries?.type === "function" &&
      entries.node.params.length === 0 &&
      !entries.typed &&
      kind === "Page"
    ) {
      const type = "import('./$types.js').EntryGenerator";
      if (isTs && !entries.node.returnType && entries.node.body)
        insert(returnAt(entries.node), `: ReturnType<${type}> `);
      else if (!isTs) insert(jsdocAt(entries), `/** @type {${type}} */ `);
    }
    const actions = exports.get("actions");
    if (actions?.type === "var" && !actions.typed && actions.node.init) {
      const type = "import('./$types.js').Actions";
      if (isTs) insert(actions.node.init.end, ` satisfies ${type}`);
      else wrap(actions.node.init, `/** @satisfies {${type}} */ (`, ")");
    }
    for (const [name, type] of PAGE_OPTIONS) typeVariable(name, type);
    for (const method of API_METHODS)
      typeFunction(
        method,
        "import('./$types.js').RequestEvent",
        "Response | Promise<Response>",
        "Promise<Response>",
      );
  } else if (isHooksFile(posix, basename, "src/hooks.server")) {
    typeFunction("handleError", `import('${hooksModule}').HandleServerError`);
    typeFunction("handle", `import('${hooksModule}').Handle`);
    typeFunction("handleFetch", `import('${hooksModule}').HandleFetch`);
  } else if (isHooksFile(posix, basename, "src/hooks.client"))
    typeFunction("handleError", `import('${hooksModule}').HandleClientError`);
  else if (isHooksFile(posix, basename, "src/hooks"))
    typeFunction("reroute", `import('${hooksModule}').Reroute`);
  else typeFunction("match", "string", "boolean");

  // Stable: what's inserted at one place keeps its order.
  inserts.sort((a, b) => a[0] - b[0]);
  const out = new Output(source);
  let at = 0;
  for (const [pos, text] of inserts) {
    out.copy(at, pos).raw(text);
    at = pos;
  }
  return out.copy(at, source.length);
}

/** A module's `export function`s and single `export const`s, as svelte2tsx reads them. */
function exportsOf(source: string, isTs: boolean): Map<string, Export> {
  const exports = new Map<string, Export>();
  let previous = 0;
  for (const statement of parseModule(source, { typescript: isTs }).body) {
    const before = previous;
    previous = statement.end;
    if (statement.type !== "ExportNamedDeclaration") continue;
    const d = statement.declaration;
    /** JSDoc between the last statement and `to`, which TypeScript reads. */
    const jsdoc = (to: number, tags: RegExp) =>
      !isTs &&
      [...source.slice(before, to).matchAll(JSDOC_BLOCK)].some((m) =>
        tags.test(m[0]),
      );
    const typedParameter = (fn: Node) =>
      Boolean(paramType(fn.params[0])) || jsdoc(fn.start, JSDOC_FUNCTION);
    if (d?.type === "FunctionDeclaration" && d.id)
      exports.set(d.id.name, {
        type: "function",
        node: d,
        statement,
        typed: typedParameter(d),
      });
    if (d?.type !== "VariableDeclaration" || d.declarations.length !== 1)
      continue;
    const declarator: Node = d.declarations[0];
    const init = declarator.init;
    const typed =
      Boolean(declarator.id.typeAnnotation) ||
      jsdoc(declarator.id.start, JSDOC_VARIABLE) ||
      init?.type === "TSSatisfiesExpression";
    const fn = init?.type === "TSSatisfiesExpression" ? init.expression : init;
    if (
      fn?.type === "FunctionExpression" ||
      fn?.type === "ArrowFunctionExpression"
    )
      exports.set(source.slice(declarator.id.start, declarator.id.end), {
        type: "function",
        node: fn,
        statement,
        typed: typed || typedParameter(fn),
      });
    else if (declarator.id.type === "Identifier")
      exports.set(declarator.id.name, {
        type: "var",
        node: declarator,
        statement,
        typed,
      });
  }
  return exports;
}

/** A parameter's type annotation, past a default value. */
function paramType(p: Node): Node {
  if (!p) return;
  return p.type === "AssignmentPattern"
    ? p.left.typeAnnotation
    : p.typeAnnotation;
}

/** `data`'s, `form`'s or `snapshot`'s type in a route's component. */
export function kitPropType(
  basename: string,
  name: string,
): string | undefined {
  if (!isKitRouteFile(basename)) return;
  const layout = basename.includes("layout");
  if (name === "data")
    return `import('./$types.js').${layout ? "LayoutData" : "PageData"}`;
  if (name === "form") return "import('./$types.js').ActionData";
  if (name === "snapshot") return "import('./$types.js').Snapshot";
  return;
}

/** A prop svelte2tsx types in a route's or `+error.svelte`'s untyped `$props()`. */
export function kitRuneProp(
  basename: string,
  name: string,
): string | undefined {
  if (isKitErrorFile(basename))
    return name === "error" ? "App.Error" : undefined;
  if (!isKitRouteFile(basename)) return;
  const layout = basename.includes("layout");
  if (name === "params")
    return `import('./$types.js').${layout ? "LayoutProps" : "PageProps"}['params']`;
  if (name === "data" || (name === "form" && !layout))
    return kitPropType(basename, name);
  return;
}
