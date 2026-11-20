// One run at a time in an output folder. Two runs on one project (an
// editor's task and a pre-commit hook, a monorepo's tasks) would otherwise
// clear or rewrite the generated code while the other's checker reads it.
// The lock is a file beside the folder, as clearing moves the folder
// aside: made with "wx", which fails while another run holds it.
import { readFileSync, unlinkSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";

/** How often a run touches its lock, to show it's still running. */
const HEARTBEAT_MS = 5000;
/** A lock not touched for this long is a stopped run's, wherever it ran. */
const STALE_MS = 30_000;
/** A run held this long is stuck: the next one goes ahead. */
const LONGEST_RUN_MS = 10 * 60_000;
/** The longest wait between looks at another run's lock. */
const MAX_POLL_MS = 200;

interface Holder {
  pid: number;
  host: string;
  started: number;
}

/** The locks this process holds, by path, with what each one says. */
const held = new Map<string, string>();
let exitHook = false;

/** The lock for `outDir`: a dot file beside it, which no glob enters. */
export const lockPathOf = (outDir: string) =>
  join(dirname(outDir), `.${basename(outDir)}.lock`);

/**
 * Holds `outDir` for a run: waits while another run holds it, and takes
 * over a lock whose run stopped. Returns the release, which the run calls
 * when it's done, error or not. A process that exits drops its locks; one
 * killed leaves its lock, which the next run sees is a dead process's.
 */
export async function lockOutDir(outDir: string): Promise<() => Promise<void>> {
  const path = lockPathOf(outDir);
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify({
    pid: process.pid,
    host: hostname(),
    started: Date.now(),
  } satisfies Holder);
  let wait = 5;
  let denied = 0;
  for (;;) {
    try {
      // eslint-disable-next-line eslint/no-await-in-loop -- until it's free
      const file = await open(path, "wx");
      try {
        // eslint-disable-next-line eslint/no-await-in-loop -- once, when made
        await file.writeFile(content);
      } finally {
        // eslint-disable-next-line eslint/no-await-in-loop -- as above
        await file.close();
      }
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows can't make a file while the last one's delete is pending.
      if (code === "EPERM" && process.platform === "win32" && denied++ < 100) {
        // eslint-disable-next-line eslint/no-await-in-loop -- until it's gone
        await sleep(wait);
        continue;
      }
      if (code !== "EEXIST") throw error;
    }
    // eslint-disable-next-line eslint/no-await-in-loop -- one look per try
    if (await takeOver(path)) continue;
    // eslint-disable-next-line eslint/no-await-in-loop -- until it's free
    await sleep(wait);
    wait = Math.min(wait * 2, MAX_POLL_MS);
  }

  held.set(path, content);
  if (!exitHook) {
    exitHook = true;
    process.on("exit", () => {
      for (const [lock, ours] of held) releaseSync(lock, ours);
    });
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    utimes(path, now, now).catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    held.delete(path);
    // Not another run's, which took over this one as stopped.
    if ((await readFile(path, "utf-8").catch(() => undefined)) === content)
      await rm(path, { force: true }).catch(() => {});
  };
}

/**
 * Removes the lock at `path` if its run stopped: its process is gone, it
 * wasn't touched for `STALE_MS`, or it's held past `LONGEST_RUN_MS`.
 * Whether to try for it again at once.
 */
async function takeOver(path: string): Promise<boolean> {
  const [text, stats] = await Promise.all([
    readFile(path, "utf-8").catch(() => undefined),
    stat(path).catch(() => undefined),
  ]);
  // Released since: try again.
  if (text === undefined || !stats) return true;
  const holder = parse(text);
  const now = Date.now();
  const stopped =
    now - stats.mtimeMs > STALE_MS ||
    (holder !== undefined &&
      (now - holder.started > LONGEST_RUN_MS ||
        (holder.host === hostname() && !alive(holder.pid))));
  if (!stopped) return false;
  // Moved aside, then read: another run waiting can take over first and
  // make its own lock, which this run mustn't delete.
  const aside = `${path}.stale-${process.pid}-${now}`;
  try {
    await rename(path, aside);
  } catch {
    return true;
  }
  const moved = await readFile(aside, "utf-8").catch(() => undefined);
  if (moved !== undefined && moved !== text)
    await rename(aside, path).catch(() => {});
  else await rm(aside, { force: true }).catch(() => {});
  return true;
}

function parse(text: string): Holder | undefined {
  try {
    const holder = JSON.parse(text) as Partial<Holder>;
    return typeof holder.pid === "number" &&
      typeof holder.host === "string" &&
      typeof holder.started === "number"
      ? (holder as Holder)
      : undefined;
  } catch {
    // Half-written, as a run writes it right after making it.
    return undefined;
  }
}

/** Whether a process runs: signal 0 checks without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Another user's process, which this one can't signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function releaseSync(path: string, content: string): void {
  try {
    if (readFileSync(path, "utf-8") === content) unlinkSync(path);
  } catch {
    // Gone already.
  }
}

const sleep = (ms: number) =>
  new Promise<void>((done) => {
    setTimeout(done, ms);
  });
