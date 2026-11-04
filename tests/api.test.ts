import { expect, test } from "bun:test";
import * as implemented from "../src/index.ts";
import type * as declared from "../src/types.ts";

type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// A type error here: an implementation's signature no longer matches what
// src/types.ts, the package's index.d.ts, declares.
const signatures: {
  [K in keyof typeof declared]: Same<
    (typeof implemented)[K],
    (typeof declared)[K]
  >;
} = {
  typecheck: true,
  watch: true,
  compilerDiagnostics: true,
  createBaseline: true,
  applyBaseline: true,
};

test("the package exports the functions index.d.ts declares, and only those", () => {
  expect(Object.keys(implemented).sort()).toEqual(
    Object.keys(signatures).sort(),
  );
});
