interface Box {
  n: number;
}
let count = $state<number>(0);
const doubled: number = count * 2;
// svelte-ignore state_referenced_locally
const tripled = count * 3;
export const box: Box = { n: doubled + tripled };
