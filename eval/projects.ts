/**
 * Real projects `eval/parity.ts` checks with svelte-check and
 * svelte-typecheck, each at a pinned commit, as it is and with errors
 * planted. Each found bugs the fixtures didn't.
 */
export interface Project {
  name: string;
  /** `owner/repo` on GitHub. */
  repo: string;
  /** The full commit hash it's checked at. */
  commit: string;
  /** The folder both tools run from, in the repo. Default the root. */
  dir?: string;
  /** Options for both tools. */
  args?: string[];
  /** Files written in `dir` before the check, such as a config that turns `checkJs` on. */
  files?: Record<string, string>;
  /**
   * Commands that generate what the check reads, run from `dir` by the
   * project's package manager: `["exec", "svelte-kit", "sync"]`.
   */
  setup?: string[][];
  /** The folder, in `dir`, whose components get planted errors; none, no second pass. */
  mutate?: string;
  /**
   * Why it's left out of a run that names no project, until that's fixed.
   * A run that names it checks it.
   */
  pending?: string;
  /**
   * Lines only one tool prints, kept on purpose: each says why, and is
   * in docs/svelte-check.md. A known line that stops differing fails the
   * run too, so the list stays true.
   */
  known?: {
    /** The pass it's printed in; default both. */
    pass?: "as it is" | "with errors planted";
    only: "svelte-check" | "svelte-typecheck";
    line: string;
    why: string;
  }[];
  /**
   * Errors svelte-typecheck finds in generated code that maps to no
   * source, and doesn't print, as `File.svelte.ts: message`: each says
   * why svelte-check hides it too. Any other fails the run, and so does
   * one of these that's no longer found.
   */
  dropped?: {
    pass?: "as it is" | "with errors planted";
    line: string;
    why: string;
  }[];
}

export const PROJECTS: Project[] = [
  {
    // SvelteKit 2, JS with `checkJs`. Its latest commit's lockfile
    // doesn't parse, so this is the one before.
    name: "realworld",
    repo: "sveltejs/realworld",
    commit: "ce36ca4f4c2484781514393de06d12502c4afd71",
    // Its jsconfig only extends SvelteKit's, which checks no JS.
    files: {
      "jsconfig.json": JSON.stringify({
        extends: "./.svelte-kit/tsconfig.json",
        compilerOptions: { checkJs: true },
      }),
    },
    setup: [["exec", "svelte-kit", "sync"]],
    mutate: "src",
  },
  {
    // Runes and TypeScript, in a pnpm monorepo.
    name: "bits-ui",
    repo: "huntabyte/bits-ui",
    commit: "d093bd0edcc0ef555b408e86a4948a8434b1b03f",
    dir: "packages/bits-ui",
    args: ["--tsconfig", "./tsconfig.json"],
    dropped: [
      ...["button/components/button", "calendar/components/calendar"].map(
        (c) => ({
          line: `src/lib/bits/${c}.svelte: Expression produces a union type that is too complex to represent.`,
          why: "The props' type spreads a `<svelte:element>`'s attributes for any tag; svelte-check reports nothing on it either.",
        }),
      ),
    ],
    setup: [["exec", "svelte-kit", "sync"]],
    mutate: "src",
  },
  {
    // 1,276 JS components with JSDoc, typed by the `.svelte.d.ts` files
    // sveld generates, which aren't committed. As its CI checks it: types
    // generated, then its type tests. It checks with svelte-typecheck, so
    // svelte-check is added for the comparison. Its components have no
    // `checkJs`, so errors are planted in its tests' components.
    name: "carbon",
    repo: "carbon-design-system/carbon-components-svelte",
    commit: "052a207bc4a7ec0aa393b461aa517dfa30588844",
    args: ["--workspace", "tests"],
    setup: [["run", "build:docs", "--no-strict"]],
    mutate: "tests",
  },
  {
    // sveld's parser fixtures: 288 components of unusual syntax, written to
    // test a parser, from `generics` with `const` to `$$Generic` and TS-only
    // syntax. Most don't type-check, so both tools print a lot to compare.
    name: "sveld",
    repo: "carbon-design-system/sveld",
    commit: "0c1b6745e55ab1f3043b828ee3898f3520e0ee39",
    args: ["--workspace", "tests/fixtures"],
    // It's on TypeScript 7, which svelte-check runs only with `--tsgo`
    // and TypeScript 6 beside it: both tools check with TypeScript 6.
    setup: [["add", "-D", "typescript@~6"]],
    known: [
      {
        only: "svelte-check",
        line: 'WARNING "ts-local-enum-prop/input.svelte" 14:14 "Component has unused export property \'density\'. If it is for external reference only, please consider using `export const density`\\nhttps://svelte.dev/e/export_let_unused"',
        why: "The compiler stops at the enum here, so its warnings for the file are lost.",
      },
      {
        only: "svelte-check",
        line: "COMPLETED 23 ERRORS 196 WARNINGS 93 FILES_WITH_PROBLEMS",
        why: "The counts, from the lines above.",
      },
      {
        only: "svelte-typecheck",
        line: 'ERROR "module-class/input.svelte" 28:7 "TypeScript language features like accessibility modifiers on constructor parameters are not natively supported, and their use is generally discouraged. Outside of `<script>` tags, these features are not supported. For use within `<script>` tags, you will need to use a preprocessor to convert it to JavaScript before it gets passed to the Svelte compiler. If you are using `vitePreprocess`, make sure to specifically enable preprocessing script tags (`vitePreprocess({ script: true })`)\\nhttps://svelte.dev/e/typescript_invalid_feature"',
        why: "TS-only syntax in a Svelte 5 script with no preprocessor: svelte-check strips the types first, so the compiler never sees it.",
      },
      {
        only: "svelte-typecheck",
        line: 'ERROR "ts-local-enum-prop/input.svelte" 2:3 "TypeScript language features like enums are not natively supported, and their use is generally discouraged. Outside of `<script>` tags, these features are not supported. For use within `<script>` tags, you will need to use a preprocessor to convert it to JavaScript before it gets passed to the Svelte compiler. If you are using `vitePreprocess`, make sure to specifically enable preprocessing script tags (`vitePreprocess({ script: true })`)\\nhttps://svelte.dev/e/typescript_invalid_feature"',
        why: "TS-only syntax in a Svelte 5 script with no preprocessor: svelte-check strips the types first, so the compiler never sees it.",
      },
      {
        only: "svelte-typecheck",
        line: "COMPLETED 25 ERRORS 195 WARNINGS 93 FILES_WITH_PROBLEMS",
        why: "The counts, from the lines above.",
      },
    ],
    dropped: [
      {
        line: "tests/fixtures/runes-script-generics-attribute-const/input.svelte: 'const' modifier can only appear on a type parameter of a function, method or class",
        why: "svelte2tsx keeps `const` on the `$$Component` type alias it declares too.",
      },
    ],
  },
];
