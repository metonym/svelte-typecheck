import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "../tests/fixtures");
const CORPUS = join(import.meta.dirname, "corpus");
const SIZE = 200;

/**
 * Writes `SIZE` copies of the clean fixtures (a component that uses a
 * child's props, events, slots, stores and bindings, and the child) to
 * `bench/corpus`, each pair under its own names. No errors, so a run
 * measures checking, not reporting.
 */
export async function corpus(): Promise<string> {
  if (existsSync(join(CORPUS, "tsconfig.json"))) return CORPUS;
  const [child, clean] = await Promise.all(
    ["Child.svelte", "Clean.svelte"].map((f) =>
      readFile(join(FIXTURES, f), "utf-8"),
    ),
  );
  await mkdir(CORPUS, { recursive: true });
  const writes = [
    writeFile(
      join(CORPUS, "tsconfig.json"),
      await readFile(join(FIXTURES, "tsconfig.json"), "utf-8"),
    ),
  ];
  for (let i = 0; i < SIZE; i++) {
    writes.push(
      writeFile(join(CORPUS, `Child${i}.svelte`), child ?? ""),
      writeFile(
        join(CORPUS, `Page${i}.svelte`),
        (clean ?? "").replaceAll("./Child.svelte", `./Child${i}.svelte`),
      ),
    );
  }
  await Promise.all(writes);
  return CORPUS;
}

/** The corpus's components, as `[name, source]`. */
export async function sources(): Promise<[string, string][]> {
  const dir = await corpus();
  return Promise.all(
    Array.from({ length: SIZE }, (_, i) => [`Page${i}`, `Child${i}`])
      .flat()
      .map(async (name): Promise<[string, string]> => [
        name,
        await readFile(join(dir, `${name}.svelte`), "utf-8"),
      ]),
  );
}
