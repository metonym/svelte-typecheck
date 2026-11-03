import { readdirSync } from "node:fs";
import { join } from "node:path";

// From bivium (MIT): https://github.com/metonym/bivium/blob/master/src/glob.ts
const GLOB_LITERAL = /[.+^$()|[\]\\]/g;
const LEADING_DOT_SLASH = /^\.\//;

/** Compiles a relative glob (`**`, `*`, `?`, `{a,b}`) to a RegExp. */
function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] ?? "";
    if (char === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "{") source += "(?:";
    else if (char === "}") source += ")";
    else if (char === ",") source += "|";
    else source += char.replace(GLOB_LITERAL, String.raw`\$&`);
  }
  return new RegExp(`^${source}$`);
}

/** One test for a list of globs; an empty list matches nothing. */
export function matcher(globs: readonly string[]): (path: string) => boolean {
  if (globs.length === 0) return () => false;
  const res = globs.map((pattern) =>
    globToRegExp(pattern.replace(LEADING_DOT_SLASH, "")),
  );
  return (path) => res.some((re) => re.test(path));
}

/**
 * The files under `root` that match `globs`, as `/`-separated relative
 * paths. `node_modules` is never entered, and a dot folder only when a
 * glob names it (`.cache/**`).
 */
export function glob(root: string, globs: readonly string[]): string[] {
  const matches = matcher(globs);
  const dotFolders = globs.some((g) => g.startsWith(".") || g.includes("/."));
  const found: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        if (entry.name.startsWith(".") && !dotFolders) continue;
        walk(join(dir, entry.name), `${rel}/`);
      } else if (matches(rel)) found.push(rel);
    }
  };
  walk(root, "");
  return found.sort();
}
