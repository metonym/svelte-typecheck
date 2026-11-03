import MagicString from "magic-string";

const STRIP = /<!-- strip -->[\s\S]*?<!-- \/strip -->/g;

/** Removes `<!-- strip -->` blocks and `#!custom` in `<style lang="custom">`, with source maps. */
export default {
  preprocess: [
    {
      markup({ content, filename }) {
        const s = new MagicString(content);
        for (const m of content.matchAll(STRIP))
          s.remove(m.index, m.index + m[0].length);
        return { code: s.toString(), map: s.generateMap({ source: filename, hires: true }) };
      },
      style({ content, attributes, filename }) {
        if (attributes.lang !== "custom") return;
        const s = new MagicString(content);
        const at = content.indexOf("#!custom");
        if (at !== -1) s.remove(at, at + "#!custom".length);
        return { code: s.toString(), map: s.generateMap({ source: filename, hires: true }) };
      },
    },
  ],
};
