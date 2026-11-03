import { join } from "node:path";
import { typecheck } from "../src/check.ts";
import { checkerCommand } from "../src/checker.ts";

const root = join(import.meta.dir, "..");

describe("checkerCommand", () => {
  it("runs the project's TypeScript launcher on the current runtime", () => {
    const tsc = checkerCommand("tsc", root);
    expect(tsc?.command).toBe(process.execPath);
    expect(tsc?.prefix[0]).toEndWith(
      join("node_modules", "typescript", "bin", "tsc"),
    );
    expect(tsc?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("finds a package installed above the project", () => {
    expect(checkerCommand("tsc", join(root, "tests/fixtures"))?.version).toBe(
      checkerCommand("tsc", root)?.version,
    );
  });
});

describe("typecheck", () => {
  it("defaults to the project's TypeScript", async () => {
    const result = await typecheck({
      cwd: root,
      workspace: "tests/fixtures",
      outDir: "node_modules/.cache/svelte-typecheck/test-default",
    });
    expect(result.checker).toBe("tsc");
  }, 30_000);
});
