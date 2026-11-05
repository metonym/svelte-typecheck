// The compiler's pass on a worker thread: `compileOffThread`'s other side,
// and `warmOffThread`'s, which has it load the compiler and config early.
import { parentPort } from "node:worker_threads";
import {
  compileAll,
  type CompileRequest,
  type CompilerSource,
  warmCompiler,
} from "./compiler.ts";

parentPort?.on(
  "message",
  async (
    message: { id: number; request: CompileRequest } | { warm: CompilerSource },
  ) => {
    // A failure here is the compile request's to report, as it loads again.
    if ("warm" in message) return warmCompiler(message.warm).catch(() => {});
    const { id, request } = message;
    try {
      parentPort?.postMessage({ id, result: await compileAll(request) });
    } catch (error) {
      parentPort?.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
