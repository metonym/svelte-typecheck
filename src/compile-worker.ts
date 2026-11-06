// The compiler's pass on a worker thread: the other side of
// `compileOffThread` and `compileFilesOffThread`.
import { parentPort } from "node:worker_threads";
import {
  compileAll,
  compileFiles,
  type CompileFilesRequest,
  type CompileRequest,
} from "./compiler.ts";

parentPort?.on(
  "message",
  async (
    message:
      | { id: number; request: CompileRequest }
      | { id: number; files: CompileFilesRequest },
  ) => {
    const { id } = message;
    try {
      parentPort?.postMessage({
        id,
        result:
          "files" in message
            ? await compileFiles(message.files)
            : await compileAll(message.request),
      });
    } catch (error) {
      parentPort?.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
