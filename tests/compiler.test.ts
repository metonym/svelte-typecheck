import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compileAll,
  compileOffThread,
  compilerDiagnostics,
  svelteDirOf,
} from "../src/compiler.ts";
import { configNeedsChdir } from "../src/config.ts";

const root = join(import.meta.dir, "..");

describe("compilerDiagnostics", () => {
  it("reports an a11y warning where it is", () => {
    const [warning] = compilerDiagnostics(
      '<div>\n  <img src="a.png">\n</div>\n',
      "Img.svelte",
    );
    expect(warning).toMatchObject({
      severity: "warning",
      code: "a11y_missing_attribute",
      line: 2,
      column: 3,
    });
  });

  it("honors `svelte-ignore`", () => {
    const source =
      '<!-- svelte-ignore a11y_missing_attribute -->\n<img src="a.png">\n';
    expect(compilerDiagnostics(source, "Img.svelte")).toEqual([]);
  });

  it("reports invalid markup as an error", () => {
    const [error] = compilerDiagnostics(
      '<div a="1" a="2"></div>\n',
      "Dup.svelte",
    );
    expect(error).toMatchObject({
      severity: "error",
      code: "attribute_duplicate",
    });
  });
});

describe("compileOffThread", () => {
  it("compiles on a worker as here, after the config's preprocessors", async () => {
    const configDir = join(root, "tests/fixtures-preprocess");
    const request = {
      svelteDir: svelteDirOf(root),
      configDir,
      components: [
        {
          source: readFileSync(join(configDir, "Styled.svelte"), "utf-8"),
          filename: "Styled.svelte",
        },
      ],
    };
    const offThread = compileOffThread(request);
    expect(offThread).toBeDefined();
    const results = (await offThread)?.results;
    // The stripped block moved the warning up 5 lines; mapped back.
    expect(results?.[0]?.map((d) => `${d.line} ${d.code}`)).toEqual([
      "10 a11y_missing_attribute",
    ]);
    expect(results).toEqual((await compileAll(request)).results);
  }, 30_000);

  it("loads the config on the worker, not here", async () => {
    const configDir = join(root, "tests/.tmp/compile-worker");
    await rm(configDir, { recursive: true, force: true });
    await mkdir(configDir, { recursive: true });
    // Records the thread that loads it.
    await writeFile(
      join(configDir, "svelte.config.js"),
      'import { writeFileSync } from "node:fs";\nimport { isMainThread } from "node:worker_threads";\nwriteFileSync(new URL("./thread", import.meta.url), isMainThread ? "main" : "worker");\nexport default {};\n',
    );
    const compiled = await compileOffThread({
      svelteDir: svelteDirOf(root),
      configDir,
      components: [{ source: '<img src="a.png">\n', filename: "Img.svelte" }],
    });
    expect(compiled?.results[0]?.map((d) => d.code)).toEqual([
      "a11y_missing_attribute",
    ]);
    expect(await readFile(join(configDir, "thread"), "utf-8")).toBe("worker");
  }, 30_000);

  it("leaves a vite.config outside the cwd to this thread", () => {
    const configDir = join(root, "tests/fixtures-kit");
    expect(process.cwd()).not.toBe(configDir);
    expect(configNeedsChdir(configDir)).toBe(true);
    expect(configNeedsChdir(join(root, "tests/fixtures-preprocess"))).toBe(
      false,
    );
    expect(
      compileOffThread({
        svelteDir: svelteDirOf(root),
        configDir,
        components: [],
      }),
    ).toBeUndefined();
  });
});

describe("compileAll with a config's shape", () => {
  // A folder each: within one process, a config's import is cached.
  let dir = "";
  const component = { source: '<img src="a.png">\n', filename: "Img.svelte" };
  const config = async (name: string, text: string) => {
    dir = join(root, "tests/.tmp/compile-shape", name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "svelte.config.js"), text);
  };

  it("keeps no shape when a compiler option is a function", async () => {
    await config(
      "function",
      "export default { compilerOptions: { warningFilter: () => false } };\n",
    );
    const { results, shape } = await compileAll({
      svelteDir: svelteDirOf(root),
      configDir: dir,
      components: [component],
    });
    expect(results).toEqual([[]]);
    expect(shape).toBeUndefined();
  });

  it("loads the config for a markup preprocessor, whatever the component", async () => {
    // Removes the `<img>`, and its warning with it, once it runs.
    await config(
      "markup",
      'export default { preprocess: [{ markup: ({ content }) => ({ code: content.replace(/<img[^>]*>/, "") }) }] };\n',
    );
    const request = {
      svelteDir: svelteDirOf(root),
      configDir: dir,
      components: [component],
    };
    const { results, shape } = await compileAll(request);
    expect(results).toEqual([[]]);
    expect(shape?.preprocess).toEqual([{ name: "", hooks: ["markup"] }]);
    expect((await compileAll({ ...request, shape })).results).toEqual([[]]);
  });
});
