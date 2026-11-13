import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { SERVE, wantsDaemon } from "../src/daemon.ts";
import { AGENT_ENV } from "../src/main.ts";

const root = join(import.meta.dir, "..");
const cli = join(root, "src/cli.ts");
/** This file's own daemons: their sockets and logs, apart from the user's. */
const dir = join(root, "tests/projects/svelte5/.tmp/daemon");
const TIMESTAMP = /^\d+ /;

/** A copy of the fixtures with errors and warnings, inside the repo so imports resolve. */
async function project(name: string): Promise<string> {
  const cwd = join(root, "tests/projects/svelte5/.tmp/daemon-projects", name);
  await rm(cwd, { recursive: true, force: true });
  await mkdir(cwd, { recursive: true });
  await Promise.all(
    ["Child.svelte", "Errors.svelte", "Warnings.svelte", "tsconfig.json"].map(
      (file) =>
        cp(join(root, "tests/projects/svelte5/basic", file), join(cwd, file)),
    ),
  );
  return cwd;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}
const environment = (env: Record<string, string | undefined> = {}) => {
  const base: Record<string, string | undefined> = { ...process.env };
  delete base.CI;
  for (const name of AGENT_ENV) delete base[name];
  delete base.SVELTE_TYPECHECK_DAEMON;
  return { ...base, SVELTE_TYPECHECK_DAEMON_DIR: dir, ...env };
};
const run = (
  cwd: string,
  args: string[],
  env?: Record<string, string | undefined>,
): Run => {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [cli, ...args],
    { cwd, env: environment(env), encoding: "utf-8" },
  );
  return { code: status, stdout, stderr };
};
const runAsync = (cwd: string, args: string[]) =>
  new Promise<Run>((done) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: environment(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
/** Machine output without its timestamps. */
const lines = (stdout: string) =>
  stdout
    .split("\n")
    .filter((line) => TIMESTAMP.test(line))
    .map((line) => line.replace(TIMESTAMP, ""));
const CHECK = ["--checker", "tsgo", "--output", "machine"];
const pidOf = (cwd: string) =>
  /pid (\d+)/.exec(run(cwd, ["status"]).stdout)?.[1];

afterAll(async () => {
  for (const name of [
    "output",
    "env-only",
    "env",
    "config",
    "fallback",
    "together",
    "idle",
  ])
    run(join(root, "tests/projects/svelte5/.tmp/daemon-projects", name), [
      "stop",
    ]);
  await rm(dir, { recursive: true, force: true });
});

describe("wantsDaemon", () => {
  it("is on with --daemon or SVELTE_TYPECHECK_DAEMON, off on CI, with --watch or --no-daemon", () => {
    expect(wantsDaemon(["--daemon"], {})).toBe(true);
    expect(wantsDaemon([], { SVELTE_TYPECHECK_DAEMON: "1" })).toBe(true);
    expect(wantsDaemon([], { SVELTE_TYPECHECK_DAEMON: "0" })).toBe(false);
    expect(wantsDaemon([], {})).toBe(false);
    expect(wantsDaemon(["--daemon"], { CI: "true" })).toBe(false);
    expect(wantsDaemon(["--daemon", "--watch"], {})).toBe(false);
    expect(wantsDaemon(["--no-daemon"], { SVELTE_TYPECHECK_DAEMON: "1" })).toBe(
      false,
    );
    // A daemon itself, which would otherwise start another.
    expect(
      wantsDaemon([SERVE, "socket"], { SVELTE_TYPECHECK_DAEMON: "1" }),
    ).toBe(false);
  });
});

describe("--daemon", () => {
  it("prints what a run here prints, and exits as it does", async () => {
    const cwd = await project("output");
    const here = run(cwd, CHECK);
    const first = run(cwd, ["--daemon", ...CHECK]);
    const second = run(cwd, ["--daemon", ...CHECK]);
    expect(here.code).toBe(1);
    expect(lines(here.stdout).length).toBeGreaterThan(2);
    for (const daemon of [first, second]) {
      expect(daemon.code).toBe(here.code);
      expect(lines(daemon.stdout)).toEqual(lines(here.stdout));
    }
    expect(run(cwd, ["status"]).stdout).toContain("2 runs");
  }, 120_000);

  it.skipIf(process.platform === "win32")(
    "starts one daemon when SVELTE_TYPECHECK_DAEMON turns it on",
    async () => {
      const cwd = await project("env-only");
      const env = { SVELTE_TYPECHECK_DAEMON: "1" };
      const here = run(cwd, ["--no-daemon", ...CHECK]);
      for (const _ of [1, 2]) {
        const daemon = run(cwd, CHECK, env);
        expect(daemon.code).toBe(here.code);
        expect(lines(daemon.stdout)).toEqual(lines(here.stdout));
      }
      const status = run(cwd, ["status"]).stdout;
      expect(status).toContain("2 runs");
      // The daemons on this project's socket: one, not one started by another.
      const socket = /log (\S+)\.log\)/.exec(status)?.[1] ?? "";
      const daemons = spawnSync("ps", ["-A", "-o", "command="], {
        encoding: "utf-8",
      })
        .stdout.split("\n")
        .filter((line) => line.includes(SERVE) && line.includes(socket));
      expect(daemons).toHaveLength(1);
    },
    120_000,
  );

  it("runs with each run's environment, not the one that started it", async () => {
    const cwd = await project("env");
    const human = run(cwd, ["--daemon", "--checker", "tsgo"]);
    expect(human.stdout).toContain("Loading svelte-typecheck");
    // The agent output, by its environment.
    const agent = run(cwd, ["--daemon", "--checker", "tsgo"], {
      AI_AGENT: "1",
    });
    expect(agent.stdout).not.toContain("Loading svelte-typecheck");
    expect(agent.stdout).toContain("checked ");
  }, 120_000);

  it("starts again once its config changes", async () => {
    const cwd = await project("config");
    await writeFile(join(cwd, "svelte.config.js"), "export default {};\n");
    run(cwd, ["--daemon", ...CHECK]);
    const before = pidOf(cwd);
    run(cwd, ["--daemon", ...CHECK]);
    expect(pidOf(cwd)).toBe(before);
    await writeFile(
      join(cwd, "svelte.config.js"),
      "export default { compilerOptions: {} };\n",
    );
    const after = run(cwd, ["--daemon", ...CHECK]);
    expect(lines(after.stdout)).toEqual(lines(run(cwd, CHECK).stdout));
    expect(pidOf(cwd)).not.toBe(before);
  }, 120_000);

  it("runs here when no daemon can start", async () => {
    const cwd = await project("fallback");
    // A file where its folder would be.
    const blocked = join(root, "tests/projects/svelte5/.tmp/daemon-blocked");
    await writeFile(blocked, "");
    const here = run(cwd, CHECK);
    const daemon = run(cwd, ["--daemon", ...CHECK], {
      SVELTE_TYPECHECK_DAEMON_DIR: join(blocked, "dir"),
    });
    expect(daemon.code).toBe(here.code);
    expect(lines(daemon.stdout)).toEqual(lines(here.stdout));
  }, 120_000);

  it.skipIf(process.platform === "win32")(
    "runs here, printing nothing twice, when the daemon drops the run",
    async () => {
      const cwd = await project("fallback");
      run(cwd, ["start"]);
      const log = /log (\S+)\)/.exec(run(cwd, ["status"]).stdout)?.[1] ?? "";
      run(cwd, ["stop"]);
      // A daemon that answers, then prints and drops the run.
      const socket = log.replace(/\.log$/, ".sock");
      const server = createServer((connection) => {
        connection.on("data", (chunk) => {
          const message = JSON.parse(String(chunk)) as Record<string, unknown>;
          if ("status" in message)
            connection.end(
              `${JSON.stringify({ status: { pid: 1, cwd, started: 0, runs: 0, idle: 0, log } })}\n`,
            );
          else connection.end(`${JSON.stringify({ out: "half\n" })}\n`);
        });
      });
      await new Promise<void>((done) => server.listen(socket, done));
      try {
        const daemon = await runAsync(cwd, ["--daemon", ...CHECK]);
        expect(daemon.stdout).not.toContain("half");
        expect(lines(daemon.stdout)).toEqual(lines(run(cwd, CHECK).stdout));
      } finally {
        server.close();
      }
    },
    120_000,
  );

  it("serves runs at once, one after the other", async () => {
    const cwd = await project("together");
    const here = run(cwd, CHECK);
    const runs = await Promise.all(
      [1, 2, 3].map(() => runAsync(cwd, ["--daemon", ...CHECK])),
    );
    for (const r of runs) expect(lines(r.stdout)).toEqual(lines(here.stdout));
  }, 120_000);

  it("isn't used on CI", async () => {
    const cwd = await project("ci");
    const here = run(cwd, ["--daemon", ...CHECK], { CI: "true" });
    expect(lines(here.stdout).length).toBeGreaterThan(2);
    expect(run(cwd, ["status"]).stdout).toContain("No daemon runs");
  }, 120_000);

  it("exits once idle, and stops when told", async () => {
    const cwd = await project("idle");
    const started = run(cwd, ["start"], { SVELTE_TYPECHECK_DAEMON_IDLE: "1" });
    expect(started.stdout).toContain("Started the daemon for");
    await new Promise((wait) => setTimeout(wait, 2000));
    expect(run(cwd, ["status"]).stdout).toContain("No daemon runs");
    run(cwd, ["start"]);
    expect(run(cwd, ["start"]).stdout).toContain("Already running");
    expect(run(cwd, ["stop"]).stdout).toContain("Stopped the daemon");
    expect(run(cwd, ["status"]).stdout).toContain("No daemon runs");
  }, 120_000);
});
