<template>
  <section class="schema-graph-view">
    <el-card class="panel schema-graph-panel" shadow="never">
      <div slot="header" class="panel-header">
        <div>
          <p class="eyebrow">Model graph</p>
          <h3>Tables &amp; relations</h3>
        </div>
        <div class="sg-header-actions">
          <el-button-group>
            <el-button size="mini" title="Zoom out" @click="zoomBy(0.9)">−</el-button>
            <el-button size="mini" title="Fit graph to view" @click="fitView">Fit</el-button>
            <el-button size="mini" title="Zoom in" @click="zoomBy(1.1)">+</el-button>
          </el-button-group>
          <el-button size="mini" :loading="loading" @click="load">Refresh</el-button>
          <el-button size="mini" @click="applyLayout">Reset layout</el-button>
        </div>
      </div>

      <p class="sg-hint">拖动画布空白处平移；滚轮缩放；拖动表卡片可微调。横向为服务端注册 model 顺序，外键与 M2M 中间表相对关联表向下错行。多对多仅画中间表外键行指向对端主键行，不画主表→中间表。</p>

      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
        class="error-alert"
      />

      <div v-if="loading" class="schema-graph-loading">Loading schema…</div>
      <div
        v-else
        ref="viewport"
        class="sg-viewport"
        @wheel.prevent="onWheel"
      >
        <div
          class="sg-surface"
          :class="{ 'sg-surface--grabbing': panning }"
          @pointerdown="onViewPointerDown"
        >
          <div class="sg-pan" :style="panStyle">
            <div class="sg-scale" :style="scaleStyle">
              <div
                ref="world"
                class="sg-world"
                :style="{
                  width: graphW + 'px',
                  height: graphH + 'px'
                }"
              >
                <svg
                  class="sg-grid-svg"
                  :width="graphW"
                  :height="graphH"
                  aria-hidden="true"
                >
                  <defs>
                    <pattern id="sg-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                      <path
                        d="M 24 0 L 0 0 0 24"
                        fill="none"
                        stroke="#e2e8f0"
                        stroke-width="0.5"
                      />
                    </pattern>
                  </defs>
                  <rect class="sg-world-bg" :width="graphW" :height="graphH" fill="url(#sg-grid)" />
                </svg>
                <svg
                  class="sg-edges"
                  :width="graphW"
                  :height="graphH"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="sg-arrow-fk"
                      viewBox="0 0 10 10"
                      refX="10"
                      refY="5"
                      markerWidth="8"
                      markerHeight="8"
                      orient="auto"
                      markerUnits="userSpaceOnUse"
                    >
                      <path d="M0,0 L10,5 L0,10 Z" fill="#2563eb" />
                    </marker>
                    <marker
                      id="sg-arrow-oto"
                      viewBox="0 0 10 10"
                      refX="10"
                      refY="5"
                      markerWidth="8"
                      markerHeight="8"
                      orient="auto"
                      markerUnits="userSpaceOnUse"
                    >
                      <path d="M0,0 L10,5 L0,10 Z" fill="#0284c7" />
                    </marker>
                    <marker
                      id="sg-arrow-m2m"
                      viewBox="0 0 10 10"
                      refX="10"
                      refY="5"
                      markerWidth="8"
                      markerHeight="8"
                      orient="auto"
                      markerUnits="userSpaceOnUse"
                    >
                      <path d="M0,0 L10,5 L0,10 Z" fill="#9333ea" />
                    </marker>
                  </defs>
                  <path
                    v-for="(seg, i) in edgePathList"
                    :key="i"
                    :d="seg.d"
                    fill="none"
                    :stroke="seg.stroke"
                    :stroke-width="seg.strokeWidth"
                    :stroke-dasharray="seg.dash == null ? undefined : seg.dash"
                    :marker-end="`url(#${seg.markerId})`"
                  />
                </svg>
                <div
                  v-for="n in nodes"
                  :key="n.table"
                  :data-table="n.table"
                  class="sg-card"
                  :class="{ 'sg-card--synth': n.synthetic, 'sg-card--drag': drag && drag.table === n.table }"
                  :style="cardStyle(n.table)"
                  @pointerdown.stop="onCardPointerDown(n.table, $event)"
                >
                  <el-card
                    :class="['sg-node-card', { 'schema-node-card--synth': n.synthetic }]"
                    shadow="never"
                  >
                    <div slot="header" class="schema-node-header">
                      <div>
                        <h4>{{ n.modelName }}</h4>
                        <p class="schema-node-table">{{ n.table }}</p>
                      </div>
                      <el-tag v-if="n.synthetic" size="mini" type="info">M2M</el-tag>
                    </div>
                    <ul class="field-list">
                      <li
                        v-for="(field, name) in n.fields"
                        :key="name"
                        :data-field-name="name"
                        :class="{
                          'field--fk': isFk(field),
                          'field--m2m': isM2m(field)
                        }"
                      >
                        <code class="field-name">{{ name }}</code>
                        <span class="field-type">{{ typeLabel(field) }}</span>
                      </li>
                    </ul>
                  </el-card>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-card>
  </section>
</template>

<script>
import { pathBetweenRect } from "../utils/dagre-schema-layout.js";
import { buildRegisterOrderPositions } from "../utils/register-order-layout.js";
import { buildSchemaGraph, fieldTypeLabel } from "../utils/schema-graph.js";
import { requestJson, adminApiUrl } from "../utils/request.js";

function edgeToMode(edge) {
  if (edge.kind === "many_to_many" && edge.toField == null) {
    return "m2mTarget";
  }
  return "in";
}

function curvePath(x1, y1, x2, y2) {
  const dx = Math.max(32, Math.abs(x2 - x1) * 0.4);
  const c1x = x1 + dx;
  const c2x = x2 - dx;
  return `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
}

export default {
  name: "SchemaGraphView",
  data() {
    return {
      loading: false,
      error: "",
      nodes: [],
      edges: [],
      tablePositions: {},
      graphW: 400,
      graphH: 300,
      panX: 0,
      panY: 0,
      scale: 1,
      panning: false,
      /** @type {null | { lastX: number, lastY: number }} */
      _panSession: null,
      /** @type {null | { table: string, lastX: number, lastY: number }} */
      drag: null,
      edgePathList: [],
      /** @type {number | null} */
      _rAFEdges: null,
      _resizeRO: null,
      _roWorldBound: false,
      /** 与 GET /admin/models 返回顺序一致（table key 顺序） */
      modelTableOrder: []
    };
  },
  computed: {
    panStyle() {
      return {
        transform: `translate(${this.panX}px, ${this.panY}px)`
      };
    },
    scaleStyle() {
      return {
        transform: `scale(${this.scale})`,
        transformOrigin: "0 0"
      };
    }
  },
  mounted() {
    this.load();
    this._resizeRO =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            this.scheduleEdgePaths();
          })
        : null;
  },
  beforeDestroy() {
    this.detachGlobalDrag();
    if (this._resizeRO) {
      this._resizeRO.disconnect();
    }
  },
  updated() {
    if (this._resizeRO && this.$refs.world && !this._roWorldBound) {
      this._resizeRO.observe(this.$refs.world);
      this._roWorldBound = true;
    }
  },
  methods: {
    typeLabel(field) {
      return fieldTypeLabel(field);
    },
    isFk(field) {
      return field && (field.kind === "foreign_key" || field.kind === "one_to_one");
    },
    isM2m(field) {
      return field && field.kind === "many_to_many";
    },
    cardStyle(table) {
      const p = this.tablePositions[table];
      if (!p) {
        return { display: "none" };
      }
      return {
        left: `${p.x}px`,
        top: `${p.y}px`,
        width: `${p.w}px`,
        height: `${p.h}px`
      };
    },
    /**
     * 世界（未缩放）坐标：相对 .sg-world 左上角的 px，与 SVG 一致
     * @param {"out"|"in"|"m2mTarget"} which out=字段行右侧, in=字段行左侧, m2mTarget=整张卡左缘中点
     */
    getFieldAnchorInWorld(table, fieldName, which) {
      const world = this.$refs.world;
      if (!world) {
        return null;
      }
      const s = this.scale;
      if (!s || s <= 0) {
        return null;
      }
      const wRect = world.getBoundingClientRect();
      const card = world.querySelector(`[data-table="${this.selEsc(table)}"]`);
      if (!card) {
        return null;
      }
      if (which === "m2mTarget") {
        const r = card.getBoundingClientRect();
        return {
          x: (r.left - wRect.left) / s,
          y: (r.top - wRect.top + r.height / 2) / s
        };
      }
      const row = fieldName
        ? card.querySelector(`[data-field-name="${this.selEsc(fieldName)}"]`)
        : null;
      if (row) {
        const fr = row.getBoundingClientRect();
        if (which === "out") {
          return {
            x: (fr.right - wRect.left) / s,
            y: (fr.top - wRect.top + fr.height / 2) / s
          };
        }
        return {
          x: (fr.left - wRect.left) / s,
          y: (fr.top - wRect.top + fr.height / 2) / s
        };
      }
      const r = card.getBoundingClientRect();
      if (which === "out") {
        return {
          x: (r.right - wRect.left) / s,
          y: (r.top - wRect.top + r.height / 2) / s
        };
      }
      return {
        x: (r.left - wRect.left) / s,
        y: (r.top - wRect.top + r.height / 2) / s
      };
    },
    selEsc(v) {
      if (v == null) {
        return "";
      }
      return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    },
    scheduleEdgePaths() {
      if (this._rAFEdges != null) {
        return;
      }
      this._rAFEdges = requestAnimationFrame(() => {
        this._rAFEdges = null;
        this.recomputeEdgePaths();
      });
    },
    recomputeEdgePaths() {
      if (!this.$refs.world || this.edges.length === 0) {
        this.edgePathList = [];
        return;
      }
      const list = [];
      for (const edge of this.edges) {
        if (edge.kind === "many_to_many") {
          continue;
        }
        const fromNode = this.nodes.find((n) => n.table === edge.fromTable);
        const isM2mLeg = edge.kind === "foreign_key" && fromNode && fromNode.synthetic;
        const fromPt = this.getFieldAnchorInWorld(edge.fromTable, edge.fromField, "out");
        const toMode = edgeToMode(edge);
        const toName = toMode === "m2mTarget" ? null : edge.toField || "id";
        const toWhich = toMode === "m2mTarget" ? "m2mTarget" : "in";
        const toPt = this.getFieldAnchorInWorld(edge.toTable, toName, toWhich);
        const fromB = this.tablePositions[edge.fromTable];
        const toB = this.tablePositions[edge.toTable];
        let d = "";
        if (fromPt && toPt) {
          d = curvePath(fromPt.x, fromPt.y, toPt.x, toPt.y);
        } else if (fromB && toB) {
          d = pathBetweenRect(fromB, toB, toMode);
        }
        if (!d) {
          continue;
        }
        const isOto = edge.kind === "one_to_one";
        const markerId = isM2mLeg ? "sg-arrow-m2m" : isOto ? "sg-arrow-oto" : "sg-arrow-fk";
        list.push({
          d,
          stroke: isM2mLeg ? "#9333ea" : isOto ? "#0284c7" : "#2563eb",
          strokeWidth: isM2mLeg ? 1.5 : 1.8,
          dash: isM2mLeg ? "6 4" : null,
          markerId
        });
      }
      this.edgePathList = list;
    },
    load() {
      this.loading = true;
      this.error = "";
      return requestJson(adminApiUrl("models"))
        .then((models) => {
          const list = Array.isArray(models) ? models : [];
          if (list.length === 0) {
            this.nodes = [];
            this.edges = [];
            this.tablePositions = {};
            this.modelTableOrder = [];
            return;
          }
          this.modelTableOrder = list.map((m) => m.key);
          return Promise.all(
            list.map((m) => requestJson(adminApiUrl(m.key, "meta")).then((meta) => ({ row: m, meta })))
          ).then((pairs) => {
            const metaByKey = {};
            for (const { row, meta } of pairs) {
              metaByKey[row.key] = meta;
            }
            const built = buildSchemaGraph(list, metaByKey);
            this.nodes = built.nodes;
            this.edges = built.edges;
            this.applyLayout();
          });
        })
        .catch((err) => {
          this.error = err.message || String(err);
        })
        .finally(() => {
          this.loading = false;
          this.$nextTick(() => {
            this.fitView();
            this.$nextTick(() => {
              this.scheduleEdgePaths();
              setTimeout(() => {
                this.scheduleEdgePaths();
              }, 100);
            });
          });
        });
    },
    applyLayout() {
      const { positions, graphW, graphH } = buildRegisterOrderPositions(
        this.nodes,
        this.edges,
        this.modelTableOrder
      );
      this.tablePositions = { ...positions };
      this.graphW = graphW;
      this.graphH = graphH;
      this.$nextTick(() => {
        this.scheduleEdgePaths();
      });
    },
    fitView() {
      this.$nextTick(() => {
        const el = this.$refs.viewport;
        if (!el || this.graphW <= 0 || this.graphH <= 0) {
          return;
        }
        const rw = el.clientWidth;
        const rh = el.clientHeight;
        if (rw < 10 || rh < 10) {
          return;
        }
        let s = Math.min(rw / this.graphW, rh / this.graphH) * 0.92;
        s = Math.max(0.12, Math.min(2.2, s));
        this.scale = s;
        this.panX = (rw - this.graphW * s) / 2;
        this.panY = (rh - this.graphH * s) / 2;
      });
    },
    zoomBy(factor) {
      const s = this.scale * factor;
      this.scale = Math.max(0.1, Math.min(2.8, s));
    },
    onWheel(e) {
      const el = this.$refs.viewport;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const before = this.scale;
      const next =
        e.deltaY > 0
          ? Math.max(0.1, this.scale * 0.9)
          : Math.min(2.8, this.scale * 1.1);
      this.scale = next;
      const r = before > 0 ? next / before : 1;
      this.panX = cx - (cx - this.panX) * r;
      this.panY = cy - (cy - this.panY) * r;
    },
    onViewPointerDown(e) {
      if (e.button !== 0) {
        return;
      }
      if (e.target && e.target.closest && e.target.closest(".sg-card")) {
        return;
      }
      this.panning = true;
      this._panSession = { lastX: e.clientX, lastY: e.clientY };
      this.attachGlobal("pointermove", this.onPanPointerMove);
      this.attachGlobal("pointerup", this.onPanPointerUp);
    },
    onPanPointerMove(e) {
      if (!this._panSession) {
        return;
      }
      this.panX += e.clientX - this._panSession.lastX;
      this.panY += e.clientY - this._panSession.lastY;
      this._panSession = { lastX: e.clientX, lastY: e.clientY };
    },
    onPanPointerUp() {
      this.panning = false;
      this._panSession = null;
      this.detachGlobal("pointermove", this.onPanPointerMove);
      this.detachGlobal("pointerup", this.onPanPointerUp);
    },
    onCardPointerDown(table, e) {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      this.drag = { table, lastX: e.clientX, lastY: e.clientY };
      this.attachGlobal("pointermove", this.onCardPointerMove);
      this.attachGlobal("pointerup", this.onCardPointerUp);
    },
    onCardPointerMove(e) {
      if (!this.drag) {
        return;
      }
      const { table, lastX, lastY } = this.drag;
      const dx = (e.clientX - lastX) / this.scale;
      const dy = (e.clientY - lastY) / this.scale;
      this.drag = { table, lastX: e.clientX, lastY: e.clientY };
      const t = this.tablePositions[table];
      if (!t) {
        return;
      }
      this.$set(this.tablePositions, table, {
        x: t.x + dx,
        y: t.y + dy,
        w: t.w,
        h: t.h
      });
      this.scheduleEdgePaths();
    },
    onCardPointerUp() {
      this.drag = null;
      this.detachGlobal("pointermove", this.onCardPointerMove);
      this.detachGlobal("pointerup", this.onCardPointerUp);
    },
    /** @param {"pointermove"|"pointerup"} name */
    attachGlobal(name, fn) {
      document.addEventListener(name, fn, true);
    },
    /** @param {"pointermove"|"pointerup"} name */
    detachGlobal(name, fn) {
      document.removeEventListener(name, fn, true);
    },
    detachGlobalDrag() {
      this.detachGlobal("pointermove", this.onCardPointerMove);
      this.detachGlobal("pointerup", this.onCardPointerUp);
      this.detachGlobal("pointermove", this.onPanPointerMove);
      this.detachGlobal("pointerup", this.onPanPointerUp);
    }
  }
};
</script>

<style scoped>
.schema-graph-view {
  display: block;
}

.schema-graph-panel {
  min-width: 0;
  position: relative;
}

.schema-graph-panel .panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 12px;
}

.schema-graph-panel .panel-header h3 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
}

.sg-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.sg-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
}

.schema-graph-loading {
  padding: 24px;
  color: #64748b;
}

.sg-viewport {
  max-height: min(72vh, 900px);
  min-height: 400px;
  height: 60vh;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  overflow: hidden;
  user-select: none;
  position: relative;
  touch-action: none;
}

.sg-surface {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.sg-surface--grabbing {
  cursor: grabbing;
}

.sg-pan {
  width: 100%;
  height: 100%;
  will-change: transform;
}

.sg-scale {
  will-change: transform;
}

.sg-world {
  position: relative;
  border-radius: 4px;
}

/* 网格在底层；连线在卡片之上，线才能从 author_id 行等位置「露出」在卡片上 */
.sg-grid-svg {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 0;
  pointer-events: none;
}

.sg-edges {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 12;
  overflow: visible;
  pointer-events: none;
}

.sg-edges path {
  pointer-events: none;
}

.sg-card {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  cursor: grab;
}

.sg-card--drag {
  cursor: grabbing;
  z-index: 10;
  /* 仍低于 .sg-edges(12)，以免拖动时外键线被本卡完全盖住 */
}

.sg-node-card,
.sg-node-card::v-deep .el-card__body,
.sg-node-card::v-deep .el-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.sg-node-card::v-deep .el-card__body {
  flex: 1 1 auto;
  overflow: auto;
  min-height: 0;
  padding: 12px 14px;
}

.schema-node-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.schema-node-header h4 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
}

.schema-node-table {
  margin: 4px 0 0;
  font-size: 11px;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  word-break: break-all;
}

.field-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.field-list li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  font-size: 11px;
}

.field--fk {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.field--m2m {
  border-color: #e9d5ff;
  background: #faf5ff;
}

.field-name {
  font-size: 12px;
  color: #0f172a;
}

.field-type {
  font-size: 10px;
  color: #475569;
  line-height: 1.3;
}

.eyebrow {
  color: #1e40af;
  font-weight: 700;
  margin: 0 0 4px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.error-alert {
  margin-bottom: 12px;
}

.schema-node-card--synth {
  border-style: dashed;
  background: #fafbfc;
}
</style>
