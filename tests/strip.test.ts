import { blankTypes } from "../src/strip.ts";

describe("blankTypes", () => {
  it("blanks TypeScript syntax and keeps every position", () => {
    const source = [
      'import { type A, b } from "./x";',
      'import type { C } from "./y";',
      "interface I { n: number }",
      "export type F = 1;",
      "declare const w: number;",
      "let count = $state<number>(0);",
      "let z!: number;",
      "const a = count as number;",
      "const s = { n: 1 } satisfies I;",
      "const t = <number>z!;",
      "function f<T>(this: Window, a?: T): T | undefined { return a; }",
      "function o(a: string): void;",
      "function o(a: any) {}",
      "abstract class K<T> implements I {",
      "  private readonly n = 1;",
      "  static q?: number;",
      "  declare d: string;",
      "  abstract m(): void;",
      "  opt?(): void {}",
      "}",
    ].join("\n");
    const code = blankTypes(source) ?? "";
    expect(code).toHaveLength(source.length);
    expect(code.split("\n").map((line) => line.trimEnd())).toEqual([
      'import {         b } from "./x";',
      "",
      "",
      "",
      "",
      "let count = $state        (0);",
      "let z         ;",
      "const a = count          ;",
      "const s = { n: 1 }            ;",
      "const t =         z ;",
      "function f   (              a    )                { return a; }",
      "",
      "function o(a     ) {}",
      "         class K                 {",
      "                   n = 1;",
      "  static q         ;",
      "",
      "",
      "  opt ()       {}",
      "}",
    ]);
  });

  it.each([
    ["an enum", "enum E { A }"],
    ["a parameter property", "class P { constructor(private a: number) {} }"],
    ["a namespace with values", "namespace N { export const a = 1; }"],
    ["code that doesn't parse", "let a: = 1;"],
  ])("gives up on %s", (_, source) => {
    expect(blankTypes(source)).toBeUndefined();
  });
});
