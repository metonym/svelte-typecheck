// Checks each project in eval/projects.ts with svelte-check and
// svelte-typecheck, as it is and with errors planted (eval/mutate.ts),
// and fails on any line only one of them prints that isn't a known
// difference, on the same lines in another order, or on an error
// svelte-typecheck dropped that isn't a known one.
//
//   bun eval/parity.ts [name...]
//
// Projects are cloned to eval/.projects/, installed with their own
// package manager (the version their package.json names, through npx),
// and kept between runs; each run resets their files first.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compare, droppedOf, onlyIn, onlyUnionOrder } from "./compare.ts";
import { mutate } from "./mutate.ts";
import { type Project, PROJECTS } from "./projects.ts";

const CLONES = join(import.meta.dirname, ".projects");
/** svelte-check's version where a project has none: the test projects'. */
const SVELTE_CHECK = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, "../package.json"), "utf-8"),
  ) as { workspaces: { catalog: Record<string, string> } }
).workspaces.catalog["svelte-check"];

function sh(command: string[], cwd: string) {
  const run = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    encoding: "utf-8",
    maxBuffer: 1 << 28,
  });
  if (run.status !== 0)
    throw new Error(
      `${command.join(" ")} (in ${cwd}) exited ${run.status}\n${run.stdout}${run.stderr}`,
    );
  return run.stdout;
}

/** The project's package manager, as a command that runs it. */
function packageManager(root: string): string[] {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
    packageManager?: string;
  };
  if (pkg.packageManager) {
    const [name = "", version = ""] = pkg.packageManager.split("@");
    if (name === "bun") return [process.execPath];
    return ["npx", "-y", `${name}@${version.split("+")[0]}`];
  }
  if (existsSync(join(root, "bun.lock"))) return [process.execPath];
  if (existsSync(join(root, "pnpm-lock.yaml"))) return ["npx", "-y", "pnpm"];
  return ["npm"];
}

/** Clones, installs and sets up the project at its commit, with its files as committed. */
function prepare(project: Project): string {
  const root = join(CLONES, project.name);
  if (!existsSync(join(root, ".git"))) {
    mkdirSync(root, { recursive: true });
    sh(["git", "init", "-q"], root);
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf-8",
  }).stdout.trim();
  if (head !== project.commit) {
    sh(
      [
        "git",
        "fetch",
        "-q",
        "--depth",
        "1",
        `https://github.com/${project.repo}`,
        project.commit,
      ],
      root,
    );
    sh(["git", "checkout", "-q", "--force", project.commit], root);
  }
  // The committed files: undoes planted errors and an added svelte-check
  // (node_modules and generated folders are ignored, and kept).
  sh(["git", "checkout", "-q", "--", "."], root);
  sh(["git", "clean", "-fdq"], root);
  const pm = packageManager(root);
  const marker = join(CLONES, `${project.name}.installed`);
  if (!existsSync(marker) || readFileSync(marker, "utf-8") !== project.commit) {
    const frozen = pm[0] === "npm" ? ["ci"] : ["install", "--frozen-lockfile"];
    sh([...pm, ...frozen], root);
    writeFileSync(marker, project.commit);
  }
  const dir = join(root, project.dir ?? ".");
  // Its own svelte-check, or one beside its Svelte: eval's would load a
  // second copy of Svelte's types.
  const hasOwn = [dir, root].some((d) =>
    existsSync(join(d, "node_modules/svelte-check/package.json")),
  );
  if (!hasOwn)
    sh(
      [
        ...pm,
        pm[0] === "npm" ? "install" : "add",
        "-D",
        `svelte-check@${SVELTE_CHECK}`,
      ],
      dir,
    );
  for (const [file, text] of Object.entries(project.files ?? {}))
    writeFileSync(join(dir, file), `${text}\n`);
  for (const command of project.setup ?? []) sh([...pm, ...command], dir);
  return dir;
}

type Pass = "as it is" | "with errors planted";

/**
 * The dropped errors that aren't known, and the known ones no longer
 * dropped. A dropped error is one svelte-typecheck found but couldn't
 * place in a component: a source map gap hides real errors this way.
 */
function droppedProblems(
  project: Project,
  pass: Pass,
  dropped: string[],
): string[] {
  const known = (project.dropped ?? []).filter(
    (k) => (k.pass ?? pass) === pass,
  );
  return [
    ...dropped
      .filter((line) => !known.some((k) => k.line === line))
      .map((line) => `dropped: ${line}`),
    ...known
      .filter((k) => !dropped.includes(k.line))
      .map((k) => `known, but no longer dropped: ${k.line}`),
  ];
}

/**
 * What's wrong with one comparison, if anything, and how many lines
 * differed only in a union's order, a documented difference.
 */
function problems(
  project: Project,
  pass: Pass,
  expected: string[],
  actual: string[],
): { problems: string[]; unionOrder: number } {
  const only = onlyIn({ expected, actual });
  // One line of each tool's that differ only in a union's order.
  const unionOrder = new Set<string>();
  for (const a of only.svelteCheck) {
    const b = only.svelteTypecheck.find(
      (line) => !unionOrder.has(line) && onlyUnionOrder(a, line),
    );
    if (b) unionOrder.add(a).add(b);
  }
  const found = [
    ...only.svelteCheck.map((line) => ({ only: "svelte-check", line })),
    ...only.svelteTypecheck.map((line) => ({ only: "svelte-typecheck", line })),
  ].filter((f) => !unionOrder.has(f.line));
  const known = (project.known ?? []).filter((k) => (k.pass ?? pass) === pass);
  const isKnown = (f: { only: string; line: string }) =>
    known.some((k) => k.only === f.only && k.line === f.line);
  const out = found
    .filter((f) => !isKnown(f))
    .map((f) => `only ${f.only}: ${f.line}`);
  // The known lines that didn't differ this time.
  for (const k of known)
    if (!found.some((f) => f.only === k.only && f.line === k.line))
      out.push(`known, but no longer different: only ${k.only}: ${k.line}`);
  if (out.length === 0) {
    const shared = (lines: string[], tool: string) =>
      lines.filter(
        (line) =>
          !unionOrder.has(line) &&
          !known.some((k) => k.only === tool && k.line === line),
      );
    const a = shared(expected, "svelte-check");
    const b = shared(actual, "svelte-typecheck");
    const at = a.findIndex((line, i) => line !== b[i]);
    if (at !== -1)
      out.push(
        `the same lines in another order, from line ${at + 1}:\n    svelte-check:     ${a[at]}\n    svelte-typecheck: ${b[at]}`,
      );
  }
  return { problems: out, unionOrder: unionOrder.size / 2 };
}

const names = process.argv.slice(2);
const chosen =
  names.length > 0
    ? PROJECTS.filter((p) => names.includes(p.name))
    : PROJECTS.filter((p) => {
        if (p.pending) console.log(`- ${p.name}, left out: ${p.pending}`);
        return !p.pending;
      });
if (chosen.length === 0)
  throw new Error(`no project named ${names.join(", ")}`);

let failed = false;
for (const project of chosen) {
  const dir = prepare(project);
  const passes = project.mutate
    ? (["as it is", "with errors planted"] satisfies Pass[])
    : (["as it is"] satisfies Pass[]);
  for (const pass of passes) {
    if (pass === "with errors planted" && project.mutate)
      mutate(join(dir, project.mutate));
    const start = performance.now();
    const { expected, actual } = compare(dir, project.args ?? []);
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    const { problems: differences, unionOrder } = problems(
      project,
      pass,
      expected,
      actual,
    );
    const found = [
      ...differences,
      ...droppedProblems(
        project,
        pass,
        // eslint-disable-next-line eslint/no-await-in-loop -- after this pass's run
        await droppedOf(dir, project.args ?? []),
      ),
    ];
    const summary = expected.at(-1) ?? "svelte-check printed nothing";
    const unions =
      unionOrder > 0 ? `, ${unionOrder} differing only in union order` : "";
    console.log(
      `${found.length === 0 ? "✓" : "✗"} ${project.name}, ${pass}: ${summary}${unions} (${seconds} s)`,
    );
    for (const problem of found.slice(0, 30)) console.log(`  ${problem}`);
    if (found.length > 30) console.log(`  …and ${found.length - 30} more`);
    if (found.length > 0 || expected.length === 0) failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
