import { defineConfig } from "bivium";

// The test projects: each a folder with its own package.json, whose
// dependencies a test sees as a user's project would.
const fixtures = "tests/projects/svelte5/{package.json,basic/**}";
/** Folders of the Svelte 5 project, with its package.json. */
const svelte5Projects = (...folders: string[]) =>
  `tests/projects/svelte5/{package.json,${folders.map((f) => `${f}/**`).join(",")}}`;

export default defineConfig({
  suites: {
    unit: {
      tests: "tests/*.test.ts",
      // Files at once, one process each; a slow machine still finishes a
      // test that spawns svelte-check.
      run: "bun test --parallel --timeout 30000 {files}",
      root: "tests",
      // `bun test` runs the code: an `import type` or a declaration file
      // can't change what a test does.
      types: false,
      // The timing suite's files, which no unit test runs.
      nonInputs: ["tests/timing/**", "tests/generate.ts"],
    },
    // Tests that time a run: they run alone, after the unit tests, so other
    // files' work doesn't count against them.
    timing: {
      tests: "tests/timing/*.test.ts",
      run: "bun test --timeout 30000 {files}",
      root: "tests/timing",
      types: false,
    },
    package: {
      tests: "scripts/test-package.ts",
      root: "scripts/test-package.ts",
    },
  },
  // `docs`, as a test reads How it works.
  roots: ["src", "tests", "scripts", "docs", "package.json", "tsconfig.json"],
  // The README, CHANGELOG and CONTRIBUTING, the benchmark and eval, and
  // config for tools and workflows that run none of these suites.
  ignore: [
    "*.md",
    "LICENSE",
    ".gitignore",
    "knip.json",
    "bench/**",
    "eval/**",
    "ostia.config.ts",
    ".github/workflows/release.yml",
    ".github/workflows/parity.yml",
    ".githooks/**",
  ],
  // Inputs that aren't imports: the CLI a test runs as a user would, the
  // fixtures it checks or copies to a temp workspace. A key that names one
  // file vouches for all its disk reads, so a new test names its own.
  edges: {
    "tests/agent.test.ts": "src/cli.ts",
    "tests/baseline.test.ts": "src/cli.ts",
    "tests/compile-cache.test.ts": "src/cli.ts",
    "tests/daemon.test.ts": "src/cli.ts",
    // The compiler's pass runs this on a worker thread.
    "src/compiler.ts": "src/compile-worker.ts",
    // The parity tests run the CLI through it.
    "tests/parity.ts": "src/cli.ts",
    // Builds and packs the package, then checks the fixtures with it.
    "scripts/test-package.ts": "scripts/build.ts",
    "scripts/build.ts": [
      "src/{index,cli,compile-worker}.ts",
      "src/types.ts",
      "src/shims/**",
      "package.json",
    ],
  },
  reads: {
    "src/shims.ts": "src/shims/**",
    "tests/baseline.test.ts": fixtures,
    "tests/changed.test.ts": fixtures,
    "tests/daemon.test.ts": fixtures,
    "tests/checker.test.ts": [fixtures, "tests/projects/ts7/**"],
    "tests/agent.test.ts": [
      "tests/projects/svelte5/package.json",
      "tests/projects/svelte5/basic/tsconfig.json",
    ],
    "tests/compile-cache.test.ts": [
      "tests/projects/svelte5/package.json",
      "tests/projects/svelte5/basic/Warnings.svelte",
      "tests/projects/svelte5/basic/tsconfig.json",
    ],
    "tests/scripts.test.ts": "package.json",
    // The samples in How it works, generated again and compared.
    "tests/docs.test.ts": "docs/architecture.md",
    "tests/compiler.test.ts": [
      "tests/projects/svelte5/package.json",
      "tests/projects/preprocess/**",
      "tests/projects/kit/{package.json,vite.config.ts}",
    ],
    // Each parity file checks its own projects, with the Svelte 5
    // project's svelte-check.
    "tests/parity.test.ts": fixtures,
    "tests/parity-components.test.ts": svelte5Projects(
      "typed",
      "missing",
      "generic",
      "generic-js",
      "generic-js-legacy",
      "generic-invalid",
      "typedef-js",
      "bind-shorthand",
      "runes",
      "edge",
      "on-directive",
      "repeated-on-directive",
      "helpers",
      "css-props",
    ),
    "tests/parity-tsconfig.test.ts": svelte5Projects(
      "deprecated",
      "old-module",
      "config-dir",
      "checkjs",
      "untyped",
      "filters",
      "ts-comments",
    ),
    "tests/parity-packages.test.ts": [
      "tests/projects/svelte5/package.json",
      "tests/projects/kit/**",
    ],
    "tests/parity-no-inputs.test.ts": "tests/projects/svelte5/package.json",
    "tests/parity-legacy.test.ts": [
      "tests/projects/svelte5/package.json",
      "tests/projects/{svelte3,svelte4,preprocess}/**",
    ],
    "tests/dropped.test.ts": "tests/projects/**",
    "tests/typecheck.test.ts": [
      fixtures,
      "tests/projects/svelte5/modules/**",
      "tests/projects/{preprocess/**,svelte3/package.json,svelte4/package.json}",
    ],
    // Generated projects in the Svelte 5 project's `.tmp/`.
    "tests/timing/scale.test.ts": "tests/projects/svelte5/package.json",
    "tests/watch.test.ts": fixtures,
    "scripts/test-package.ts": fixtures,
  },
  // The shims' types import the user's Svelte, which the root doesn't
  // install: the test projects do.
  external: ["svelte"],
  // Tools CI runs on its own: a bump that only reaches them selects nothing.
  inert: ["knip", "ostia"],
  // svelte-typecheck reads its user's project; the glob test and the
  // project generator, only the temp directories they write.
  hermetic: ["src/**", "tests/glob.test.ts", "tests/generate.ts"],
});
