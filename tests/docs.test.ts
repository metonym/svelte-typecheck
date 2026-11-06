import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emit } from "../src/emit.ts";
import { createLocator } from "../src/output.ts";

const root = join(import.meta.dir, "..");
const doc = readFileSync(join(root, "docs/architecture.md"), "utf-8");
const FENCE = /^```(\w*)\n([\s\S]*?)^```$/gm;
const blocks = [...doc.matchAll(FENCE)].map((m) => ({
  lang: m[1] ?? "",
  code: m[2] ?? "",
}));
/** Each component in How it works, and the block after it: its output. */
const samples = blocks.flatMap((block, i) => {
  const next = blocks[i + 1];
  return block.lang === "svelte" && next ? [{ source: block.code, next }] : [];
});

/**
 * Each sample's generated code as the doc shows it: through `bun fmt`,
 * which outside this repo formats with its defaults, as the doc's were.
 */
function formatted(): string[] {
  const dir = mkdtempSync(join(tmpdir(), "svelte-typecheck-docs-"));
  try {
    writeFileSync(join(dir, "package.json"), "{}");
    const files = samples.map(({ source, next }, i) => {
      const file = join(dir, `sample${i}.${next.lang}`);
      writeFileSync(file, emit(source).out.code);
      return file;
    });
    const fmt = spawnSync(process.execPath, ["fmt", ...files], { cwd: dir });
    if (fmt.status !== 0) throw new Error(`bun fmt: ${fmt.stderr}`);
    return files.map((file) => readFileSync(file, "utf-8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Lines without their indentation, and no blank ones. */
const lines = (code: string) =>
  code
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

describe("docs/architecture.md", () => {
  it("has the samples it describes", () => {
    expect(samples.map((s) => s.next.lang)).toEqual([
      "ts",
      "ts",
      "ts",
      "ts",
      "js",
    ]);
  });

  const outputs = formatted();
  it.each(
    samples.map((sample, i) => ({ ...sample, output: outputs[i] ?? "" })),
  )(
    "shows what the generator writes for sample %#",
    ({ next, output: code }) => {
      const output = lines(code);
      // The doc shows all of it, or the part a section is about: its lines,
      // whole and in order.
      expect(`\n${output.join("\n")}\n`).toContain(
        `\n${lines(next.code).join("\n")}\n`,
      );
    },
  );

  it("maps the error it shows from where the checker reports it", () => {
    // "If `items` in the first sample is `[1, 2]`".
    const source = (samples[0]?.source ?? "").replace('["a", "b"]', "[1, 2]");
    const { code } = emit(source).out;
    const generated = createLocator(code).position(code.indexOf("toUpperCase"));
    const original = createLocator(source).position(
      source.indexOf("toUpperCase"),
    );
    expect(doc).toContain(
      `++Counter.svelte.ts(${generated.line},${generated.column}): error TS2339`,
    );
    expect(doc).toContain(
      `src/Counter.svelte:${original.line}:${original.column} `,
    );
  });
});
