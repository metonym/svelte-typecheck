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
  /** Commands that generate what the check reads, run from `dir` with the project's package manager. */
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
    setup: [["svelte-kit", "sync"]],
    mutate: "src",
  },
  {
    // Runes and TypeScript, in a pnpm monorepo.
    name: "bits-ui",
    repo: "huntabyte/bits-ui",
    commit: "d093bd0edcc0ef555b408e86a4948a8434b1b03f",
    dir: "packages/bits-ui",
    args: ["--tsconfig", "./tsconfig.json"],
    setup: [["svelte-kit", "sync"]],
    mutate: "src",
    known: [
      {
        pass: "with errors planted",
        only: "svelte-check",
        line: 'ERROR "src/lib/bits/button/components/button.svelte" 19:34 "Property \'__nope\' does not exist on type \'\\"button\\" | \\"reset\\" | \\"submit\\"\'.\\n  Property \'__nope\' does not exist on type \'\\"button\\"\'."',
        why: "A union's members in another order: docs/svelte-check.md.",
      },
      {
        pass: "with errors planted",
        only: "svelte-typecheck",
        line: 'ERROR "src/lib/bits/button/components/button.svelte" 19:34 "Property \'__nope\' does not exist on type \'\\"button\\" | \\"submit\\" | \\"reset\\"\'.\\n  Property \'__nope\' does not exist on type \'\\"button\\"\'."',
        why: "A union's members in another order: docs/svelte-check.md.",
      },
    ],
  },
  {
    // 1,276 JS components with JSDoc, and no `allowJs`: each is untyped to
    // its importers, which its type tests read. It checks with
    // svelte-typecheck, so svelte-check is added for the comparison.
    // Without `checkJs`, errors planted in its components show nothing,
    // so it has no second pass.
    name: "carbon",
    repo: "carbon-design-system/carbon-components-svelte",
    commit: "c0467ed3bd762dffa6bba1722197e10f61df05da",
    args: ["--tsconfig", "tsconfig.json"],
    pending:
      "both tools report about 2,960 errors at this commit, and 33 and 43 of their lines differ: union order, and names imported from its untyped components, such as `ComboBoxItem`, which svelte-check prints by name and svelte-typecheck as `any`",
  },
];
