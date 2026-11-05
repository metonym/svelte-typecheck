# API

```ts
import {
  applyBaseline,
  compilerDiagnostics,
  createBaseline,
  typecheck,
} from "svelte-typecheck";

const { diagnostics, components, timings } = await typecheck({
  workspace: "src",
  checker: "tsgo",
});

// Svelte's own warnings and errors (a11y, unused CSS, invalid markup).
compilerDiagnostics(source, "Button.svelte");

// What's new since a baseline, in the files a change reaches.
const result = await typecheck({ only: ["src/Button.svelte"] });
const baseline = createBaseline(result.diagnostics, result.workspace);
applyBaseline(result.diagnostics, baseline, result.workspace).diagnostics; // []
```
