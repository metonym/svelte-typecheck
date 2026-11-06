import { defineConfig } from "bivium";

// The test projects: each a folder with its own package.json, whose
// dependencies a test sees as a user's project would.
const fixtures = "tests/projects/svelte5/{package.json,basic/**}";

export default defineConfig({
  suites: {
    unit: {
      tests: "tests/*.test.ts",
      run: "bun test {files}",
      root: "tests",
      // `bun test` runs the code: an `import type` or a declaration file
      // can't change what a test does.
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
  ],
  // Inputs that aren't imports: the CLI a test runs as a user would, the
  // fixtures it checks or copies to a temp workspace. A key that names one
  // file vouches for all its disk reads, so a new test names its own.
  edges: {
    "tests/baseline.test.ts": "src/cli.ts",
    "tests/compile-cache.test.ts": "src/cli.ts",
    "tests/daemon.test.ts": "src/cli.ts",
    // The compiler's pass runs this on a worker thread.
    "src/compiler.ts": "src/compile-worker.ts",
    "tests/parity.test.ts": "src/cli.ts",
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
    "tests/compile-cache.test.ts": [
      "tests/projects/svelte5/package.json",
      "tests/projects/svelte5/basic/Warnings.svelte",
      "tests/projects/svelte5/basic/tsconfig.json",
    ],
    // The samples in How it works, generated again and compared.
    "tests/docs.test.ts": "docs/architecture.md",
    "tests/compiler.test.ts": [
      "tests/projects/svelte5/package.json",
      "tests/projects/preprocess/**",
      "tests/projects/kit/{package.json,vite.config.ts}",
    ],
    "tests/parity.test.ts": "tests/projects/**",
    "tests/typecheck.test.ts": [
      fixtures,
      "tests/projects/{preprocess/**,svelte3/package.json,svelte4/package.json}",
    ],
    // Generated projects in the Svelte 5 project's `.tmp/`.
    "tests/scale.test.ts": "tests/projects/svelte5/package.json",
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
