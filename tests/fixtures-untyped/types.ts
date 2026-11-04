import type Plain from "./Plain.svelte";
import type { PlainProps } from "./Plain.svelte";

export type Instance = Plain;
export type Generic = Plain<string, number>;
export type Props = PlainProps<"a">;
