// The compiler's pass on a worker thread: `compileOffThread`'s other side.
import { parentPort } from "node:worker_threads";
import { compileAll, type CompileRequest } from "./compiler.ts";

parentPort?.on(
  "message",
  async ({ id, request }: { id: number; request: CompileRequest }) => {
    try {
      parentPort?.postMessage({ id, results: await compileAll(request) });
    } catch (error) {
      parentPort?.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
