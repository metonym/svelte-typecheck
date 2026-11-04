// Plants type errors in every component under a folder, for checking
// svelte-typecheck against svelte-check on a real project with errors in
// it: `.__nope` after up to 3 of each component's markup expressions, and
// a bad assignment at the end of its instance script (a JSDoc one in JS).
// Undo it with git.
//
//   bun eval/mutate.ts <dir>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, walk } from "sveast";

const TS_LANG = /\blang=["']?ts\b/;
const dir = process.argv[2];
if (!dir) throw new Error("usage: bun eval/mutate.ts <dir>");

let count = 0;
for (const rel of new Bun.Glob("**/*.svelte").scanSync({ cwd: dir })) {
  if (rel.includes("node_modules")) continue;
  const path = join(dir, rel);
  const source = readFileSync(path, "utf-8");
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, { css: false });
  } catch {
    continue;
  }
  const spots: [number, number][] = [];
  walk(ast.fragment, {
    enter(node, parent) {
      if (
        node.type === "ExpressionTag" &&
        parent?.type !== "BindDirective" &&
        node.expression.type !== "Literal"
      )
        spots.push([node.expression.start, node.expression.end]);
    },
  });
  const picked =
    spots.length <= 3
      ? spots
      : [spots[0], spots[Math.floor(spots.length / 2)], spots.at(-1)];
  const inserts: [number, string][] = [];
  for (const spot of picked) {
    if (!spot) continue;
    inserts.push([spot[0], "("], [spot[1], ").__nope"]);
  }
  const script = ast.instance;
  if (script) {
    const ts = TS_LANG.test(source.slice(script.start, script.content.start));
    inserts.push([
      script.content.end,
      ts
        ? `\nconst __planted${count}: number = "planted";\n`
        : `\n/** @type {number} */\nconst __planted${count} = "planted";\n`,
    ]);
  }
  inserts.sort((a, b) => b[0] - a[0]);
  let out = source;
  for (const [at, text] of inserts)
    out = out.slice(0, at) + text + out.slice(at);
  writeFileSync(path, out);
  count++;
}
console.log(`planted errors in ${count} components`);
