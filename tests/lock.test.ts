// Runs at once in one project: each waits for the output folder, so none
// clears or rewrites the generated code another's checker reads.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { lockOutDir, lockPathOf } from "../src/lock.ts";

const root = join(import.meta.dir, "..");
const cli = join(root, "src/cli.ts");
const tmp = join(root, "tests/projects/svelte5/.tmp/lock");
const TIMESTAMP = /^\d+ /;

/** A copy of the fixtures with errors and warnings, inside the repo so imports resolve. */
async function project(name: string): Promise<string> {
  const cwd = join(tmp, name);
  await rm(cwd, { recursive: true, force: true });
  await mkdir(cwd, { recursive: true });
  // Not the cache, which another test's run can be writing.
  await cp(join(root, "tests/projects/svelte5/basic"), cwd, {
    recursive: true,
    filter: (from) => basename(from) !== "node_modules",
  });
  return cwd;
}

/** The CLI's machine output, without timestamps. */
const run = (cwd: string, args: string[] = []) =>
  new Promise<string[]>((done) => {
    const child = spawn(
      process.execPath,
      [cli, "--output", "machine", ...args],
      { cwd },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", () =>
      done(
        stdout
          .split("\n")
          .filter((line) => TIMESTAMP.test(line))
          .map((line) => line.replace(TIMESTAMP, "")),
      ),
    );
  });

/** A process that ran and exited, so its pid names none. */
const deadPid = () => {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  if (pid === undefined) throw new Error("no process");
  return pid;
};

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<"timeout">((done) => {
      setTimeout(() => done("timeout"), ms);
    }),
  ]);

describe("the output folder's lock", () => {
  afterAll(() => rm(tmp, { recursive: true, force: true }));

  it("gives each of several runs at once in a project its own right result", async () => {
    const cwd = await project("concurrent");
    const expected = await run(cwd, ["--no-incremental"]);
    expect(expected.at(-1)).toContain("12 ERRORS 1 WARNINGS");
    // A run that starts over clears the folder another run's checker reads.
    // Started a little apart, so one clears while another checks: started
    // together, they clear together and write the same code.
    for (let round = 0; round < 3; round++) {
      // eslint-disable-next-line eslint/no-await-in-loop -- one round at a time
      const runs = await Promise.all(
        Array.from({ length: 6 }, async (_, i) => {
          await Bun.sleep(i * 40);
          return run(cwd, i % 2 === 0 ? ["--no-incremental"] : []);
        }),
      );
      for (const output of runs) expect(output).toEqual(expected);
    }
    expect(
      existsSync(lockPathOf(join(cwd, "node_modules/.cache/svelte-typecheck"))),
    ).toBe(false);
  }, 120_000);

  it("takes over a lock whose process is gone", async () => {
    const cwd = await project("dead");
    const expected = await run(cwd, ["--no-incremental"]);
    const lock = lockPathOf(join(cwd, "node_modules/.cache/svelte-typecheck"));
    await writeFile(
      lock,
      JSON.stringify({ pid: deadPid(), host: hostname(), started: Date.now() }),
    );
    expect(await within(run(cwd, ["--no-incremental"]), 20_000)).toEqual(
      expected,
    );
    expect(existsSync(lock)).toBe(false);
  }, 60_000);

  it("takes over a lock no run has touched for a while", async () => {
    const outDir = join(tmp, "untouched/out");
    await mkdir(join(tmp, "untouched"), { recursive: true });
    const lock = lockPathOf(outDir);
    // A live process's, on another machine sharing the folder.
    await writeFile(
      lock,
      JSON.stringify({
        pid: process.pid,
        host: "elsewhere",
        started: Date.now(),
      }),
    );
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    const release = await within(lockOutDir(outDir), 2000);
    expect(release).not.toBe("timeout");
    expect(JSON.parse(await readFile(lock, "utf-8")).pid).toBe(process.pid);
    if (release !== "timeout") await release();
    expect(existsSync(lock)).toBe(false);
  });

  it("waits while a live run holds the folder", async () => {
    const outDir = join(tmp, "held/out");
    const first = await lockOutDir(outDir);
    const second = lockOutDir(outDir);
    expect(await within(second, 300)).toBe("timeout");
    await first();
    const release = await within(second, 2000);
    expect(release).not.toBe("timeout");
    if (release !== "timeout") await release();
    expect(existsSync(lockPathOf(outDir))).toBe(false);
  });
});
