import { defineConfig } from "bivium";

const fixtures = "tests/fixtures/**";

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
  roots: ["src", "tests", "scripts", "package.json", "tsconfig.json"],
  // Docs, the benchmark and eval, and config for tools and workflows that
  // run none of these suites.
  ignore: [
    "**/*.md",
    "LICENSE",
    ".gitignore",
    "knip.json",
    "bench/**",
    "eval/**",
    "ostia.config.ts",
    ".github/workflows/release.yml",
  ],
  // Inputs that aren't imports: the CLI a test runs as a user would, the
  // fixtures it checks or copies to a temp workspace. A key that names one
  // file vouches for all its disk reads, so a new test names its own.
  edges: {
    "tests/baseline.test.ts": "src/cli.ts",
    "tests/compile-cache.test.ts": "src/cli.ts",
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
    "tests/checker.test.ts": fixtures,
    "tests/compile-cache.test.ts": [
      "tests/fixtures/Warnings.svelte",
      "tests/fixtures/tsconfig.json",
    ],
    "tests/compiler.test.ts": [
      "tests/fixtures-preprocess/**",
      "tests/fixtures-kit/vite.config.ts",
    ],
    "tests/parity.test.ts": [fixtures, "tests/fixtures-*/**"],
    "tests/typecheck.test.ts": [fixtures, "tests/fixtures-preprocess/**"],
    "tests/watch.test.ts": fixtures,
    "scripts/test-package.ts": fixtures,
  },
  // Tools CI runs on its own: a bump that only reaches them selects nothing.
  inert: ["knip", "ostia"],
  // svelte-typecheck reads its user's project; the glob test, only the temp
  // directory it writes.
  hermetic: ["src/**", "tests/glob.test.ts"],
});
