const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGITS = new Map([...BASE64].map((char, i) => [char, i]));

/** One mapping: generated column, original line and column (0-based). */
type Segment = [column: number, line: number, originalColumn: number];

/** The VLQ-encoded `mappings` of a source map, line by line. */
function decode(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let line = 0;
  let originalColumn = 0;
  for (const encoded of mappings.split(";")) {
    const segments: Segment[] = [];
    let column = 0;
    for (const segment of encoded.split(",")) {
      if (!segment) continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = DIGITS.get(char) ?? 0;
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      column += fields[0] ?? 0;
      if (fields.length < 4) continue;
      line += fields[2] ?? 0;
      originalColumn += fields[3] ?? 0;
      segments.push([column, line, originalColumn]);
    }
    lines.push(segments);
  }
  return lines;
}

/**
 * Maps a 1-based line and column in generated code back to the original,
 * through a source map; unmapped positions come back as they are.
 */
export function originalPosition(
  map: { mappings: string } | undefined,
): (line: number, column: number) => { line: number; column: number } {
  if (!map) return (line, column) => ({ line, column });
  const lines = decode(map.mappings);
  return (line, column) => {
    const segments = lines[line - 1] ?? [];
    let found: Segment | undefined;
    for (const segment of segments) {
      if (segment[0] > column - 1) break;
      found = segment;
    }
    if (!found) return { line, column };
    return {
      line: found[1] + 1,
      column: found[2] + (column - 1 - found[0]) + 1,
    };
  };
}
