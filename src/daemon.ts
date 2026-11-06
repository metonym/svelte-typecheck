// `--daemon`: a run handed to a process kept alive for its working
// directory, so it doesn't start a runtime, load and optimize this code,
// load the compiler and the Svelte config, and parse the caches again. The
// daemon runs the CLI as it is, with the run's arguments, environment and
// terminal, and the client prints what it printed. A daemon whose loaded
// state may be stale (the config, the lockfile, Svelte) exits for a new
// one, and anything that goes wrong runs the check here instead.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configFingerprint } from "./config.ts";

/** Turns `--daemon` on for every run, as the flag does. */
const ENABLE = "SVELTE_TYPECHECK_DAEMON";
/** Seconds a daemon waits for its next run before it exits. */
const IDLE = "SVELTE_TYPECHECK_DAEMON_IDLE";
/** The folder of the daemons' sockets and logs, for tests. */
const DIR = "SVELTE_TYPECHECK_DAEMON_DIR";
const DEFAULT_IDLE_SECONDS = 600;
/** A daemon's own argument, before its socket. */
export const SERVE = "--serve-daemon";
/** How long a client waits for a daemon it started to listen. */
const START_MS = 10_000;
const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

interface Terminal {
  isTTY: boolean;
  columns?: number;
}
interface RunRequest {
  run: string[];
  env: Record<string, string | undefined>;
  terminal: Terminal;
  key: string;
}
type Request = RunRequest | { status: true } | { stop: true };
interface Status {
  pid: number;
  cwd: string;
  started: number;
  runs: number;
  idle: number;
  log: string;
}
type Printed = { out: string } | { err: string };
type Reply =
  | Printed
  | { exit: number }
  | { stale: true }
  | { status: Status }
  | { stopped: true };

const truthy = (value: string | undefined) =>
  value !== undefined && value !== "" && value !== "0" && value !== "false";

/**
 * Whether a run goes to a daemon: `--daemon` or `SVELTE_TYPECHECK_DAEMON`,
 * but not with `--no-daemon`, `--watch` (a process kept alive already) or
 * on CI, where a machine runs once and a daemon would only linger. Never
 * for a daemon itself, which would start another, and that one another.
 */
export function wantsDaemon(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (argv[0] === SERVE) return false;
  if (argv.includes("--no-daemon") || argv.includes("--watch")) return false;
  if (truthy(env.CI)) return false;
  return argv.includes("--daemon") || truthy(env[ENABLE]);
}

/** The arguments without the daemon's own flags, as the run takes them. */
export const runArguments = (argv: string[]) =>
  argv.filter((arg) => arg !== "--daemon" && arg !== "--no-daemon");

/** The CLI that runs, and when it was built: a daemon serves only its own. */
function buildKey(): string {
  const cli = process.argv[1] ?? "";
  let mtime = 0;
  try {
    mtime = statSync(cli).mtimeMs;
  } catch {
    // Run some other way: no build to tell apart.
  }
  return `${cli}\0${mtime}\0${process.execPath}`;
}

/** The daemon for the working directory and this build: its socket and log. */
function daemonPaths(cwd = process.cwd()): {
  socket: string;
  log: string;
} {
  const id = createHash("sha1")
    .update(`${realpathSync(cwd)}\0${buildKey()}`)
    .digest("hex")
    .slice(0, 16);
  // The user's own folder, only theirs to read.
  const { username } = userInfo();
  const dir =
    process.env[DIR] ??
    join(
      process.env.XDG_RUNTIME_DIR ?? tmpdir(),
      `svelte-typecheck-${username}`,
    );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    socket:
      process.platform === "win32"
        ? `\\\\.\\pipe\\svelte-typecheck-${username}-${id}`
        : join(dir, `${id}.sock`),
    log: join(dir, `${id}.log`),
  };
}

/** Sends `message`, then hands each reply to `onReply` until it's the last. */
function request(
  socket: string,
  message: Request,
  onReply: (reply: Reply) => boolean,
): Promise<void> {
  return new Promise((done, fail) => {
    const connection = connect(socket);
    let buffer = "";
    let finished = false;
    connection.on("error", fail);
    connection.on("connect", () =>
      connection.write(`${JSON.stringify(message)}\n`),
    );
    connection.on("data", (chunk) => {
      buffer += chunk;
      for (
        let at = buffer.indexOf("\n");
        at !== -1;
        at = buffer.indexOf("\n")
      ) {
        const reply = JSON.parse(buffer.slice(0, at)) as Reply;
        buffer = buffer.slice(at + 1);
        if (onReply(reply)) {
          finished = true;
          connection.end();
          done();
          return;
        }
      }
    });
    connection.on("close", () => {
      if (!finished) fail(new Error("The daemon closed before replying"));
    });
  });
}

/** The daemon on `socket`, or `undefined` when none answers. */
async function statusOf(socket: string): Promise<Status | undefined> {
  let found: Status | undefined;
  try {
    await request(socket, { status: true }, (reply) => {
      if ("status" in reply) found = reply.status;
      return true;
    });
  } catch {
    return;
  }
  return found;
}

const pause = () => new Promise((wait) => setTimeout(wait, 20));

/** Starts a daemon on `socket` and waits until it answers. */
async function start(socket: string): Promise<Status> {
  // Without what turns the daemon on: a daemon never hands its runs on.
  const env = { ...process.env };
  delete env[ENABLE];
  spawn(process.execPath, [process.argv[1] ?? "", SERVE, socket], {
    cwd: process.cwd(),
    detached: true,
    env,
    stdio: "ignore",
  }).unref();
  const until = Date.now() + START_MS;
  for (;;) {
    // eslint-disable-next-line eslint/no-await-in-loop -- until it listens
    const running = await statusOf(socket);
    if (running) return running;
    if (Date.now() > until) throw new Error("The daemon didn't start");
    // eslint-disable-next-line eslint/no-await-in-loop -- as above
    await pause();
  }
}

/** Waits for a daemon that said it exits to stop answering. */
async function stopped(socket: string): Promise<void> {
  const until = Date.now() + START_MS;
  // eslint-disable-next-line eslint/no-await-in-loop -- until it's gone
  while ((await statusOf(socket)) && Date.now() < until) await pause();
}

/**
 * The run on the daemon, started if none listens, and its exit code. Its
 * output is printed once it ends, so a daemon that fails partway prints
 * nothing, and `runHere` runs the check instead.
 */
export async function runThroughDaemon(
  argv: string[],
  runHere: () => Promise<number>,
): Promise<number> {
  const message: RunRequest = {
    run: argv,
    env: { ...process.env },
    terminal: {
      isTTY: Boolean(process.stdout.isTTY),
      columns: process.stdout.columns,
    },
    key: buildKey(),
  };
  const attempt = async (socket: string) => {
    const printed: Printed[] = [];
    let code: number | "stale" = "stale";
    await request(socket, message, (reply) => {
      if ("out" in reply || "err" in reply) {
        printed.push(reply);
        return false;
      }
      if ("exit" in reply) code = reply.exit;
      return true;
    });
    return { code, printed };
  };
  try {
    const { socket } = daemonPaths();
    if (!(await statusOf(socket))) await start(socket);
    let result = await attempt(socket);
    // Its config, lockfile or Svelte changed: it exits, and a new one runs.
    if (result.code === "stale") {
      await stopped(socket);
      await start(socket);
      result = await attempt(socket);
    }
    if (result.code === "stale") return await runHere();
    for (const p of result.printed)
      if ("out" in p) process.stdout.write(p.out);
      else process.stderr.write(p.err);
    return result.code;
  } catch {
    return runHere();
  }
}

/** `svelte-typecheck start`, `stop` and `status`, and their exit code. */
export async function daemonCommand(
  command: "start" | "stop" | "status",
): Promise<number> {
  const { socket } = daemonPaths();
  const running = await statusOf(socket);
  const describe = (s: Status) =>
    `the daemon for ${s.cwd} (pid ${s.pid}, log ${s.log})`;
  if (command === "start") {
    console.log(
      running
        ? `Already running: ${describe(running)}`
        : `Started ${describe(await start(socket))}`,
    );
    return 0;
  }
  if (!running) {
    console.log(`No daemon runs for ${process.cwd()}`);
    return 0;
  }
  if (command === "stop") {
    await request(socket, { stop: true }, () => true).catch(() => {});
    await stopped(socket);
    console.log(`Stopped ${describe(running)}`);
    return 0;
  }
  const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
  console.log(
    `Running: ${describe(running)}\n  ${running.runs} runs, up ${seconds(Date.now() - running.started)}, idle ${seconds(running.idle)}`,
  );
  return 0;
}

/** An option's value as the run reads it: `--name value` or `--name=value`. */
function optionOf(argv: string[], name: string): string | undefined {
  const at = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (at === -1) return;
  const arg = argv[at] ?? "";
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[at + 1];
}

/**
 * What the daemon keeps loaded depends on, for a run's arguments: its
 * Svelte config (imported once, or read through Vite), the lockfile
 * (Vite's plugins, the preprocessors) and the installed Svelte (its
 * compiler). Stats and the config's text, cheap to read before each run.
 */
function loadedState(argv: string[]): string {
  const cwd = process.cwd();
  const workspace = resolve(cwd, optionOf(argv, "--workspace") ?? ".");
  const config = optionOf(argv, "--config");
  const configFile = config && resolve(workspace, config);
  const parts = [
    configFile
      ? configFingerprint(dirname(configFile), configFile)
      : configFingerprint(workspace),
  ];
  const stat = (path: string) => {
    try {
      const { size, mtimeMs } = statSync(path);
      parts.push(path, `${size}:${mtimeMs}`);
    } catch {
      parts.push(path, "missing");
    }
  };
  // The nearest lockfiles, from the workspace up.
  for (let dir = workspace; ; dir = dirname(dir)) {
    const found = LOCKFILES.map((name) => join(dir, name)).filter((path) =>
      existsSync(path),
    );
    for (const path of found) stat(path);
    if (found.length > 0 || dirname(dir) === dir) break;
  }
  const svelte = optionOf(argv, "--svelte");
  try {
    stat(
      svelte
        ? join(resolve(cwd, svelte), "package.json")
        : createRequire(join(cwd, "package.json")).resolve(
            "svelte/package.json",
          ),
    );
  } catch {
    parts.push("no svelte");
  }
  return createHash("sha1").update(parts.join("\0")).digest("hex");
}

/**
 * Serves runs on `socket` one at a time with `main`, until it's idle for
 * `SVELTE_TYPECHECK_DAEMON_IDLE` seconds, stopped, or asked for a run whose
 * loaded state changed since it loaded it.
 */
export async function serveDaemon(
  socket: string,
  main: (argv: string[]) => Promise<number>,
): Promise<void> {
  const { log } = daemonPaths();
  writeFileSync(log, "");
  const note = (line: string) =>
    appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
  const key = buildKey();
  const started = Date.now();
  let runs = 0;
  let lastRun = started;
  const idleMs = 1000 * (Number(process.env[IDLE]) || DEFAULT_IDLE_SECONDS);
  /** Each argument set's loaded state when it first ran. */
  const states = new Map<string, string>();
  let queue = Promise.resolve();
  let idle: ReturnType<typeof setTimeout> | undefined;

  const server = createServer((connection) => {
    let buffer = "";
    connection.on("data", (chunk) => {
      buffer += chunk;
      const at = buffer.indexOf("\n");
      if (at === -1) return;
      const message = JSON.parse(buffer.slice(0, at)) as Request;
      buffer = "";
      queue = queue.then(() => handle(message, connection));
    });
    connection.on("error", () => {});
  });
  const exit = (reason: string) => {
    note(`exit: ${reason}`);
    server.close(() => process.exit(0));
    // A client still connected keeps the server open: don't wait on it.
    setTimeout(() => process.exit(0), 1000).unref();
  };
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => exit("idle"), idleMs);
  };
  const handle = async (message: Request, connection: Socket) => {
    const reply = (r: Reply) => connection.write(`${JSON.stringify(r)}\n`);
    if ("status" in message) {
      reply({
        status: {
          pid: process.pid,
          cwd: process.cwd(),
          started,
          runs,
          idle: Date.now() - lastRun,
          log,
        },
      });
      return;
    }
    if ("stop" in message) {
      reply({ stopped: true });
      connection.end();
      exit("stopped");
      return;
    }
    resetIdle();
    const argv = message.run;
    const scope = JSON.stringify(
      ["--workspace", "--config", "--svelte"].map((n) => optionOf(argv, n)),
    );
    const state = loadedState(argv);
    if (message.key !== key || (states.get(scope) ?? state) !== state) {
      reply({ stale: true });
      connection.end();
      exit(message.key === key ? "its loaded state changed" : "another build");
      return;
    }
    states.set(scope, state);
    const at = Date.now();
    const code = await asClient(message, reply, main);
    runs++;
    lastRun = Date.now();
    note(`ran ${JSON.stringify(argv)}: exit ${code} in ${lastRun - at} ms`);
    reply({ exit: code });
    connection.end();
  };

  process.on("uncaughtException", (error) => {
    note(`uncaught: ${error.stack ?? String(error)}`);
    process.exit(1);
  });
  const listen = () =>
    new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(socket, () => {
        server.off("error", fail);
        done();
      });
    });
  try {
    await listen();
  } catch (error) {
    // Another daemon got there first, as two clients can start one at
    // once; or one that crashed left its socket, which goes.
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    if (await statusOf(socket)) process.exit(0);
    await rm(socket, { force: true });
    await listen();
  }
  server.on("error", (error) => {
    note(`server: ${error.message}`);
    process.exit(1);
  });
  note(`listening on ${socket} for ${process.cwd()}`);
  resetIdle();
}

/**
 * `main` with the run's environment and terminal, and what it prints sent
 * to the client: `process.stdout` and `process.stderr`, and `console`,
 * which on Bun doesn't go through them.
 */
async function asClient(
  message: RunRequest,
  reply: (r: Reply) => void,
  main: (argv: string[]) => Promise<number>,
): Promise<number> {
  const { stdout, stderr } = process;
  const saved = {
    env: process.env,
    out: stdout.write,
    err: stderr.write,
    log: console.log,
    error: console.error,
    isTTY: Object.getOwnPropertyDescriptor(stdout, "isTTY"),
    columns: Object.getOwnPropertyDescriptor(stdout, "columns"),
  };
  const line = (args: unknown[]) => `${args.map(String).join(" ")}\n`;
  process.env = { ...message.env };
  Object.defineProperty(stdout, "isTTY", {
    value: message.terminal.isTTY,
    configurable: true,
  });
  Object.defineProperty(stdout, "columns", {
    value: message.terminal.columns,
    configurable: true,
  });
  stdout.write = ((chunk: string | Uint8Array) => {
    reply({ out: String(chunk) });
    return true;
  }) as typeof stdout.write;
  stderr.write = ((chunk: string | Uint8Array) => {
    reply({ err: String(chunk) });
    return true;
  }) as typeof stderr.write;
  console.log = (...args: unknown[]) => reply({ out: line(args) });
  console.error = (...args: unknown[]) => reply({ err: line(args) });
  try {
    return await main(message.run);
  } catch (error) {
    reply({ err: `${(error as Error).stack ?? String(error)}\n` });
    return 1;
  } finally {
    process.env = saved.env;
    stdout.write = saved.out;
    stderr.write = saved.err;
    console.log = saved.log;
    console.error = saved.error;
    for (const name of ["isTTY", "columns"] as const) {
      const descriptor = saved[name];
      if (descriptor) Object.defineProperty(stdout, name, descriptor);
      else Reflect.deleteProperty(stdout, name);
    }
  }
}
