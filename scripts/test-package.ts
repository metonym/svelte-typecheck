import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { parseImportsExports } from "sveast";
import { lexDynamicImports } from "sveast/lexer";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");
const dir = mkdtempSync(join(tmpdir(), "svelte-typecheck-package-"));
const ALLOWED = /^(node:|\.\/|svelte\/compiler$)/;
const MACHINE_ERROR = /^\d+ ERROR "(.+)" (\d+:\d+) /gm;

const WINDOWS = process.platform === "win32";

function run(command: string, args: string[], cwd: string) {
  // npm and npx are `.cmd` shims on Windows, which run only through the shell.
  return spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    shell: WINDOWS && (command === "npm" || command === "npx"),
  });
}

function ok(command: string, args: string[], cwd: string): string {
  const result = run(command, args, cwd);
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`,
    );
  return result.stdout;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function write(at: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, name)), { recursive: true });
    writeFileSync(join(at, name), text);
  }
}

try {
  ok("bun", ["run", "build"], root);

  // The bundle imports Node builtins, its own chunks and Svelte's compiler
  // (the project's): no dependencies, and nothing Bun-only.
  for (const file of await readdir(dist)) {
    if (!file.endsWith(".js")) continue;
    const code = readFileSync(join(dist, file), "utf-8");
    const specifiers = [
      ...parseImportsExports(code).flatMap((node) =>
        "source" in node && node.source ? [String(node.source.value)] : [],
      ),
      ...lexDynamicImports(code)
        .filter((d) => d.kind === "import" && d.source !== null)
        .map((d) => d.source?.value ?? ""),
    ];
    // Two computed import()s: the project's svelte.config, and its own Vite
    // for a vite.config.
    const computed = lexDynamicImports(code).filter(
      (d) => d.kind === "import" && d.source === null,
    );
    assert(
      computed.length <= 2,
      `dist/${file} has ${computed.length} computed import()s`,
    );
    for (const specifier of specifiers)
      assert(ALLOWED.test(specifier), `dist/${file} imports ${specifier}`);
  }
  const manifest = JSON.parse(
    readFileSync(join(dist, "package.json"), "utf-8"),
  );
  assert(
    manifest.dependencies === undefined,
    "dist/package.json has dependencies",
  );

  // npm publish drops a field it has to correct, such as a `bin` path
  // with `./`, after only a warning.
  const publish = run("npm", ["publish", "--dry-run"], dist);
  assert(
    !publish.stderr.includes("npm warn publish"),
    `npm publish would correct dist/package.json:\n${publish.stderr}`,
  );

  const tarball = ok(
    "npm",
    ["pack", "--pack-destination", dir, "--silent"],
    dist,
  ).trim();

  // A project with the fixtures, svelte and TypeScript 6 for `tsc`. Its
  // `check` script is one `bun check` would run in its place.
  const project = join(dir, "project");
  cpSync(join(root, "tests/projects/svelte5/basic"), project, {
    recursive: true,
  });
  write(project, {
    "package.json": JSON.stringify({
      name: "project",
      private: true,
      type: "module",
      scripts: {
        check: "echo the check script ran",
        "typecheck:tsc":
          "svelte-typecheck --checker tsc --output machine --no-incremental",
        "typecheck:bun":
          "svelte-typecheck --checker bun --output machine --no-incremental",
      },
    }),
  });
  ok(
    "npm",
    [
      "install",
      join(dir, tarball),
      "svelte@5",
      "typescript@6",
      "--no-audit",
      "--no-fund",
      "--silent",
    ],
    project,
  );

  // Windows links a bin as `.cmd` and shell shims; the package's own runs anywhere.
  const bin = WINDOWS
    ? join(project, "node_modules/svelte-typecheck/cli.js")
    : join(project, "node_modules/.bin/svelte-typecheck");
  for (const runtime of ["node", "bun"]) {
    const result = run(
      runtime,
      [bin, "--checker", "tsc", "--output", "machine"],
      project,
    );
    const errors = [...result.stdout.matchAll(MACHINE_ERROR)];
    assert(
      result.status === 1 && errors.length === 12,
      `${runtime} svelte-typecheck: exit ${result.status}, ${errors.length} errors\n${result.stdout}${result.stderr}`,
    );
  }

  // Each way a user starts it, with each runtime's checker. Under `--bun`,
  // Bun runs the bin under the name node; `bun x` and npx, from the
  // project's `node_modules/.bin`.
  const launchers: [string, (checker: string) => string[]][] = [
    ["npx", (c) => ["--no-install", "svelte-typecheck", "--checker", c]],
    ["bun", (c) => ["x", "svelte-typecheck", "--checker", c]],
    ["bun", (c) => ["x", "--bun", "svelte-typecheck", "--checker", c]],
    ["npm", (c) => ["run", "--silent", `typecheck:${c}`]],
    ["bun", (c) => ["run", `typecheck:${c}`]],
    ["bun", (c) => ["--bun", "run", `typecheck:${c}`]],
  ];
  for (const [command, args] of launchers)
    for (const checker of ["tsc", "bun"]) {
      const argv = args(checker);
      const machine = argv.includes("--checker")
        ? [...argv, "--output", "machine", "--no-incremental"]
        : argv;
      const result = run(command, machine, project);
      const errors = [...result.stdout.matchAll(MACHINE_ERROR)];
      assert(
        result.status === 1 && errors.length === 12,
        `${command} ${machine.join(" ")}: exit ${result.status}, ${errors.length} errors\n${result.stdout}${result.stderr}`,
      );
    }

  // On Node with no other checker on PATH (bun run adds this repo's
  // node_modules/.bin, with tsrs and tsgo), it finds the project's tsc.
  const noBun = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) =>
      ["bun", "tsrs", "tsgo"].every((name) =>
        ["", ".exe", ".cmd"].every(
          (ext) => !existsSync(join(entry, name + ext)),
        ),
      ),
    )
    .join(delimiter);
  const nodeOnly = spawnSync(
    process.env.NODE ?? "node",
    [
      "--input-type=module",
      "-e",
      'const { typecheck } = await import("svelte-typecheck"); console.log((await typecheck()).checker);',
    ],
    { cwd: project, encoding: "utf-8", env: { ...process.env, PATH: noBun } },
  );
  assert(
    nodeOnly.stdout.trim() === "tsc",
    `node without Bun picked ${nodeOnly.stdout}${nodeOnly.stderr}`,
  );

  // A compiler-only run needs no checker: in a folder outside the project,
  // where no `typescript` resolves, with no checker on PATH either.
  const bare = join(dir, "bare");
  write(bare, { "App.svelte": '<img src="a.png">\n' });
  const noChecker = noBun
    .split(delimiter)
    .filter((entry) =>
      ["", ".exe", ".cmd"].every(
        (ext) => !existsSync(join(entry, `tsc${ext}`)),
      ),
    )
    .join(delimiter);
  const compilerOnly = spawnSync(
    process.env.NODE ?? "node",
    [
      join(project, "node_modules/svelte-typecheck/cli.js"),
      "--no-tsconfig",
      "--diagnostic-sources",
      "svelte",
      "--svelte",
      join(project, "node_modules/svelte"),
      "--output",
      "machine",
    ],
    { cwd: bare, encoding: "utf-8", env: { ...process.env, PATH: noChecker } },
  );
  assert(
    compilerOnly.status === 0 &&
      compilerOnly.stdout.includes("a11y_missing_attribute"),
    `a compiler-only run without a checker: exit ${compilerOnly.status}\n${compilerOnly.stdout}${compilerOnly.stderr}`,
  );

  // Enough components that the compiler's pass runs on a worker, whose
  // file the bundle carries: the config it loads records the thread.
  const many = join(project, "many");
  write(many, {
    ...Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [
        `Img${i}.svelte`,
        '<img src="a.png">\n',
      ]),
    ),
    "svelte.config.js":
      'import { writeFileSync } from "node:fs";\nimport { isMainThread } from "node:worker_threads";\nwriteFileSync(new URL("./thread", import.meta.url), isMainThread ? "main" : "worker");\nexport default {};\n',
  });
  for (const runtime of ["node", "bun"]) {
    rmSync(join(many, "thread"), { force: true });
    const result = run(
      runtime,
      [
        join(project, "node_modules/svelte-typecheck/cli.js"),
        "--workspace",
        "many",
        "--no-tsconfig",
        "--checker",
        "tsc",
        "--no-incremental",
        "--output",
        "machine",
      ],
      project,
    );
    const thread = existsSync(join(many, "thread"))
      ? readFileSync(join(many, "thread"), "utf-8")
      : "none";
    assert(
      result.status === 0 &&
        result.stdout.match(/a11y_missing_attribute/g)?.length === 16 &&
        thread === "worker",
      `${runtime}: the compiler's pass on a worker: exit ${result.status}, config loaded on ${thread}\n${result.stdout}${result.stderr}`,
    );
  }
  rmSync(many, { recursive: true, force: true });

  write(project, {
    "smoke.js": `import assert from "node:assert/strict";
import { compilerDiagnostics, typecheck } from "svelte-typecheck";

const result = await typecheck({ checker: "tsc" });
assert.equal(result.components, 4);
assert.equal(result.diagnostics.filter((d) => d.severity === "error").length, 12);
assert.equal(result.diagnostics.filter((d) => d.source === "svelte").length, 1);
assert.deepEqual(result.dropped, []);
const [warning] = compilerDiagnostics('<img src="a.png">', "Img.svelte");
assert.equal(warning.code, "a11y_missing_attribute");
`,
  });
  ok("node", ["smoke.js"], project);

  // index.d.ts is written by hand: it must resolve through `exports` and
  // check on its own, library checks included.
  write(project, {
    "consumer.ts": `import {
  applyBaseline,
  compilerDiagnostics,
  createBaseline,
  typecheck,
  watch,
  type Checker,
  type TypecheckResult,
} from "svelte-typecheck";

const checker: Checker = "tsc";
const result: TypecheckResult = await typecheck({ checker });
const baseline = createBaseline(result.diagnostics, result.workspace);
const { known }: { known: number } = applyBaseline(result.diagnostics, baseline, result.workspace);
const [first] = compilerDiagnostics("<img>", "Img.svelte", { cwd: "." });
const stop: () => void = watch({}, () => {});
export { first, known, stop };
`,
  });
  ok(
    "node",
    [
      "node_modules/typescript/bin/tsc",
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "false",
      "--target",
      "esnext",
      "--module",
      "nodenext",
      "consumer.ts",
    ],
    project,
  );
  console.log(
    "✓ The packed package type-checks the fixtures on Node and Bun, and its types check",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
