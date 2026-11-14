<script>
  import { createEventDispatcher } from "svelte";

  /**
   * @typedef {{ n: number }} Detail
   * @type {(d: Detail) => void}
   */
  const send = (d) => {};
  send({ n: "x" });

  /**
   * Sends a point.
   * @typedef {object} Point
   * @property {number} x
   * @property {number} y
   * @type {(p: Point) => number}
   */
  const sum = (p) => p.x + p.y;
  sum({ x: 1, y: "2" });

  /**
   * @callback Format
   * @param {number} value
   * @returns {string}
   * @type {Format}
   */
  const format = (value) => value;

  /**
   * @typedef {{ language: string }} HighlightDetail
   * @type {import("svelte").EventDispatcher<{ highlight: HighlightDetail }>}
   */
  const dispatch = createEventDispatcher();
  dispatch("highlight", { language: 1 });

  /**
   * @typedef {1 | 2} Scale
   * @typedef {Scale | "auto"} Spacing
   * @restProps {hr}
   */
  /** @type {Spacing} */
  export let spacing = 1;

  /** @typedef {{ ok: boolean }} Alone */
  /** @type {Alone} */
  const alone = { ok: "yes" };
</script>

{format(sum({ x: 1, y: 2 }))}
{alone.ok}
{spacing}
