// Values from outside the type system (parsed JSON, a thrown value, a
// loaded module) are read through these, so each field is checked where
// it's read instead of the whole value being cast.

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const field = (value: unknown, key: string): unknown =>
  isRecord(value) || value instanceof Error
    ? Reflect.get(value, key)
    : undefined;

export const stringOf = (value: unknown, key: string): string | undefined => {
  const found = field(value, key);
  return typeof found === "string" ? found : undefined;
};

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const errorOf = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const codeOf = (error: unknown): string | undefined =>
  stringOf(error, "code");

export const positionOf = (
  value: unknown,
): { line: number; column: number } | undefined => {
  const line = field(value, "line");
  const column = field(value, "column");
  return typeof line === "number" && typeof column === "number"
    ? { line, column }
    : undefined;
};

// Unchecked, for what this version of svelte-typecheck wrote itself: a
// cache keyed by its version and fingerprint, or a message between its own
// processes, so the key it's read by already says it has this shape.
export function ownWrite<T>(value: unknown): T {
  // eslint-disable-next-line typescript/consistent-type-assertions, no-restricted-syntax -- written by this same version, as its key says
  return value as T;
}
