// The compiler's pass on a worker thread: the other side of
// `compileOffThread` and `compileFilesOffThread`.
import { parentPort } from "node:worker_threads";
import {
  compileAll,
  compileFiles,
  type CompileFilesRequest,
  compileModules,
  type CompileModulesRequest,
  type CompileRequest,
} from "./compiler.ts";

parentPort?.on(
  "message",
  async (
    message:
      | { id: number; request: CompileRequest }
      | { id: number; files: CompileFilesRequest }
      | { id: number; modules: CompileModulesRequest },
  ) => {
    const { id } = message;
    try {
      let result: unknown;
      if ("files" in message) result = await compileFiles(message.files);
      else if ("modules" in message) result = compileModules(message.modules);
      else result = await compileAll(message.request);
      parentPort?.postMessage({ id, result });
    } catch (error) {
      parentPort?.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
