# Bring your own checker

svelte-typecheck doesn't bundle or import TypeScript. It writes the generated code and a tsconfig to disk and runs a checker on them as a separate process, so any of these works, at whatever version your project installs:

| `--checker` | Install                                                                                     | Runs                                               | Notes                                                                                                                                   |
| :---------- | :------------------------------------------------------------------------------------------ | :------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc`       | `typescript`                                                                                | `tsc -p <generated tsconfig> --pretty false`       | The default. TypeScript 7's `tsc` is native; with 6, JS files' JSDoc reads as svelte-check reads it                                     |
| `tsgo`      | TypeScript 7: `@typescript/native` (an alias), `@typescript/native-preview` or `typescript` | `tsc -p … --pretty false` (`tsgo` for the preview) | The first of these installed; `typescript` only if it's 7. svelte-check's `--tsgo` looks for the first two. `--tsgo` picks this checker |
| `tsrs`      | [`tsrs`](https://github.com/oxc-project/tsrs)                                               | `tsrs -p … --pretty false`                         | oxc's Rust port of TypeScript 7                                                                                                         |
| `bun`       | [Bun](https://bun.sh) 1.4                                                                   | `bun check -p … --no-pretty --all`                 | Bun's own TypeScript; no build cache, so it checks the whole program after a change                                                     |

```sh
svelte-typecheck                    # your project's typescript: tsc
svelte-typecheck --checker tsgo     # or tsrs, or bun
```

```ts
const result = await typecheck({ checker: "tsrs" });
result.checker; // "tsrs"
result.checkerVersion; // "0.20.1", from its package.json
```

## How a checker is found and run

| Step      | What happens                                                                                                                                                                                                                                                                                                                                                    |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pick      | `--checker`, or else the first of `tsc`, `tsgo`, `tsrs`, `bun` that's installed: your project's own TypeScript when it has one                                                                                                                                                                                                                                  |
| Find      | Its package in `node_modules`, from the workspace up, as Node resolves one (a hoisted install counts), then its `bin` in the package's `package.json`; failing that, the command on `PATH` (on Windows, by `PATHEXT`: `tsc.cmd`, `bun.exe`). `bun` is the running Bun, if svelte-typecheck runs on Bun                                                          |
| Launch    | tsgo, tsrs and TypeScript 7's `tsc` start their native binary directly, found with the package's own lookup, as their launcher would. TypeScript 6's Node launcher runs on the current runtime, Node or Bun, rather than through its shebang, so it works on Windows too; a native binary on `PATH` runs directly; a Windows `.cmd` shim runs through the shell |
| Configure | The generated tsconfig `extends` yours, so your compiler options (`strict`, `paths`, `lib`, `types`…) apply. It adds the generated code to `files` and `rootDirs`, and sets `noEmit` and its own `incremental` build info, so your files are never written                                                                                                      |
| Read      | The checker prints errors as `tsc` does, `file(line,col): error TSxxxx: message`; each one maps back to its `.svelte` line, or to your TS file as it is. An error that names no file (a bad option) is reported on your tsconfig                                                                                                                                |

Any version works as long as it reads a tsconfig and prints `tsc`'s format: to pin one, install it in the project. TypeScript 7 reads JSDoc in JS files more strictly than 6, so a JS codebase's error count can move a little between them.
