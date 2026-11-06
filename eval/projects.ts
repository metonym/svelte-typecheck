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
];
