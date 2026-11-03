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
const MACHINE_ERROR = /^ERROR "(.+)" (\d+:\d+) .* (TS\d+)$/gm;

function run(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, { cwd, encoding: "utf-8" });
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
  // (a peer): no dependencies, and nothing Bun-only.
  for (const file of await readdir(dist)) {
    if (!file.endsWith(".js")) continue;
    const code = readFileSync(join(dist, file), "utf-8");
    const specifiers = [
      ...parseImportsExports(code).flatMap((node) =>
        "source" in node && node.source ? [String(node.source.value)] : [],
      ),
      ...lexDynamicImports(code)
        .filter((d) => d.kind === "import")
        .map((d) => d.source?.value ?? "a computed import()"),
    ];
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

  // A project with the fixtures, svelte and TypeScript 6 for `tsc`.
  const project = join(dir, "project");
  cpSync(join(root, "tests/fixtures"), project, { recursive: true });
  write(project, {
    "package.json": JSON.stringify({
      name: "project",
      private: true,
      type: "module",
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

  const bin = join(project, "node_modules/.bin/svelte-typecheck");
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

  // On Node with no other checker on PATH (bun run adds this repo's
  // node_modules/.bin, with tsrs and tsgo), it finds the project's tsc.
  const noBun = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) =>
      ["bun", "tsrs", "tsgo"].every((name) => !existsSync(join(entry, name))),
    )
    .join(delimiter);
  const nodeOnly = spawnSync(process.env.NODE ?? "node", [bin], {
    cwd: project,
    encoding: "utf-8",
    env: { ...process.env, PATH: noBun },
  });
  assert(
    nodeOnly.status === 1 &&
      nodeOnly.stderr.includes(" errors [") &&
      nodeOnly.stderr.includes(" tsc "),
    `node without Bun: exit ${nodeOnly.status}\n${nodeOnly.stdout}${nodeOnly.stderr}`,
  );

  write(project, {
    "smoke.js": `import assert from "node:assert/strict";
import { compilerDiagnostics, typecheck } from "svelte-typecheck";

const result = await typecheck({ checker: "tsc" });
assert.equal(result.components, 3);
assert.equal(result.diagnostics.length, 12);
assert.deepEqual(result.dropped, []);
const [warning] = compilerDiagnostics('<img src="a.png">', "Img.svelte");
assert.equal(warning.code, "a11y_missing_attribute");
`,
  });
  ok("node", ["smoke.js"], project);
  console.log("✓ The packed package type-checks the fixtures on Node and Bun");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
