import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  compileAll,
  compileFilesOffThread,
  compileKey,
  compileOffThread,
  compilerDiagnostics,
  svelteDirOf,
  withEdits,
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

describe("compileAll without the hooks a component doesn't reach", () => {
  it("hands a preprocessor only the components with a tag it reads", async () => {
    const dir = join(root, "tests/.tmp/compile-untouched");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    // Counts the styles it's handed, on this thread's global.
    await writeFile(
      join(dir, "svelte.config.js"),
      "export default { preprocess: [{ name: 'counting', style: () => { globalThis.__styles = (globalThis.__styles ?? 0) + 1; } }] };\n",
    );
    const img = '<img src="a.png">\n';
    // And counts the components Svelte's `preprocess` is called on.
    const compiler = createRequire(join(svelteDirOf(root), "package.json"))(
      "svelte/compiler",
    ) as { preprocess: (...args: unknown[]) => Promise<unknown> };
    const preprocess = compiler.preprocess;
    let preprocessed = 0;
    compiler.preprocess = (...args) => {
      preprocessed++;
      return preprocess(...args);
    };
    const { results } = await compileAll({
      svelteDir: svelteDirOf(root),
      configDir: dir,
      components: [
        { source: img, filename: "Plain.svelte" },
        {
          source: `${img}<style>img { color: red; }</style>\n`,
          filename: "Styled.svelte",
        },
      ],
    });
    compiler.preprocess = preprocess;
    expect(preprocessed).toBe(1);
    expect((globalThis as { __styles?: number }).__styles).toBe(1);
    expect(results.map((r) => r.map((d) => `${d.line} ${d.code}`))).toEqual([
      ["1 a11y_missing_attribute"],
      ["1 a11y_missing_attribute"],
    ]);
  });
});

describe("compileFilesOffThread", () => {
  it("compiles the files it reads on the worker, as here", async () => {
    const configDir = join(root, "tests/.tmp/compile-files");
    await rm(configDir, { recursive: true, force: true });
    await mkdir(configDir, { recursive: true });
    // Records the thread that loads it.
    await writeFile(
      join(configDir, "svelte.config.js"),
      'import { writeFileSync } from "node:fs";\nimport { isMainThread } from "node:worker_threads";\nwriteFileSync(new URL("./thread", import.meta.url), isMainThread ? "main" : "worker");\nexport default {};\n',
    );
    const source = '<img src="a.png">\n';
    await writeFile(join(configDir, "Img.svelte"), source);
    const request = {
      svelteDir: svelteDirOf(root),
      configDir,
      files: [{ path: join(configDir, "Img.svelte"), filename: "Img.svelte" }],
    };
    const compiled = await compileFilesOffThread(request)?.wait();
    expect(compiled?.results[0]?.map((d) => d.code)).toEqual([
      "a11y_missing_attribute",
    ]);
    // The key the run keeps the result by: the text it read.
    expect(compiled?.keys).toEqual([compileKey("Img.svelte", source)]);
    expect(await readFile(join(configDir, "thread"), "utf-8")).toBe("worker");
    const { files, ...rest } = request;
    expect(compiled?.results).toEqual(
      (
        await compileAll({
          ...rest,
          components: files.map((f) => ({ ...f, source })),
        })
      ).results,
    );
  }, 30_000);
});

describe("configNeedsChdir", () => {
  it("knows the cwd through a symlink", async () => {
    const link = join(root, "tests/.tmp/kit-link");
    await rm(link, { force: true });
    await symlink(join(root, "tests/fixtures-kit"), link);
    const cwd = process.cwd();
    process.chdir(join(root, "tests/fixtures-kit"));
    try {
      expect(configNeedsChdir(link)).toBe(false);
      expect(configNeedsChdir(link, join(link, "vite.config.ts"))).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("withEdits", () => {
  const warning = (code: string) => [
    { severity: "warning" as const, code, message: "", line: 1, column: 1 },
  ];
  const early = {
    keys: ["a", "b", "c"],
    results: [warning("one"), warning("two"), warning("three")],
  };

  it("keeps the worker's results when it read what the run read", async () => {
    let asked = false;
    const result = await withEdits(early, ["a", "b", "c"], async () => {
      asked = true;
      return [];
    });
    expect(asked).toBe(false);
    expect(result.results).toEqual(early.results);
  });

  it("compiles again each component edited since the worker read it", async () => {
    const asked: number[][] = [];
    const result = await withEdits(early, ["a", "B", "C"], async (edited) => {
      asked.push(edited);
      return [warning("two again"), warning("three again")];
    });
    expect(asked).toEqual([[1, 2]]);
    expect(result.results).toEqual([
      warning("one"),
      warning("two again"),
      warning("three again"),
    ]);
  });
});
