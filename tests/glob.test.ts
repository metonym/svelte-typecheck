import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glob } from "../src/glob.ts";

describe("glob", () => {
  it("skips node_modules, and dot folders no pattern names", () => {
    const root = mkdtempSync(join(tmpdir(), "svelte-typecheck-glob-"));
    try {
      for (const file of [
        "A.svelte",
        "lib/B.svelte",
        "lib/c.ts",
        "node_modules/pkg/D.svelte",
        ".cache/E.svelte",
      ]) {
        mkdirSync(join(root, file, ".."), { recursive: true });
        writeFileSync(join(root, file), "");
      }
      expect(glob(root, ["**/*.svelte"])).toEqual(["A.svelte", "lib/B.svelte"]);
      expect(glob(root, [".cache/*.svelte", "{lib,x}/*.ts"])).toEqual([
        ".cache/E.svelte",
        "lib/c.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
