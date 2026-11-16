// File operations run a few at a time. Thousands at once queue on Bun's
// thread pool, whose threads then contend for the same folder in the
// kernel: on macOS, 16,000 writes at once take twice as long and ten
// times the system time as 4 at a time.

/** Operations at once, on this thread. */
const LIMIT = 4;
let active = 0;
const waiting: (() => void)[] = [];

/** `op`, once fewer than `LIMIT` others run. `op` mustn't call this itself. */
export async function limited<T>(op: () => Promise<T>): Promise<T> {
  // A finished operation hands its slot to the next one waiting.
  if (active >= LIMIT) await new Promise<void>((go) => waiting.push(go));
  else active++;
  try {
    return await op();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
