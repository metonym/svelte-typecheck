import { readFileSync } from "node:fs";

// A string first, since one can hold `//`.
const STRING_OR_COMMENT =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*|\/\*[\s\S]*?\*\//g;
// `/// <reference>` and `// @ts-nocheck` mean something, so they stay.
const DIRECTIVE = /^\/\/(?:\/|\s*@ts-)/;

// A macro, so the bundle carries each shim inline and the package ships
// no .d.ts beside its own; the checker needs no comments or indentation.
export function shimText(file: string): string {
  return readFileSync(new URL(`./shims/${file}`, import.meta.url), "utf-8")
    .replace(STRING_OR_COMMENT, (token) =>
      token.startsWith("/") && !DIRECTIVE.test(token) ? "" : token,
    )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
