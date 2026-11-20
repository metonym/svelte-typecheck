import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/**
 * Bun commands that run the package.json script of the same name, when
 * there is one, rather than doing their own work. `--no-script` skips
 * the script. A call inside that script itself reaches the command.
 */
const SHADOWED = /\bbun (check|lint|fmt)\b([^&|;]*)/g;

/** Each `script: bun command` call that a same-named script takes over. */
function shadowed(scripts: Record<string, string>): string[] {
  return Object.entries(scripts).flatMap(([name, body]) =>
    [...body.matchAll(SHADOWED)]
      .filter(
        ([, command = "", rest = ""]) =>
          command !== name &&
          command in scripts &&
          !rest.includes("--no-script"),
      )
      .map(([call]) => `${name}: ${call.trim()}`),
  );
}

describe("package.json scripts", () => {
  it("catch a call that a same-named script takes over", () => {
    // `bun run typecheck` ran the check script, which ran typecheck
    // again, so it never type-checked.
    expect(
      shadowed({ typecheck: "bun check", check: "bun run typecheck" }),
    ).toEqual(["typecheck: bun check"]);
    expect(
      shadowed({ typecheck: "bun check --no-script", check: "x" }),
    ).toEqual([]);
    expect(shadowed({ fmt: "bun fmt" })).toEqual([]);
  });

  it.each(["package.json", "bench/package.json", "eval/package.json"])(
    "in %s reach Bun's own commands",
    (file) => {
      const { scripts = {} } = JSON.parse(
        readFileSync(join(root, file), "utf-8"),
      ) as { scripts?: Record<string, string> };
      expect(shadowed(scripts)).toEqual([]);
    },
  );
});
