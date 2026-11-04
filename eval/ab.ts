// Compares two builds of svelte-typecheck on a real project, runs
// interleaved so load that comes and goes falls on both alike: the
// fastest and median wall time, CPU time (user and sys, the checker's
// included: steadier than wall time on a busy machine) and peak memory
// of the whole process tree.
//
//   bun run build && cp -R dist /tmp/after
//   bun eval/ab.ts /tmp/before /tmp/after <project> <scenario> [runs]
//
// scenario: cold-<checker>, unchanged-<checker> or changed-<checker>;
// changed edits the file in $AB_CHANGE (a component) before each run and
// restores it after. $AB_TSCONFIG names the tsconfig (default
// tsconfig.json).
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

const [a, b, project, scenario, runs = "5"] = process.argv.slice(2);
if (!(a && b && project && scenario))
  throw new Error(
    "usage: bun eval/ab.ts <dist-before> <dist-after> <project> <scenario> [runs]",
  );
const [mode, checker] = scenario.split("-") as [string, string];
const tsconfig = process.env.AB_TSCONFIG ?? "tsconfig.json";
const changed = process.env.AB_CHANGE;
if (mode === "changed" && !changed)
  throw new Error("changed-<checker> needs AB_CHANGE=<component>");
const svelte = dirname(
  realpathSync(join(project, "node_modules/svelte/package.json")),
);

interface Sample {
  ms: number;
  cpu: number;
  rss: number;
  summary: string;
}

/** Resident memory of a process group, from `ps`. */
function groupRss(pgid: number): number {
  let kb = 0;
  for (const line of spawnSync("ps", ["-A", "-o", "pgid=,rss="], {
    encoding: "utf-8",
  }).stdout.split("\n")) {
    const [group, rss] = line.trim().split(/\s+/);
    if (Number(group) === pgid) kb += Number(rss);
  }
  return kb * 1024;
}

function run(dist: string, outDir: string): Promise<Sample> {
  const args = [
    ...["-p", "node", join(dist, "cli.js"), "--output", "machine"],
    ...["--workspace", project, "--tsconfig", tsconfig, "--out-dir", outDir],
    ...["--svelte", svelte, "--checker", checker],
    ...(mode === "cold" ? ["--no-incremental"] : []),
  ];
  return new Promise((done) => {
    const start = performance.now();
    const child = spawn("/usr/bin/time", args, {
      // This repo's checkers too, for a project that has only some.
      env: {
        ...process.env,
        PATH: `${join(import.meta.dirname, "../node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    let rss = 0;
    const timer = setInterval(() => {
      rss = Math.max(rss, groupRss(child.pid ?? 0));
    }, 25);
    child.on("close", () => {
      clearInterval(timer);
      const seconds = (name: string) =>
        Number(new RegExp(`^${name}\\s+([\\d.]+)`, "m").exec(err)?.[1] ?? 0);
      done({
        ms: performance.now() - start,
        cpu: (seconds("user") + seconds("sys")) * 1000,
        rss,
        summary:
          /COMPLETED \d+ FILES (\d+ ERRORS \d+ WARNINGS)/.exec(out)?.[1] ??
          out.slice(-200),
      });
    });
  });
}

const sides = [
  { name: "before", dist: a, out: join(project, "node_modules/.cache/ab/a") },
  { name: "after", dist: b, out: join(project, "node_modules/.cache/ab/b") },
];
const samples = new Map(sides.map((side) => [side.name, [] as Sample[]]));
const original = changed ? readFileSync(changed, "utf-8") : "";
try {
  for (const side of sides) {
    rmSync(side.out, { recursive: true, force: true });
    // eslint-disable-next-line eslint/no-await-in-loop -- one run at a time
    if (mode !== "cold") await run(side.dist, side.out);
  }
  for (let i = 0; i < Number(runs); i++)
    for (const side of i % 2 ? [...sides].reverse() : sides) {
      if (changed)
        writeFileSync(changed, `${original}<!-- ${Date.now()} -->\n`);
      // eslint-disable-next-line eslint/no-await-in-loop -- one run at a time
      samples.get(side.name)?.push(await run(side.dist, side.out));
      if (changed) writeFileSync(changed, original);
    }
} finally {
  if (changed) writeFileSync(changed, original);
  for (const side of sides) rmSync(side.out, { recursive: true, force: true });
}

const median = (values: number[]) =>
  [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0;
console.log(`${scenario}, ${runs} runs each, interleaved`);
for (const [name, list] of samples) {
  const ms = list.map((s) => s.ms);
  console.log(
    `  ${name}: fastest ${Math.round(Math.min(...ms))} ms, median ${Math.round(median(ms))} ms, CPU ${Math.round(median(list.map((s) => s.cpu)))} ms, peak ${Math.round(median(list.map((s) => s.rss)) / 1e6)} MB, ${list[0]?.summary}`,
  );
}
