import { estimateNodeSize } from "./dagre-schema-layout.js";

const MARGINX = 48;
const MARGINY = 48;
const H_GAP = 40;
const V_GAP = 40;

/**
 * 横向：按服务端注册 model 顺序（/admin/models 返回顺序）一列一列往右排
 * 纵向：遇到外键/关系边时，子端（有 FK 的表 / M2M 的 through）相对另一端向下错一行
 * 合成 M2M 中间表：x 取 Book 与 M2M 另一侧主表卡片的水平中点，避免 Category 在右侧而线从左侧绕回来的观感
 *
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {string[]} modelOrder 仅含已注册表的 table 名，顺序与 API 一致
 * @returns {{ positions: Record<string, { x: number, y: number, w: number, h: number }>, graphW: number, graphH: number }}
 */
export function buildRegisterOrderPositions(nodes, edges, modelOrder) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { positions: {}, graphW: 400, graphH: 300 };
  }

  const byTable = new Map(nodes.map((n) => [n.table, n]));
  const sizes = new Map();
  let maxW = 300;
  for (const n of nodes) {
    const s = estimateNodeSize(n);
    sizes.set(n.table, s);
    maxW = Math.max(maxW, s.w);
  }
  const colStep = maxW + H_GAP;

  const regIndex = new Map();
  (modelOrder || []).forEach((t, i) => {
    regIndex.set(t, i);
  });

  /** @type {Map<string, number>} */
  const x = new Map();
  for (const t of modelOrder || []) {
    if (!byTable.has(t)) {
      continue;
    }
    const i = regIndex.get(t) ?? 0;
    x.set(t, MARGINX + i * colStep);
  }

  const synthetic = new Set(nodes.filter((n) => n.synthetic).map((n) => n.table));

  for (const n of nodes) {
    if (!n.synthetic) {
      continue;
    }
    const through = n.table;
    const m2m = edges.find(
      (e) => e.toTable === through && e.kind === "many_to_many"
    );
    if (!m2m) {
      const i = nRegIndexFallback(modelOrder, through);
      x.set(through, MARGINX + i * colStep);
      continue;
    }
    const fromMain = m2m.fromTable;
    const fkToOther = edges.find(
      (e) =>
        e.fromTable === through &&
        e.kind === "foreign_key" &&
        e.toField === "id" &&
        e.toTable !== fromMain
    );
    if (!fkToOther) {
      const wFrom = sizes.get(fromMain)?.w ?? maxW;
      const x0 = (x.get(fromMain) ?? MARGINX) + wFrom + H_GAP;
      x.set(through, x0);
    } else {
      const otherT = fkToOther.toTable;
      const sL = sizes.get(fromMain) ?? { w: maxW, h: 200 };
      const sR = sizes.get(otherT) ?? { w: maxW, h: 200 };
      const sT = sizes.get(through) ?? { w: maxW, h: 200 };
      const xL = x.get(fromMain) ?? 0;
      const xR = x.get(otherT) ?? 0;
      const cMid = (xL + sL.w / 2 + xR + sR.w / 2) / 2;
      x.set(through, cMid - sT.w / 2);
    }
  }

  /** @type {Map<string, number>} */
  const level = new Map();
  for (const n of nodes) {
    level.set(n.table, 0);
  }

  const layoutEdges = edges.filter(
    (e) => !(e.kind === "foreign_key" && synthetic.has(e.fromTable))
  );

  const nIters = nodes.length + 2;
  for (let k = 0; k < nIters; k += 1) {
    for (const e of layoutEdges) {
      if (!byTable.has(e.fromTable) || !byTable.has(e.toTable)) {
        continue;
      }
      if (e.kind === "many_to_many") {
        const up = e.fromTable;
        const down = e.toTable;
        level.set(down, Math.max(level.get(down) ?? 0, (level.get(up) ?? 0) + 1));
      } else if (e.kind === "foreign_key" || e.kind === "one_to_one") {
        const child = e.fromTable;
        const par = e.toTable;
        level.set(child, Math.max(level.get(child) ?? 0, (level.get(par) ?? 0) + 1));
      }
    }
  }

  const maxH = Math.max(200, ...nodes.map((n) => (sizes.get(n.table)?.h) ?? 200));
  const rowStride = maxH + V_GAP;

  /** @type {Record<string, { x: number, y: number, w: number, h: number }>} */
  const positions = {};
  for (const n of nodes) {
    const t = n.table;
    const { w, h } = sizes.get(t) ?? { w: maxW, h: maxH };
    const y = MARGINY + (level.get(t) ?? 0) * rowStride;
    positions[t] = {
      x: x.get(t) ?? MARGINX,
      y,
      w,
      h
    };
  }

  let graphW = MARGINX * 2;
  let graphH = MARGINY * 2;
  for (const n of nodes) {
    const p = positions[n.table];
    if (p) {
      graphW = Math.max(graphW, p.x + p.w);
      graphH = Math.max(graphH, p.y + p.h);
    }
  }
  graphW += MARGINX;
  graphH += MARGINY;

  return { positions, graphW, graphH };
}

/**
 * @param {string[] | undefined} modelOrder
 * @param {string} table
 */
function nRegIndexFallback(modelOrder, table) {
  if (!Array.isArray(modelOrder) || !modelOrder.length) {
    return 0;
  }
  const i = modelOrder.indexOf(table);
  if (i >= 0) {
    return i;
  }
  return modelOrder.length;
}
