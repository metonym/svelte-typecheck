import { parseModule } from "sveast";

// eslint-disable-next-line typescript/no-explicit-any -- sveast's TypeScript nodes
type AnyNode = any;

/** Syntax that has a runtime meaning, so it can't be blanked to JavaScript. */
const UNSUPPORTED = new Set([
  "TSEnumDeclaration",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "Decorator",
]);

/** Whole statements and members that are only types. */
const TYPE_ONLY = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSIndexSignature",
]);

/** Fields that hold only types, blanked as they are. */
const TYPE_FIELDS = [
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
  "superTypeParameters",
];

const MODIFIERS =
  /\b(?:public|private|protected|readonly|override|abstract|declare)\b/g;

/**
 * A `.svelte.ts` module as JavaScript, with each piece of TypeScript
 * syntax replaced by spaces, so every position in it is the source's.
 * Svelte's `compileModule` parses only JavaScript. Undefined for syntax
 * that has a runtime meaning (an `enum`, a parameter property), or for
 * a module that isn't JavaScript once blanked.
 */
export function blankTypes(source: string): string | undefined {
  let program: AnyNode;
  try {
    program = parseModule(source, { typescript: true, comments: false });
  } catch {
    return;
  }
  const out = source.split("");
  const blank = (start: number, end: number) => {
    for (let i = start; i < end; i++)
      if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
  };
  /** Blanks `char`, the first one at or after `from` past whitespace. */
  const blankNext = (from: number, char: string) => {
    let i = from;
    while (i < source.length && /\s/.test(source[i] ?? "")) i++;
    if (source[i] === char) blank(i, i + 1);
  };
  const blankWords = (start: number, end: number, words: RegExp) => {
    for (const m of source.slice(start, end).matchAll(words))
      blank(start + m.index, start + m.index + m[0].length);
  };
  let supported = true;

  const visit = (node: AnyNode, parent?: AnyNode) => {
    if (!supported || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent);
      return;
    }
    if (typeof node.type !== "string") return;
    const type: string = node.type;
    if (
      UNSUPPORTED.has(type) ||
      (type === "TSModuleDeclaration" && !node.declare && !typesOnly(node))
    ) {
      supported = false;
      return;
    }
    // A statement or member that's only a type, with its `export`.
    if (
      TYPE_ONLY.has(type) ||
      type === "TSModuleDeclaration" ||
      node.declare === true ||
      (type === "MethodDefinition" && node.value?.type === "TSDeclareMethod") ||
      (type === "PropertyDefinition" && node.abstract) ||
      node.importKind === "type" ||
      node.exportKind === "type"
    ) {
      if (type === "ImportSpecifier" || type === "ExportSpecifier") {
        blank(node.start, node.end);
        blankNext(node.end, ",");
      } else if (parent?.type === "ExportNamedDeclaration") {
        blank(parent.start, parent.end);
      } else blank(node.start, node.end);
      return;
    }
    switch (type) {
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSInstantiationExpression":
        blank(node.expression.end, node.end);
        visit(node.expression, node);
        return;
      case "TSTypeAssertion":
        blank(node.start, node.expression.start);
        visit(node.expression, node);
        return;
      case "Identifier":
        // `a?: T`, `a!: T`, and `this: T`, which the caller blanks.
        if (node.typeAnnotation || node.optional)
          blank(node.start + node.name.length, node.end);
        return;
      case "ObjectPattern":
      case "ArrayPattern":
        if (node.optional)
          blankBefore(node.typeAnnotation?.start ?? node.end, "?");
        break;
      case "PropertyDefinition":
      case "MethodDefinition":
        blankWords(node.start, node.key.start, MODIFIERS);
        if (node.optional || node.definite)
          blankNext(
            node.key.end + (node.computed ? 1 : 0),
            node.optional ? "?" : "!",
          );
        break;
      case "ClassDeclaration":
      case "ClassExpression": {
        if (node.abstract)
          blankWords(node.start, node.body.start, /\babstract\b/g);
        const implemented = node.implements;
        if (implemented?.length) {
          const from = source.lastIndexOf("implements", implemented[0].start);
          blank(from, implemented[implemented.length - 1].end);
        }
        break;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const [first, second] = node.params ?? [];
        if (first?.type === "Identifier" && first.name === "this") {
          blank(first.start, second ? second.start : first.end);
          if (!second) blankNext(first.end, ",");
        }
        break;
      }
    }
    for (const field of TYPE_FIELDS)
      if (node[field]?.start !== undefined)
        blank(node[field].start, node[field].end);
    for (const [key, value] of Object.entries(node))
      if (key !== "loc" && !TYPE_FIELDS.includes(key)) visit(value, node);
  };
  /** Blanks the last `char` before `end`, past whitespace. */
  const blankBefore = (end: number, char: string) => {
    let i = end - 1;
    while (i > 0 && /\s/.test(source[i] ?? "")) i--;
    if (source[i] === char) blank(i, i + 1);
  };

  visit(program.body);
  if (!supported) return;
  const code = out.join("");
  try {
    parseModule(code, { comments: false });
  } catch {
    return;
  }
  return code;
}

/** Whether a `namespace` holds only types, which TypeScript erases. */
function typesOnly(node: AnyNode): boolean {
  const body = node.body;
  if (!body) return true;
  if (body.type === "TSModuleDeclaration") return typesOnly(body);
  return (body.body ?? []).every(
    (s: AnyNode) =>
      TYPE_ONLY.has(s.type) ||
      s.declare === true ||
      (s.type === "TSModuleDeclaration" && typesOnly(s)) ||
      (s.type === "ExportNamedDeclaration" &&
        s.declaration &&
        (TYPE_ONLY.has(s.declaration.type) ||
          (s.declaration.type === "TSModuleDeclaration" &&
            typesOnly(s.declaration)))),
  );
}
