// One end-to-end run on the bench corpus with the checker named in argv, for
// ostia's command workloads.
import { typecheck } from "../src/check.ts";
import type { Checker } from "../src/types.ts";
import { corpus } from "./corpus.ts";

const checker = process.argv[2] as Checker;
const result = await typecheck({
  workspace: await corpus(),
  checker,
  outDir: `node_modules/.cache/svelte-typecheck/bench-${checker}`,
});
if (result.diagnostics.length > 0 || result.failed.length > 0)
  throw new Error(
    `bench corpus has errors: ${JSON.stringify(result.diagnostics[0] ?? result.failed[0])}`,
  );
