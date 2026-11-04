import { sveltekit } from "@sveltejs/kit/vite";
import MagicString from "magic-string";

const STRIP = /<!-- strip -->[\s\S]*?<!-- \/strip -->/g;

export default {
  plugins: [
    sveltekit({
      compilerOptions: { experimental: { async: true } },
      preprocess: [
        {
          markup({ content, filename }: { content: string; filename?: string }) {
            const s = new MagicString(content);
            for (const m of content.matchAll(STRIP))
              s.remove(m.index, m.index + m[0].length);
            return { code: s.toString(), map: s.generateMap({ source: filename, hires: true }) };
          },
        },
      ],
    }),
  ],
};
