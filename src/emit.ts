import {
  isReference,
  isRunesMode,
  parse,
  parseModule,
  SKIP,
  walk,
} from "sveast";
import { analyzeScopes } from "sveast/scope";
import {
  isKitErrorFile,
  isKitRouteFile,
  kitPropType,
  kitRuneProp,
} from "./kit.ts";
import { Output } from "./output.ts";

/**
 * Turns a component into TypeScript (or JS with JSDoc, for a component
 * without `lang="ts"`) that a type checker can read, the way svelte2tsx
 * does: the instance script becomes a `$$render` function, the markup an
 * `async () => {}` inside it, and the component the default export. The
 * `__sveltets_2_*` helpers it calls are declared in `shims.d.ts`, and
 * `svelteHTML` in svelte's `svelte-html.d.ts`.
 */
const GENERIC_PARAM =
  /^(\w+)(?:\s+extends\s+([\s\S]+?))?(?:\s*=\s*([\s\S]+))?$/;
const TS_LANG = /^(ts|typescript)$/;
const OWNS_TEMPLATE = /@(typedef|callback)\b/;
const JSDOC_BLOCK = /\/\*\*[\s\S]*?\*\//g;
const CALL_PARENS = /\s*\(\s*\)$/;
const JSDOC_LINE_START = /^\s*\/?\*+\s?/;
const JSDOC_END = /\s*\*\/\s*$/;
const USES_ALL_PROPS = /\$\$(restProps|props)\b/;
const WHITESPACE = /\s/;

/** Attributes svelte2tsx passes as numbers when their text is numeric. */
const TYPING_INTERFACES = new Set(["$$Props", "$$Events", "$$Slots"]);
const NUMBER_ATTRIBUTES = new Set(
  "aria-colcount aria-colindex aria-colspan aria-level aria-posinset aria-rowcount aria-rowindex aria-rowspan aria-setsize aria-valuemax aria-valuemin aria-valuenow results span marginheight marginwidth maxlength minlength currenttime defaultplaybackrate volume high low optimum start size border cols rows colspan rowspan tabindex".split(
    " ",
  ),
);

/** A generated `$$bindings` check for a component's `bind:`, and the directive. */
interface BindingCheck {
  /** The check, as generated offsets. */
  start: number;
  end: number;
  /** The directive, as source offsets. */
  from: number;
  to: number;
}

/** A generated `$name` declaration, and the source's `$name` uses. */
interface StoreDeclaration {
  /** The declaration, as generated offsets. */
  start: number;
  end: number;
  name: string;
  /** Source offsets of `$name`. */
  uses: number[];
}

export interface EmitOptions {
  /** A new specifier for an import that leaves the workspace, if any. */
  rewriteImport?: (specifier: string) => string | undefined;
  /** Svelte's major version: Svelte 3 types a component as a class. */
  svelte?: number;
  /** The file's name, for SvelteKit's route components: `+page.svelte`. */
  basename?: string;
  /** Whether a JS component's types are checked (`checkJs`). Default `true`. */
  checkJs?: boolean;
}

/** `T extends A = B, U` as its parameters, top-level commas only. */
function genericParams(generics: string): string[] {
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of generics) {
    if ("<([{".includes(c)) depth++;
    if (">)]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      params.push(current);
      current = "";
    } else current += c;
  }
  params.push(current);
  return params.map((p) => p.trim()).filter(Boolean);
}

/** `generics="T extends A = B, U"` as JSDoc: `@template {A} [T=B]`, `@template U`. */
function jsdocTemplates(generics: string) {
  return genericParams(generics).map((p) => {
    const m = p.match(GENERIC_PARAM);
    if (!m) return ` * @template ${p}`;
    const [, name, constraint, fallback] = m;
    return ` * @template ${constraint ? `{${constraint}} ` : ""}${fallback ? `[${name}=${fallback}]` : name}`;
  });
}

const JSDOC_TYPE = /@type\b/;
const TS_WRAPPER = /^TS(As|Satisfies|NonNull)Expression$/;
const FUNCTION =
  /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|MethodDefinition|PropertyDefinition)$/;

/** The type svelte2tsx infers for a prop from its default. */
// eslint-disable-next-line typescript/no-explicit-any -- sveast's AST is untyped here
function typeOfDefault(init: any, source: string): string {
  if (init.type === "TSAsExpression")
    return source.slice(init.typeAnnotation.start, init.typeAnnotation.end);
  if (init.type === "Literal") {
    if (typeof init.value === "string") return "string";
    if (typeof init.value === "number") return "number";
    if (typeof init.value === "boolean") return "boolean";
    return "any";
  }
  if (init.type === "Identifier" && init.name !== "undefined")
    return `typeof ${init.name}`;
  if (init.type === "ArrowFunctionExpression") return "Function";
  if (init.type === "ObjectExpression") return "Record<string, any>";
  if (init.type === "ArrayExpression") return "any[]";
  return "any";
}

/** The `$props()` declarator of a statement, if it has one. */
// eslint-disable-next-line typescript/no-explicit-any -- sveast's AST is untyped here
function propsDeclaratorOf(s: any) {
  if (s.type !== "VariableDeclaration") return;
  return s.declarations.find(
    // eslint-disable-next-line typescript/no-explicit-any -- as above
    (d: any) =>
      d.init?.type === "CallExpression" &&
      d.init.callee.type === "Identifier" &&
      d.init.callee.name === "$props",
  );
}

// eslint-disable-next-line typescript/no-explicit-any -- sveast's AST is untyped here
type AnyNode = any;

/** TypeScript-only syntax in a JS script, as TypeScript reports it. */
export interface TsInJs {
  /** The source offset TypeScript reports it at. */
  at: number;
  code: string;
  message: string;
}

/**
 * Parses a component as svelte2tsx does: when a script doesn't parse,
 * the markup is parsed with the scripts left out, and the scripts with
 * TypeScript's grammar, so a JS script with TypeScript in it is still
 * typed. A script that isn't TypeScript either, or markup that doesn't
 * parse, throws the parser's error.
 */
function parseComponent(source: string): { ast: AnyNode; tsInJs: TsInJs[] } {
  try {
    return { ast: parse(source, { css: false }), tsInJs: [] };
  } catch (error) {
    if (!(error as { start?: unknown }).start) throw error;
    const ast: AnyNode = parse(source, { css: false, script: false });
    const tsInJs: TsInJs[] = [];
    for (const script of [ast.instance, ast.module]) {
      if (!script) continue;
      const { start, end } = script.content;
      let program: AnyNode;
      try {
        // Spaces keep the offsets the component's.
        program = parseModule(" ".repeat(start) + source.slice(start, end), {
          typescript: true,
        });
      } catch {
        throw error;
      }
      program.start = start;
      program.end = end;
      script.content = program;
      tsInJs.push(...typescriptOnly(program));
    }
    return { ast, tsInJs };
  }
}

const TS_ONLY: Record<string, [code: string, message: string]> = {
  TSTypeAnnotation: [
    "TS8010",
    "Type annotations can only be used in TypeScript files.",
  ],
  TSAsExpression: [
    "TS8016",
    "Type assertion expressions can only be used in TypeScript files.",
  ],
  TSSatisfiesExpression: [
    "TS8037",
    "Type satisfaction expressions can only be used in TypeScript files.",
  ],
  TSNonNullExpression: [
    "TS8013",
    "Non-null assertions can only be used in TypeScript files.",
  ],
  TSInterfaceDeclaration: [
    "TS8006",
    "'interface' declarations can only be used in TypeScript files.",
  ],
  TSEnumDeclaration: [
    "TS8006",
    "'enum' declarations can only be used in TypeScript files.",
  ],
  TSTypeAliasDeclaration: [
    "TS8008",
    "Type aliases can only be used in TypeScript files.",
  ],
  TSTypeParameterDeclaration: [
    "TS8004",
    "Type parameter declarations can only be used in TypeScript files.",
  ],
  TSTypeParameterInstantiation: [
    "TS8011",
    "Type arguments can only be used in TypeScript files.",
  ],
};

/** Where TypeScript reports a JS file's TypeScript syntax: the type, the name, or the node. */
function typescriptOnly(program: AnyNode): TsInJs[] {
  const found: TsInJs[] = [];
  walk(program, {
    enter(node: AnyNode) {
      if (
        (node.type === "ImportDeclaration" ||
          node.type === "ExportNamedDeclaration") &&
        (node.importKind === "type" || node.exportKind === "type")
      ) {
        const keyword = node.type === "ImportDeclaration" ? "import" : "export";
        found.push({
          at: node.start,
          code: "TS8006",
          message: `'${keyword} type' declarations can only be used in TypeScript files.`,
        });
        return SKIP;
      }
      const ts = TS_ONLY[node.type];
      if (!ts) return;
      const at =
        node.id?.start ??
        node.typeAnnotation?.start ??
        node.params?.[0]?.start ??
        node.start;
      found.push({ at, code: ts[0], message: ts[1] });
      // An assertion's expression can hold more; a type can't.
      return node.type === "TSNonNullExpression" ||
        node.type === "TSAsExpression" ||
        node.type === "TSSatisfiesExpression"
        ? undefined
        : SKIP;
    },
  });
  return found;
}

export function emit(
  source: string,
  {
    rewriteImport,
    svelte = 5,
    basename = "",
    checkJs = true,
  }: EmitOptions = {},
) {
  // eslint-disable-next-line typescript/no-explicit-any -- sveast's AST is untyped here
  type Node = any;
  const { ast, tsInJs } = parseComponent(source);
  const scopes: Node = analyzeScopes(ast);
  const out = new Output(source);
  const instance = ast.instance;
  const module = ast.module;
  /** The component's language, as its scripts say. */
  const lang = [instance, module].some((script) =>
    script?.attributes?.some(
      (a: Node) => a.name === "lang" && TS_LANG.test(textOf(a)),
    ),
  )
    ? "ts"
    : "js";
  // TypeScript in a JS component: TypeScript reports it, which a checker
  // treats as a syntax error that stops it, so it's typed as TS and the
  // errors come from `tsInJs`.
  const isTs = lang === "ts" || tsInJs.length > 0;
  // Typed as TS, it's checked as TS; a JS component is only with `checkJs`.
  if (tsInJs.length > 0 && !checkJs) out.raw("// @ts-nocheck\n");
  let uid = 0;
  /** `$:` statements and transition directives, as source ranges. */
  const reactive: [number, number][] = [];
  const transitions: [number, number][] = [];
  /** Each `<slot>`'s attributes, by slot name. */
  const slots = new Map<string, Node[]>();
  /** Events the component forwards: an element's DOM event, or `any`. */
  const forwarded = new Map<string, string>();
  /** Svelte 5 compiles runes components to functions, typed by `$props()`. */
  const runes = svelte >= 5 && isRunesMode(source);
  const bindingChecks: BindingCheck[] = [];

  function textOf(attribute: Node) {
    const value = Array.isArray(attribute.value)
      ? attribute.value[0]
      : attribute.value;
    return value?.data ?? "";
  }

  const idsOf = (pattern: Node, ids: string[] = []): string[] => {
    if (!pattern) return ids;
    if (pattern.type === "Identifier") ids.push(pattern.name);
    else if (pattern.type === "ObjectPattern")
      for (const p of pattern.properties)
        idsOf(p.type === "RestElement" ? p.argument : p.value, ids);
    else if (pattern.type === "ArrayPattern")
      for (const e of pattern.elements) idsOf(e, ids);
    else if (pattern.type === "AssignmentPattern") idsOf(pattern.left, ids);
    else if (pattern.type === "RestElement") idsOf(pattern.argument, ids);
    return ids;
  };

  // --- Module script and the instance script's imports, at the top level.
  /** Copies a statement, pointing an import that leaves the workspace at its target. */
  const copyStatement = (s: Node) => {
    const spec = s.source?.value;
    const next = typeof spec === "string" ? rewriteImport?.(spec) : undefined;
    if (next === undefined) return out.copy(s.start, s.end);
    out.copy(s.start, s.source.start);
    out.from(s.source.start, () => out.raw(JSON.stringify(next)));
    return out.copy(s.source.end, s.end);
  };
  if (module) {
    let at = module.content.start;
    for (const s of module.content.body) {
      out.copy(at, s.start);
      copyStatement(s);
      at = s.end;
    }
    out.copy(at, module.content.end).raw("\n");
  }
  const body: Node[] = instance?.content.body ?? [];
  /** Svelte 5's `await` at the instance script's top level makes `$$render` async. */
  let topLevelAwait = false;
  if (svelte >= 5)
    for (const s of body)
      walk(s, {
        enter(node: Node) {
          if (node.type === "AwaitExpression") topLevelAwait = true;
          return FUNCTION.test(node.type) ? SKIP : undefined;
        },
      });
  for (const s of body)
    if (s.type === "ImportDeclaration") copyStatement(s).raw("\n");

  // --- svelte2tsx's typing interfaces: `$$Props`, `$$Events`, `$$Slots`.
  const typed = new Set<string>();
  for (const s of body) {
    const d = s.type === "ExportNamedDeclaration" ? s.declaration : s;
    if (
      (d?.type === "TSInterfaceDeclaration" ||
        d?.type === "TSTypeAliasDeclaration") &&
      TYPING_INTERFACES.has(d.id?.name)
    )
      typed.add(d.id.name);
  }
  const strictEvents =
    typed.has("$$Events") ||
    instance?.attributes?.some((a: Node) => a.name === "strictEvents");

  // --- Generics: `generics="…"` in TS, `@template` blocks in JS. TS 7 reads
  // only the JSDoc block right above a function, so merge the tags into one.
  /** JSDoc blocks moved out of the instance script. */
  const templateBlocks: [number, number][] = [];
  /** The component's type parameters, in TS: `generics="…"` and `$$Generic`. */
  const typeParams: string[] = [];
  /** `type T = $$Generic<C>` statements, which become type parameters. */
  const genericAliases = new Set<Node>();
  if (instance && isTs)
    for (const s of body) {
      const ref = s.type === "TSTypeAliasDeclaration" ? s.typeAnnotation : null;
      if (ref?.type !== "TSTypeReference" || ref.typeName?.name !== "$$Generic")
        continue;
      genericAliases.add(s);
      const arg = (ref.typeArguments ?? ref.typeParameters)?.params?.[0];
      typeParams.push(
        arg
          ? `${s.id.name} extends ${source.slice(arg.start, arg.end)}`
          : s.id.name,
      );
    }
  let generics = "";
  /** In JS, the component's `@template` tags, written right above `$$render`. */
  let templateDoc = "";
  if (instance) {
    const tags: string[] = [];
    const attr = instance.attributes.find((a: Node) => a.name === "generics");
    if (attr && isTs) typeParams.unshift(...genericParams(textOf(attr)));
    else if (attr) tags.push(...jsdocTemplates(textOf(attr)));
    const text = source.slice(instance.content.start, instance.content.end);
    for (const m of text.matchAll(JSDOC_BLOCK)) {
      const start = instance.content.start + (m.index ?? 0);
      // A `@typedef` or `@callback` (which owns its `@template`) moves to the
      // top level, where TS 7 lets the component's `@template` see it.
      if (OWNS_TEMPLATE.test(m[0])) {
        templateBlocks.push([start, start + m[0].length]);
        // The `;` keeps its other tags (sveld's `@type` for an event) off
        // the next declaration.
        out.copy(start, start + m[0].length).raw("\n;\n");
        continue;
      }
      if (!m[0].includes("@template")) continue;
      templateBlocks.push([start, start + m[0].length]);
      for (const line of m[0].split("\n"))
        if (line.includes("@template"))
          tags.push(
            ` * ${line.replace(JSDOC_LINE_START, "").replace(JSDOC_END, "")}`,
          );
      // The rest of the block (its description) stays where it was.
    }
    if (tags.length > 0 && !isTs)
      templateDoc = `/**\n${tags.join("\n")}\n */\n`;
  }
  if (typeParams.length > 0) generics = `<${typeParams.join(", ")}>`;

  // --- Stores: `$name` is declared right after `name`, or at the start.
  const storeAfter = new Map<number, string[]>();
  const storeAtStart: string[] = [];
  const seenStores = new Set<string>();
  /** Each store's `$name` uses, as source offsets. */
  const storeUses = new Map<string, number[]>();
  for (const scope of [scopes.instance, scopes.module])
    for (const b of scope?.declarations?.values() ?? [])
      for (const r of b.references) {
        if (!r.store) continue;
        storeUses.set(b.name, [...(storeUses.get(b.name) ?? []), r.node.start]);
        if (seenStores.has(b.name)) continue;
        seenStores.add(b.name);
        const decl = b.declaration;
        const top =
          scope === scopes.instance && b.kind !== "import"
            ? body.find(
                (s: Node) => decl && s.start <= decl.start && decl.end <= s.end,
              )
            : undefined;
        if (top)
          storeAfter.set(top.end, [...(storeAfter.get(top.end) ?? []), b.name]);
        else storeAtStart.push(b.name);
      }
  /** Generated `$name` declarations, which check that `name` is a store. */
  const storeDeclarations: StoreDeclaration[] = [];
  const declareStore = (name: string) => {
    const start = out.code.length;
    out.raw(`let $${name} = __sveltets_2_store_get(${name});`);
    storeDeclarations.push({
      start,
      end: out.code.length,
      name,
      uses: storeUses.get(name) ?? [],
    });
  };

  // --- Markup.
  const attrValue = (value: Node) => {
    if (value === true) return out.raw("true");
    const parts = Array.isArray(value) ? value : [value];
    if (parts.length === 1 && parts[0].type === "ExpressionTag")
      return out
        .raw("(")
        .copy(parts[0].expression.start, parts[0].expression.end)
        .raw(")");
    if (parts.every((p: Node) => p.type === "Text"))
      return out.from(parts[0]?.start ?? 0, () =>
        out.raw(JSON.stringify(parts.map((p: Node) => p.data).join(""))),
      );
    out.raw("`");
    for (const p of parts) {
      if (p.type === "Text")
        out.raw(p.data.replace(/[`\\]|\$\{/g, (c: string) => `\\${c}`));
      else out.raw("${").copy(p.expression.start, p.expression.end).raw("}");
    }
    return out.raw("`");
  };
  const key = (attribute: Node, name: string) =>
    out.from(attribute.start, () => out.raw(JSON.stringify(name))).raw(":");
  const nameAt = (attribute: Node) => source.indexOf(":", attribute.start) + 1;
  const expression = (node: Node) =>
    out.raw("(").copy(node.start, node.end).raw(")");

  /** Writes an element's directives that aren't attributes, after it. */
  const directives = (node: Node, elementId: string, tag: string) => {
    for (const a of node.attributes ?? []) {
      if (a.type === "BindDirective") {
        if (a.name === "this")
          out
            .copy(a.expression.start, a.expression.end)
            .raw(` = ${elementId};`);
        else if (!isGetSet(a.expression)) widen(a.expression);
      } else if (a.type === "ClassDirective") expression(a.expression).raw(";");
      else if (a.type === "StyleDirective") {
        if (a.value === true) {
          const at = nameAt(a);
          out.copy(at, at + a.name.length).raw(";");
        } else attrValue(a.value).raw(";");
      } else if (a.type === "AnimateDirective") {
        const at = nameAt(a);
        out.raw("__sveltets_2_ensureAnimation(").copy(at, at + a.name.length);
        out.raw(
          `(svelteHTML.mapElementTag(${tag}),__sveltets_2_AnimationMove,`,
        );
        if (a.expression) out.copy(a.expression.start, a.expression.end);
        else out.raw("{}");
        out.raw("));");
      } else if (a.type === "TransitionDirective") {
        transitions.push([a.start, a.end]);
        const at = nameAt(a);
        out.raw("__sveltets_2_ensureTransition(").copy(at, at + a.name.length);
        out.raw(`(svelteHTML.mapElementTag(${tag}),`);
        if (a.expression) out.copy(a.expression.start, a.expression.end);
        else out.raw("{}");
        out.raw("));");
      }
    }
  };

  /** `{name}`'s name, which svelte2tsx writes as a shorthand property. */
  const shorthandOf = (a: Node): Node => {
    const value = Array.isArray(a.value) ? a.value[0] : a.value;
    return source[a.start] === "{" &&
      value?.type === "ExpressionTag" &&
      value.expression.type === "Identifier"
      ? value.expression
      : undefined;
  };
  const elementAttribute = (a: Node, inComponent: boolean) => {
    if (a.type === "Attribute") {
      if (inComponent && a.name === "slot") return;
      const shorthand = shorthandOf(a);
      if (shorthand) {
        out.copy(shorthand.start, shorthand.end).raw(",");
        return;
      }
      if (a.name.startsWith("data-")) {
        out.raw("...__sveltets_2_empty({");
        key(a, a.name);
        attrValue(a.value).raw("}),");
        return;
      }
      key(a, a.name);
      const only =
        Array.isArray(a.value) && a.value.length === 1 ? a.value[0] : null;
      if (a.value === true && a.name === "popover") out.raw('""');
      else if (
        only?.type === "Text" &&
        NUMBER_ATTRIBUTES.has(a.name.toLowerCase()) &&
        only.data.trim() !== "" &&
        !Number.isNaN(Number(only.data))
      )
        out.copy(only.start, only.end);
      else attrValue(a.value);
      out.raw(",");
    } else if (a.type === "SpreadAttribute")
      out.raw("...").copy(a.expression.start, a.expression.end).raw(",");
    else if (a.type === "OnDirective") {
      key(a, `on:${a.name}`);
      if (a.expression) expression(a.expression);
      else {
        out.raw("undefined");
        forwarded.set(
          a.name,
          `__sveltets_2_mapElementEvent(${JSON.stringify(a.name)})`,
        );
      }
      out.raw(",");
    } else if (a.type === "BindDirective" && a.name !== "this") {
      key(a, `bind:${a.name}`);
      bound(a.expression).raw(",");
    } else if (a.type === "AttachTag") attach(a);
  };
  /**
   * `() => x = any`: a `bind:` target can be written, so its type isn't
   * narrowed to its first value. An `as`, `satisfies` or `!` comes off, as
   * an assignment target can't have one.
   */
  const widen = (e: Node) => {
    let target = e;
    while (TS_WRAPPER.test(target.type)) target = target.expression;
    out
      .raw("() => ")
      .copy(target.start, target.end)
      .raw(" = __sveltets_2_any(null);");
  };
  /** `bind:x={get, set}` as svelte2tsx checks it: `set` takes what `get` returns. */
  const isGetSet = (e: Node) =>
    e.type === "SequenceExpression" && e.expressions.length === 2;
  const bound = (e: Node) => {
    if (!isGetSet(e)) return expression(e);
    const [get, set] = e.expressions;
    out.raw("__sveltets_2_get_set_binding(").copy(get.start, get.end).raw(",");
    return out.copy(set.start, set.end).raw(")");
  };
  /** `{@attach fn}`, which the element's typings take under a symbol key. */
  const attach = (a: Node) =>
    out
      .raw('[Symbol("@attach")]:')
      .copy(a.expression.start, a.expression.end)
      .raw(",");
  const attributeKey = (a: Node): string | null => {
    if (a.type === "Attribute") return a.name;
    if (a.type === "OnDirective") return `on:${a.name}`;
    if (a.type === "BindDirective") return `bind:${a.name}`;
    return null;
  };

  const element = (
    node: Node,
    tag: () => void,
    tagText: string,
    inComponent: boolean,
  ) => {
    const id = `$$_el${uid++}`;
    const boundary = node.type === "SvelteBoundary";
    // An error about the whole attributes object points at the tag name's
    // last letter, as svelte2tsx maps it, or `<svelte:element this>`'s value.
    const objectAt =
      node.type === "RegularElement"
        ? node.start + node.name.length
        : (node.tag?.start ?? node.start + 1);
    // A key can't repeat in an object literal (several `on:click`s can), so
    // each repeat gets its own `createElement` call.
    const seen = new Set<string>();
    const repeats: Node[] = [];
    // Actions go first: what they return can add to the element's attributes.
    out.raw("{");
    const actions: string[] = [];
    for (const a of node.attributes ?? []) {
      if (a.type !== "UseDirective") continue;
      const action = `$$_action${uid++}`;
      actions.push(action);
      const at = nameAt(a);
      out
        .raw(`const ${action} = __sveltets_2_ensureAction(`)
        .copy(at, at + a.name.length);
      out.raw(`(svelteHTML.mapElementTag(${tagText})`);
      if (a.expression) out.raw(",").copy(a.expression.start, a.expression.end);
      out.raw("));");
    }
    out.raw(`const ${id} = `);
    out.from(node.start + 1, () => {
      out.raw("svelteHTML.createElement(");
      tag();
      out.raw(", ");
      if (actions.length > 0)
        out.raw(`__sveltets_2_union(${actions.join(",")}), `);
      out.from(objectAt, () => out.raw("{"));
      for (const a of node.attributes ?? []) {
        const k = attributeKey(a);
        if (k !== null && seen.has(k)) repeats.push(a);
        else {
          if (k !== null) seen.add(k);
          elementAttribute(a, inComponent);
        }
      }
      // `<svelte:boundary>`'s snippets are its props.
      if (boundary)
        for (const c of node.fragment.nodes)
          if (c.type === "SnippetBlock") snippetProp(c);
      out.raw("})");
    });
    out.raw(";");
    for (const a of repeats)
      out.from(objectAt, () => {
        out.raw("svelteHTML.createElement(");
        tag();
        out.raw(", {");
        elementAttribute(a, inComponent);
        out.raw("});");
      });
    directives(node, id, tagText);
    fragment(node.fragment, !boundary);
    out.raw("}\n");
  };

  /** A component's children: its default slot, named slots and snippets. */
  const slotOf = (slotted: Node) =>
    (slotted.attributes ?? []).find(
      (a: Node) => a.type === "Attribute" && a.name === "slot",
    );
  const lets = (node: Node) =>
    (node.attributes ?? []).filter((a: Node) => a.type === "LetDirective");
  /**
   * `let:` props from a slot. A slot the component doesn't have is reported
   * where svelte-check reports it: after the last `let:` (its last letter
   * at the tag's end), or for a named slot (`slotted`, its element) at the
   * `slot` attribute's end if that's sooner; a named one even without
   * `let:`, at the element's `<`, or the attribute's end once a `bind:`
   * comes before it in the output.
   */
  const destructureLets = (
    letDirectives: Node[],
    from: string,
    slotted?: Node,
  ) => {
    const slotEnd = slotted ? slotOf(slotted).end - 1 : Infinity;
    if (letDirectives.length === 0) {
      if (!slotted) return;
      const binds = (slotted.attributes ?? []).some(
        (a: Node) => a.type === "BindDirective",
      );
      out.from(binds ? slotEnd : slotted.start, () => out.raw(from)).raw(";");
      return;
    }
    out.raw("const {");
    for (const d of letDirectives) {
      const at = nameAt(d);
      if (d.expression)
        out.raw(`${d.name}:`).copy(d.expression.start, d.expression.end);
      else out.copy(at, at + d.name.length);
      out.raw(",");
    }
    out.raw("} = ");
    const last = letDirectives.at(-1).end;
    const after = WHITESPACE.test(source[last] ?? "") ? last : last - 1;
    out.from(Math.min(after, slotEnd), () => out.raw(from));
    out.raw(";");
  };

  const component = (node: Node, ctor: () => void, inComponent = false) => {
    const id = `$$_c${uid++}`;
    const children: Node[] = node.fragment?.nodes ?? [];
    const snippets = children.filter((c) => c.type === "SnippetBlock");
    const named = children.filter(
      (c) => c.type !== "SnippetBlock" && slotOf(c),
    );
    const rest = children.filter(
      (c) => c.type !== "SnippetBlock" && !slotOf(c),
    );
    const hasDefault =
      rest.some((c) => c.type !== "Text" || c.data.trim()) &&
      !snippets.some((s) => s.expression.name === "children");
    out.raw(`{ const ${id}C = __sveltets_2_ensureComponent(`);
    ctor();
    out.raw("); ");
    out.from(node.start + 1, () => {
      out.raw(
        `const ${id} = new ${id}C({ target: __sveltets_2_any(), props: {`,
      );
      // Svelte 5 passes slot content as a `children` snippet.
      if (hasDefault && svelte >= 5)
        out.raw("children:() => { return __sveltets_2_any(0); },");
      for (const a of node.attributes ?? []) {
        if (a.type === "Attribute") {
          if (inComponent && a.name === "slot") continue;
          const shorthand = shorthandOf(a);
          if (shorthand) out.copy(shorthand.start, shorthand.end).raw(",");
          else {
            key(a, a.name);
            attrValue(a.value).raw(",");
          }
        } else if (a.type === "SpreadAttribute")
          out.raw("...").copy(a.expression.start, a.expression.end).raw(",");
        else if (a.type === "BindDirective" && a.name !== "this") {
          // An error on a bound prop points at its name, after `bind:`.
          out.from(nameAt(a), () => out.raw(JSON.stringify(a.name))).raw(":");
          if (isGetSet(a.expression)) bound(a.expression).raw(",");
          else out.copy(a.expression.start, a.expression.end).raw(",");
        } else if (a.type === "AttachTag") attach(a);
      }
      for (const s of snippets) snippetProp(s);
      out.raw("} });");
    });
    for (const a of node.attributes ?? []) {
      if (a.type === "BindDirective") {
        if (a.name === "this")
          out.copy(a.expression.start, a.expression.end).raw(` = ${id};`);
        else {
          if (!isGetSet(a.expression)) widen(a.expression);
          // Svelte 5 checks that the component's prop is bindable.
          if (svelte >= 5) {
            const start = out.code.length;
            out.raw(`${id}.$$bindings`);
            bindingChecks.push({
              start,
              end: out.code.length,
              from: a.start,
              to: a.end,
            });
            out.raw(` = ${JSON.stringify(a.name)};`);
          }
        }
      } else if (a.type === "OnDirective" && !a.expression) {
        if (!forwarded.has(a.name))
          forwarded.set(a.name, "__sveltets_2_any(0)");
      } else if (a.type === "OnDirective" && a.expression) {
        out.from(nameAt(a), () =>
          out.raw(`${id}.$on(${JSON.stringify(a.name)}, `),
        );
        out.copy(a.expression.start, a.expression.end).raw(");");
      }
    }
    out.raw("{");
    destructureLets(lets(node), `${id}.$$slot_def.default`);
    consts(rest);
    for (const c of rest) child(c, true);
    out.raw("}");
    for (const c of named) {
      out.raw("{");
      destructureLets(
        lets(c),
        `${id}.$$slot_def[${JSON.stringify(textOf(slotOf(c)))}]`,
        c,
      );
      if (c.type === "SvelteFragment") fragment(c.fragment);
      else child(c, true);
      out.raw("}");
    }
    out.raw("}\n");
  };

  const child = (node: Node, inComponent = false) => {
    switch (node.type) {
      case "Text":
      case "Comment":
      case "DebugTag":
      case "ConstTag":
        return;
      case "ExpressionTag":
      case "HtmlTag":
        return expression(node.expression).raw(";");
      case "RenderTag":
        return out
          .raw(";__sveltets_2_ensureSnippet(")
          .copy(node.expression.start, node.expression.end)
          .raw(");");
      case "RegularElement":
        return element(
          node,
          () => out.raw(JSON.stringify(node.name)),
          JSON.stringify(node.name),
          inComponent,
        );
      case "SvelteElement":
        return element(
          node,
          () => expression(node.tag),
          "__sveltets_2_any(0)",
          inComponent,
        );
      case "SvelteWindow":
      case "SvelteBody":
      case "SvelteDocument":
        return element(
          node,
          () => out.raw(JSON.stringify(node.name)),
          "__sveltets_2_any(0)",
          false,
        );
      case "SvelteBoundary":
        return element(
          node,
          () => out.raw('"svelte:boundary"'),
          "__sveltets_2_any(0)",
          false,
        );
      case "SvelteHead":
      case "SvelteFragment":
      case "TitleElement":
        return fragment(node.fragment);
      case "SvelteOptions":
        return;
      case "Component":
        return component(
          node,
          () => {
            const at = node.start + 1;
            out.copy(at, at + node.name.length);
          },
          inComponent,
        );
      case "SvelteComponent":
        return component(node, () => expression(node.expression), inComponent);
      case "SvelteSelf":
        return component(node, () => out.raw("__sveltets_2_any(0)"));
      case "SlotElement": {
        const nameAttr = (node.attributes ?? []).find(
          (a: Node) => a.type === "Attribute" && a.name === "name",
        );
        slots.set(
          nameAttr ? textOf(nameAttr) : "default",
          node.attributes ?? [],
        );
        // With `$$Slots`, the slot's props are checked against it.
        out.raw(
          typed.has("$$Slots")
            ? `__sveltets_createSlot(${JSON.stringify(nameAttr ? textOf(nameAttr) : "default")}, {`
            : "({",
        );
        for (const a of node.attributes ?? [])
          if (a.type === "Attribute" && a.name !== "name") {
            key(a, a.name);
            attrValue(a.value).raw(",");
          } else if (a.type === "SpreadAttribute")
            out.raw("...").copy(a.expression.start, a.expression.end).raw(",");
        out.raw("});{");
        fragment(node.fragment);
        return out.raw("}\n");
      }
      case "IfBlock":
        out.raw("if (");
        expression(node.test).raw(") {");
        fragment(node.consequent);
        out.raw("}");
        if (node.alternate) {
          out.raw(" else {");
          fragment(node.alternate);
          out.raw("}");
        }
        return out.raw("\n");
      case "EachBlock":
        out.raw("for (let ");
        if (node.context) out.copy(node.context.start, node.context.end);
        else out.raw("$$_item");
        out.raw(" of __sveltets_2_ensureArray(");
        out.copy(node.expression.start, node.expression.end).raw(")) {");
        if (node.index) out.raw(`let ${node.index} = 1;`);
        if (node.key) expression(node.key).raw(";");
        fragment(node.body);
        out.raw("}");
        if (node.fallback) {
          out.raw("{");
          fragment(node.fallback);
          out.raw("}");
        }
        return out.raw("\n");
      case "AwaitBlock": {
        const p = `$$_p${uid++}`;
        out.raw(`{ const ${p} = `);
        expression(node.expression).raw(";{");
        fragment(node.pending);
        out.raw("}{ const ");
        if (node.value) out.copy(node.value.start, node.value.end);
        else out.raw("$$_v");
        out.raw(` = await ${p};`);
        fragment(node.then);
        out.raw("}{ const ");
        if (node.error) out.copy(node.error.start, node.error.end);
        else out.raw("$$_e");
        out.raw(" = __sveltets_2_any(0);");
        fragment(node.catch);
        return out.raw("}}\n");
      }
      case "KeyBlock":
        expression(node.expression).raw(";");
        return fragment(node.fragment);
      default:
        if (node.fragment) fragment(node.fragment);
    }
  };

  /** Root snippets that read no instance binding, nor such a snippet. */
  function hoistable(snippets: Node[]): Set<Node> {
    const names = new Set(snippets.map((s) => s.expression.name));
    const reads = new Map<Node, { instance: boolean; snippets: Set<string> }>();
    for (const s of snippets) {
      const read = { instance: false, snippets: new Set<string>() };
      walk(s, {
        enter(node: Node, parent: Node) {
          if (node === s.expression) return;
          // `<Foo>` reads `Foo`, which the instance script may import.
          let name: string | undefined;
          if (node.type === "Component") name = node.name.split(".")[0];
          else if (node.type === "Identifier" && isReference(node, parent))
            name = node.name;
          if (!name) return;
          const b =
            node.type === "Identifier" ? scopes.bindingOf(node) : undefined;
          if (b && b.scope !== scopes.instance && b.scope !== scopes.module)
            return;
          if (b?.scope === scopes.instance || scopes.instance?.get(name))
            read.instance = true;
          else if (names.has(name)) read.snippets.add(name);
        },
      });
      reads.set(s, read);
    }
    const kept = new Set(snippets.filter((s) => !reads.get(s)?.instance));
    for (let changed = true; changed;) {
      changed = false;
      const keptNames = new Set([...kept].map((s) => s.expression.name));
      for (const s of kept)
        if (
          [...(reads.get(s)?.snippets ?? [])].some((n) => !keptNames.has(n))
        ) {
          kept.delete(s);
          changed = true;
        }
    }
    return kept;
  }

  /** A snippet's parameters, as written. */
  function parameters(node: Node) {
    for (const [i, p] of (node.parameters as Node[]).entries()) {
      if (i) out.raw(",");
      out.copy(p.start, p.end);
    }
  }
  /** A snippet passed as a prop: a component's, or `<svelte:boundary>`'s. */
  function snippetProp(node: Node) {
    out.from(node.expression.start, () =>
      out.raw(JSON.stringify(node.expression.name)),
    );
    out.raw(":(");
    parameters(node);
    out.raw(") => { async () => {");
    fragment(node.body);
    out.raw("}; return __sveltets_2_any(0); },");
  }
  /** A snippet as svelte2tsx declares it: an arrow that returns a snippet's result. */
  function snippet(node: Node) {
    out.raw("const ").copy(node.expression.start, node.expression.end);
    if (isTs) {
      out.raw(" = ");
      if (node.typeParams) {
        // An error in them points at their `<`, as svelte2tsx maps them.
        const at = source.indexOf("<", node.expression.end);
        out.from(at, () => out.raw(`<${node.typeParams}>`));
      }
      out.raw("(");
    } else
      out.raw(" = /** @returns {ReturnType<import('svelte').Snippet>} */ (");
    parameters(node);
    out.raw(
      `)${isTs ? ": ReturnType<import('svelte').Snippet>" : ""} => { async () => {`,
    );
    fragment(node.body);
    out.raw("}; return __sveltets_2_any(0); };\n");
  }

  /**
   * Snippets first, as svelte2tsx hoists them, then `{@const}` tags: both
   * are visible to the whole fragment. The root's snippets start `$$render`.
   */
  function fragment(f: Node, hoist = f !== ast.fragment) {
    if (!f) return;
    if (hoist)
      for (const n of f.nodes) if (n.type === "SnippetBlock") snippet(n);
    consts(f.nodes);
    for (const n of f.nodes) if (n.type !== "SnippetBlock") child(n);
  }
  function consts(nodes: Node[]) {
    for (const n of nodes)
      if (n.type === "ConstTag") {
        const d = n.declaration;
        out
          .raw("const ")
          .copy(d.declarations[0].start, d.declarations[0].end)
          .raw(";");
      }
  }

  // With a module script, a root snippet that reads nothing of the
  // instance's goes to the top level, where the module script can export it.
  const rootSnippets: Node[] = ast.fragment.nodes.filter(
    (n: Node) => n.type === "SnippetBlock",
  );
  const moduleSnippets = module ? hoistable(rootSnippets) : new Set<Node>();
  for (const n of rootSnippets) if (moduleSnippets.has(n)) snippet(n);
  out.raw(templateDoc);
  const async = topLevelAwait ? "async " : "";
  out.raw(
    runes
      ? `${async}function $$render${generics}() { `
      : `${async}function $$render${generics}() { let $$props = __sveltets_2_allPropsType(); let $$restProps = __sveltets_2_restPropsType(); let $$slots = __sveltets_2_any(0); ${typed.has("$$Slots") ? "const __sveltets_createSlot = __sveltets_2_createCreateSlot<$$Slots>(); " : ""}`,
  );
  for (const name of storeAtStart) declareStore(name);
  out.raw("\n");
  // The root's snippets, which the instance script can read.
  for (const n of rootSnippets) if (!moduleSnippets.has(n)) snippet(n);

  // --- Instance script, statement by statement.
  const props: {
    name: string;
    local: string;
    optional: boolean;
    /** Its type annotation, for checking `$$Props`. */
    type?: string;
  }[] = [];
  /** `[exported, local]` names of what the instance script exports. */
  const exportsOf: [string, string][] = [];
  /** In runes mode: the props object, typed as `$props()` is. */
  let runesProps: string | undefined;
  /** In runes mode: the props `$bindable()` marks. */
  const bindings: string[] = [];
  /** `let {…} = $props()` as svelte2tsx types it, `gap` the text before it. */
  const kitRoute = isKitRouteFile(basename);
  const kitLayout = kitRoute && basename.includes("layout");
  const kitError = isKitErrorFile(basename);
  const propsRune = (s: Node, d: Node, gapStart: number) => {
    const pattern = d.id;
    const locals: string[] = [];
    const inferred: string[] = [];
    let withUnknown = pattern.type !== "ObjectPattern";
    for (const p of pattern.type === "ObjectPattern"
      ? pattern.properties
      : []) {
      const value =
        p.value?.type === "AssignmentPattern" ? p.value.left : p.value;
      if (
        p.type === "RestElement" ||
        p.computed ||
        p.key.type !== "Identifier" ||
        value.type !== "Identifier"
      ) {
        withUnknown = true;
        continue;
      }
      const name = p.key.name;
      let init =
        p.value.type === "AssignmentPattern" ? p.value.right : undefined;
      const call = init?.type === "TSAsExpression" ? init.expression : init;
      const bindable =
        call?.type === "CallExpression" && call.callee.name === "$bindable";
      if (bindable) {
        bindings.push(name);
        locals.push(value.name);
        init = call.arguments[0];
      }
      if (kitRoute || kitError) {
        // svelte2tsx types only SvelteKit's props there, and drops the rest.
        const type = kitRuneProp(basename, name);
        if (type) inferred.push(`${name}: ${type}`);
      } else if (bindable && !init) inferred.push(`${name}?: any`);
      else
        inferred.push(
          init ? `${name}?: ${typeOfDefault(init, source)}` : `${name}: any`,
        );
    }
    if (kitLayout) inferred.push("children: import('svelte').Snippet");
    const propsStr =
      inferred.length > 0
        ? `{ ${inferred.join(", ")} }${withUnknown ? " & Record<string, any>" : ""}`
        : "Record<string, any>";
    // An identifier or `{}` names a type it never declares: any props.
    const declared =
      inferred.length > 0 || (withUnknown && pattern.type === "ObjectPattern");
    const annotation = pattern.typeAnnotation?.typeAnnotation;
    if (isTs && annotation) {
      if (annotation.type === "TSTypeReference") {
        runesProps = `{} as any as ${source.slice(annotation.start, annotation.end)}`;
        out.copy(s.start, s.end);
      } else {
        // A literal type gets a name, as svelte2tsx gives it.
        out
          .raw(";type $$ComponentProps = ")
          .copy(annotation.start, annotation.end);
        out.raw(";").copy(s.start, annotation.start).raw("$$ComponentProps");
        out.copy(annotation.end, s.end);
        runesProps = "{} as any as $$ComponentProps";
      }
    } else if (isTs) {
      if (declared) {
        out.raw(`;type $$ComponentProps = ${propsStr};`);
        out.copy(s.start, pattern.end).raw(": $$ComponentProps");
        out.copy(pattern.end, s.end);
      } else out.copy(s.start, s.end);
      runesProps = declared ? "{} as any as $$ComponentProps" : "{} as any";
    } else {
      // The last JSDoc `@type` right before it.
      const comment = [
        ...source.slice(gapStart, pattern.start).matchAll(JSDOC_BLOCK),
      ]
        .map((m) => m[0])
        .findLast((c) => JSDOC_TYPE.test(c));
      if (comment || !declared) out.copy(s.start, s.end);
      else {
        out.copy(s.start, pattern.start);
        out.raw(
          `/** @typedef {${propsStr}} $$ComponentProps *//** @type {$$ComponentProps} */`,
        );
        out.copy(pattern.start, s.end);
      }
      runesProps = `${comment ?? `/** @type {${declared ? "$$ComponentProps" : "any"}} */`}({})`;
    }
    // Reads each bindable prop, as svelte2tsx does.
    if (locals.length > 0) out.raw(`;${locals.map((l) => `${l};`).join("")}`);
  };

  /** Copies [from, to), leaving out `@template` blocks. */
  const copyGap = (from: number, to: number) => {
    let at = from;
    for (const [s, e] of templateBlocks) {
      if (e <= at || s >= to) continue;
      out.copy(at, s);
      at = e;
    }
    out.copy(at, to);
  };
  if (instance) {
    let cursor = instance.content.start;
    for (const s of body) {
      const gapStart = cursor;
      copyGap(cursor, s.start);
      cursor = s.end;
      if (s.type === "ImportDeclaration" || genericAliases.has(s)) continue;
      if (s.type === "ExportNamedDeclaration") {
        const d = s.declaration;
        if (d) {
          // A route's `data`, `form` and `snapshot` get SvelteKit's types.
          let at = d.start;
          if (d.type === "VariableDeclaration")
            for (const decl of d.declarations) {
              const type =
                decl.id.type === "Identifier" &&
                !decl.id.typeAnnotation &&
                (d.kind === "let" || decl.id.name === "snapshot")
                  ? kitPropType(basename, decl.id.name)
                  : undefined;
              const jsdoc =
                !isTs &&
                [
                  ...source
                    .slice(gapStart, decl.id.start)
                    .matchAll(JSDOC_BLOCK),
                ].some((m) => JSDOC_TYPE.test(m[0]));
              if (!type || jsdoc) continue;
              if (isTs) {
                out.copy(at, decl.id.end).raw(`: ${type}`);
                at = decl.id.end;
              } else {
                out.copy(at, decl.id.start).raw(`/** @type {${type}} */ `);
                at = decl.id.start;
              }
            }
          out.copy(at, d.end);
          if (d.type === "VariableDeclaration" && d.kind === "let")
            for (const decl of d.declarations) {
              // svelte2tsx widens a prop to `any` where a parent could pass
              // what its default doesn't allow: with no default, a type, or
              // a `true`/`false` default, which TypeScript narrows.
              const widens =
                decl.id.type === "Identifier" &&
                (!decl.init ||
                  decl.id.typeAnnotation ||
                  [
                    ...source
                      .slice(gapStart, decl.id.start)
                      .matchAll(JSDOC_BLOCK),
                  ].some((m) => JSDOC_TYPE.test(m[0])) ||
                  (decl.init.type === "Literal" &&
                    typeof decl.init.value === "boolean"));
              for (const name of idsOf(decl.id)) {
                props.push({
                  name,
                  local: name,
                  optional: decl.init != null,
                  type:
                    decl.id.type === "Identifier" &&
                    decl.id.typeAnnotation?.typeAnnotation
                      ? source.slice(
                          decl.id.typeAnnotation.typeAnnotation.start,
                          decl.id.typeAnnotation.typeAnnotation.end,
                        )
                      : undefined,
                });
                if (widens)
                  out.raw(
                    `;${name} = __sveltets_2_any(${decl.init ? name : 0});`,
                  );
              }
            }
          else
            for (const name of d.declarations
              ? d.declarations.flatMap((x: Node) => idsOf(x.id))
              : [d.id?.name])
              if (name) exportsOf.push([name, name]);
        } else
          for (const spec of s.specifiers) {
            const binding = scopes.instance.get(spec.local.name);
            if (runes) exportsOf.push([spec.exported.name, spec.local.name]);
            else if (binding?.kind === "let" || binding?.kind === "prop")
              props.push({
                name: spec.exported.name,
                local: spec.local.name,
                optional: true,
              });
          }
      } else if (s.type === "LabeledStatement" && s.label.name === "$") {
        reactive.push([s.start, s.end]);
        const e =
          s.body.type === "ExpressionStatement" ? s.body.expression : null;
        const declares =
          e?.type === "AssignmentExpression" &&
          e.operator === "=" &&
          idsOf(e.left).some((n) => {
            const b = scopes.instance.get(n);
            return b?.kind === "reactive" && b.declaration?.start === s.start;
          });
        if (declares) {
          out.raw("let ").copy(e.left.start, e.left.end);
          out
            .raw(" = __sveltets_2_invalidate(() => (")
            .copy(e.right.start, e.right.end)
            .raw("));");
        } else out.raw(";() => {").copy(s.start, s.end).raw("}");
      } else if (runes && propsDeclaratorOf(s)) {
        propsRune(s, propsDeclaratorOf(s), gapStart);
      } else {
        // `createEventDispatcher()` dispatches what `$$Events` declares.
        const call =
          typed.has("$$Events") && s.type === "VariableDeclaration"
            ? s.declarations
                .map((d: Node) => d.init)
                .find(
                  (init: Node) =>
                    init?.type === "CallExpression" &&
                    init.callee?.name === "createEventDispatcher" &&
                    !init.typeArguments &&
                    !init.typeParameters,
                )
            : undefined;
        if (call)
          out
            .copy(s.start, call.callee.end)
            .raw("<__sveltets_2_CustomEvents<$$Events>>")
            .copy(call.callee.end, s.end);
        else out.copy(s.start, s.end);
      }
      for (const name of storeAfter.get(s.end) ?? []) declareStore(name);
    }
    copyGap(cursor, instance.content.end);
  }

  out.raw("\nasync () => {\n");
  fragment(ast.fragment);
  out.raw("};\n");

  // --- What the component exposes. With `accessors`, props are exports too.
  const accessors = ast.options?.attributes?.some(
    (a: Node) => a.name === "accessors" && a.value !== false,
  );
  /** Whether a value reads a name the markup declares (`{#each}`, `let:`). */
  const markupScoped = (value: Node) => {
    let scoped = false;
    for (const part of Array.isArray(value) ? value : [value])
      if (part?.type === "ExpressionTag")
        walk(part.expression, {
          enter(node: Node, parent: Node) {
            if (node.type !== "Identifier" || !isReference(node, parent))
              return;
            const b = scopes.bindingOf(node);
            if (b && b.scope !== scopes.instance && b.scope !== scopes.module)
              scoped = true;
          },
        });
    return scoped;
  };
  /** An `{#each}` item's type, as svelte2tsx gives a slot prop that is one. */
  const eachItemOf = (value: Node): string | undefined => {
    const parts = Array.isArray(value) ? value : [value];
    const only = parts.length === 1 ? parts[0] : undefined;
    if (only?.type !== "ExpressionTag" || only.expression.type !== "Identifier")
      return;
    const b = scopes.bindingOf(only.expression);
    if (b?.kind === "each-index") return "0";
    const block = b?.declaration;
    if (
      b?.kind !== "each" ||
      block?.context?.type !== "Identifier" ||
      markupScoped({ type: "ExpressionTag", expression: block.expression })
    )
      return;
    return `__sveltets_2_unwrapArr(${source.slice(block.expression.start, block.expression.end)})`;
  };
  const entries = (pairs: [string, string][]) =>
    pairs.map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(", ");
  if (runes) {
    runesExport();
    return {
      out,
      isTs,
      lang,
      tsInJs,
      reactive,
      transitions,
      storeDeclarations,
      bindingChecks,
    };
  }
  // `$$Props` is the props' type, once it agrees with the `export let`s.
  const propsType = typed.has("$$Props")
    ? `{ ...__sveltets_2_ensureRightProps<{${props.map((p) => `${JSON.stringify(p.name)}${p.optional ? "?" : ""}: ${p.type ?? `typeof ${p.local}`}`).join(", ")}}>(__sveltets_2_any("") as $$Props) } as $$Props`
    : `{${entries(props.map((p) => [p.name, p.local]))}}`;
  out.raw(
    `return { props: ${propsType}, exports: {${entries([...(accessors ? props.map((p): [string, string] => [p.name, p.local]) : []), ...exportsOf])}}, bindings: "", slots: ${typed.has("$$Slots") ? "{} as unknown as $$Slots, __slots: {" : "{"}`,
  );
  // A slot's props, as `let:` reads them; `any` for a value the markup scopes.
  for (const [name, attributes] of slots) {
    out.raw(`${JSON.stringify(name)}: {`);
    for (const a of attributes)
      if (a.type === "Attribute" && a.name !== "name") {
        out.raw(`${JSON.stringify(a.name)}: `);
        const each = eachItemOf(a.value);
        if (each) out.raw(each);
        else if (markupScoped(a.value)) out.raw("__sveltets_2_any(0)");
        else attrValue(a.value);
        out.raw(", ");
      } else if (
        a.type === "SpreadAttribute" &&
        !markupScoped({ type: "ExpressionTag", expression: a.expression })
      )
        out.raw("...").copy(a.expression.start, a.expression.end).raw(", ");
    out.raw("}, ");
  }
  // `createEventDispatcher<Events>()` types the events it dispatches.
  const dispatcher = body
    .flatMap((s: Node) =>
      s.type === "VariableDeclaration" ? s.declarations : [],
    )
    .map((d: Node) => d.init)
    .find(
      (init: Node) =>
        init?.type === "CallExpression" &&
        init.callee?.name === "createEventDispatcher",
    );
  const typings = dispatcher
    ? source
        .slice(dispatcher.callee.end, dispatcher.end)
        .replace(CALL_PARENS, "")
    : "";
  const eventsType = typed.has("$$Events")
    ? "{} as unknown as $$Events"
    : `{${typings.startsWith("<") ? `...__sveltets_2_toEventTypings${typings}(), ` : ""}${entries([...forwarded])}}`;
  out.raw(`}, events: ${eventsType} };\n}\n`);
  const optional = props
    .filter((p) => p.optional)
    .map((p) => JSON.stringify(p.name));
  // `$$restProps` or `$$props` lets a parent pass any prop.
  const anyProp = USES_ALL_PROPS.test(source);
  // Undeclared events are any `CustomEvent`, unless they're strict.
  const renderCall = topLevelAwait ? "$$$render" : "$$render()";
  if (topLevelAwait) out.raw("const $$$render = await $$render();\n");
  const rendered = strictEvents
    ? renderCall
    : `__sveltets_2_with_any_event(${renderCall})`;
  // `$$Props` says which props are optional.
  const withProps = typed.has("$$Props")
    ? rendered
    : `__sveltets_2_partial${anyProp ? "_with_any" : ""}(${optional.length > 0 ? `[${optional.join(",")}], ` : ""}${rendered})`;
  const hasSlots = slots.size > 0 || typed.has("$$Slots");
  if (isTs && typeParams.length > 0 && svelte >= 4) {
    // A generic component's type takes the parameters a use infers.
    const names = typeParams.map((p) => p.match(GENERIC_PARAM)?.[1] ?? p);
    const args = `<${names.join(", ")}>`;
    // A function, since `$$` in a replacement string means `$`.
    const wrapped = withProps.replaceAll(renderCall, () =>
      topLevelAwait ? `(await $$render${args}())` : `$$render${args}()`,
    );
    const part = (name: string) =>
      `ReturnType<__sveltets_Render${args}["${name}"]>`;
    const children = hasSlots ? " & { children?: any }" : "";
    out.raw(
      `class __sveltets_Render${generics} { props() { return ${wrapped}.props; } events() { return ${wrapped}.events; } slots() { return ${wrapped}.slots; } bindings() { return ""; } exports() { return $$render${args}().exports; } }\n` +
        `interface $$IsomorphicComponent { new ${generics}(options: import("svelte").ComponentConstructorOptions<${part("props")}${children}>): import("svelte").SvelteComponent<${part("props")}, ${part("events")}, ${part("slots")}> & { $$bindings?: ${part("bindings")} } & ${part("exports")}; ${generics}(internal: unknown, props: ${part("props")} & { $$events?: ${part("events")}; $$slots?: ${part("slots")}${hasSlots ? "; children?: any" : ""} }): ${part("exports")}; z_$$bindings?: ReturnType<__sveltets_Render<${names.map(() => "any").join(", ")}>["bindings"]>; }\n` +
        `const $$Component: $$IsomorphicComponent = null as any;\ntype $$Component${generics} = InstanceType<typeof $$Component${args}>;\n`,
    );
  } else {
    out.raw(
      `const $$Component = ${svelte < 4 ? "__sveltets_2_svelte3_component" : `__sveltets_2_isomorphic_component${hasSlots ? "_slots" : ""}`}(${withProps});\n`,
    );
    if (isTs) out.raw("type $$Component = InstanceType<typeof $$Component>;\n");
    else
      out.raw(
        "/** @typedef {InstanceType<typeof $$Component>} $$Component */\n",
      );
  }
  out.raw("export default $$Component;\n");

  return {
    out,
    isTs,
    lang,
    tsInJs,
    reactive,
    transitions,
    storeDeclarations,
    bindingChecks,
  };

  /** A runes component: a function typed by `$props()`, as svelte2tsx types it. */
  function runesExport() {
    const exported = `{${entries(exportsOf)}}`;
    const bindable = `__sveltets_$$bindings(${bindings.length > 0 ? bindings.map((b) => JSON.stringify(b)).join(", ") : '""'})`;
    const none = isTs
      ? "{} as Record<string, never>"
      : "/** @type {Record<string, never>} */({})";
    out.raw(
      `return { props: ${runesProps ?? none}, exports: ${exported}, bindings: ${bindable}, slots: {}, events: {} };\n}\n`,
    );
    if (isTs && typeParams.length > 0) {
      const names = typeParams.map((p) => p.match(GENERIC_PARAM)?.[1] ?? p);
      const args = `<${names.join(", ")}>`;
      const part = (name: string) =>
        `ReturnType<__sveltets_Render${args}["${name}"]>`;
      const renderType = topLevelAwait
        ? `Awaited<ReturnType<typeof $$render${args}>>`
        : `ReturnType<typeof $$render${args}>`;
      const method = (name: string) =>
        `${name}(): ${renderType}["${name}"] { return null as any; }`;
      out.raw(
        `class __sveltets_Render${generics} { ${method("props")} ${method("events")} ${method("slots")} bindings() { return ${bindable}; } ${method("exports")} }\n` +
          `interface $$IsomorphicComponent { new ${generics}(options: import("svelte").ComponentConstructorOptions<${part("props")}>): import("svelte").SvelteComponent<${part("props")}, ${part("events")}, ${part("slots")}> & { $$bindings?: ${part("bindings")} } & ${part("exports")}; ${generics}(internal: unknown, props: ${part("props")} & {}): ${part("exports")}; z_$$bindings?: ReturnType<__sveltets_Render<${names.map(() => "any").join(", ")}>["bindings"]>; }\n` +
          `const $$Component: $$IsomorphicComponent = null as any;\ntype $$Component${generics} = InstanceType<typeof $$Component${args}>;\n`,
      );
    } else {
      out.raw(
        topLevelAwait
          ? "const $$$render = await $$render();\nconst $$Component = __sveltets_2_fn_component($$$render);\n"
          : "const $$Component = __sveltets_2_fn_component($$render());\n",
      );
      out.raw(
        isTs
          ? "type $$Component = ReturnType<typeof $$Component>;\n"
          : "/** @typedef {ReturnType<typeof $$Component>} $$Component */\n",
      );
    }
    out.raw("export default $$Component;\n");
  }
}
