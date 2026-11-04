import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dir = join(root, "tests/.tmp/baseline");

const cli = (...args: string[]) =>
  spawnSync(
    process.execPath,
    [join(root, "src/cli.ts"), "--output", "human", "--no-color", ...args],
    { cwd: dir, encoding: "utf-8" },
  );

describe("--baseline", () => {
  it("reports only what's new since the baseline, through edits that move lines", () => {
    rmSync(dir, { recursive: true, force: true });
    cpSync(join(root, "tests/fixtures"), dir, { recursive: true });
    const written = cli("--baseline", "baseline.json", "--update-baseline");
    expect(written.status).toBe(0);
    const baseline = JSON.parse(
      readFileSync(join(dir, "baseline.json"), "utf-8"),
    );
    expect(baseline.version).toBe(1);
    // The fixtures' 12 errors and a warning, as paths in the workspace.
    expect(baseline.diagnostics.map((d: { file: string }) => d.file)).toContain(
      "Errors.svelte",
    );

    const clean = cli("--baseline", "baseline.json");
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("13 more in the baseline, not shown");

    // A line above the errors moves them; a new error is reported alone.
    const errors = join(dir, "Errors.svelte");
    const source = readFileSync(errors, "utf-8");
    writeFileSync(
      errors,
      source.replace(
        "</script>",
        '  // moved\n  const planted: number = "new";\n</script>',
      ),
    );
    const fresh = cli("--baseline", "baseline.json");
    expect(fresh.status).toBe(1);
    expect(fresh.stdout).toContain("svelte-typecheck found 1 error");
    expect(fresh.stdout).toContain("Errors.svelte:10:9");

    // A fixed one is counted, to drop from the baseline.
    writeFileSync(errors, source.replace("missing", "count"));
    expect(cli("--baseline", "baseline.json").stdout).toContain(
      "1 in the baseline are fixed",
    );
  }, 60_000);
});
