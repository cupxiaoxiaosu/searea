const DEFAULT_CARD_WIDTH = 300;

/**
 * 与表字段行、el-card 表头空间匹配，偏大一点避免底部被裁切
 * @param {object} node
 * @returns {{ w: number, h: number }}
 */
export function estimateNodeSize(node) {
  const w = DEFAULT_CARD_WIDTH;
  const n = node.fields && typeof node.fields === "object" ? Object.keys(node.fields).length : 0;
  const header = 90;
  const row = 48;
  const pad = 32;
  const h = Math.max(200, header + n * row + pad);
  return { w, h };
}

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} NodeBox
 * @param {NodeBox} fromB
 * @param {NodeBox} toB
 * @param {"out"|"in"|"m2mTarget"} toMode
 * @returns {string} SVG path d
 */
export function pathBetweenRect(fromB, toB, toMode) {
  if (!fromB || !toB) {
    return "";
  }
  const x1 = fromB.x + fromB.w;
  const y1 = fromB.y + fromB.h / 2;
  let x2;
  const y2 = toB.y + toB.h / 2;
  if (toMode === "m2mTarget") {
    x2 = toB.x;
  } else {
    const inset = 2;
    x2 = toB.x + inset;
  }
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
