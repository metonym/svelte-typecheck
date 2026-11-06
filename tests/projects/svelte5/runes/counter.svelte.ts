export function counter(start: number) {
  let count = $state(start);
  const label: number = $derived(`#${count}`);
  return {
    get count() {
      return count;
    },
    label,
  };
}
