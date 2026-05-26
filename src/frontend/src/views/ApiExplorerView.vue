<template>
  <div class="api-explorer" :class="{ 'is-left-collapsed': leftCollapsed }">
    <aside class="collections rail" :class="{ 'rail--collapsed': leftCollapsed }">
      <div class="rail-head">
        <div class="rail-brand">
          <span class="rail-logo">⌘</span>
          <div v-if="!leftCollapsed" class="rail-titles">
            <p class="rail-eyebrow">Collections</p>
            <p class="rail-title">API Explorer</p>
          </div>
        </div>
        <div class="rail-tools">
          <button type="button" class="icon-btn" :title="leftCollapsed ? '展开' : '收起'" @click="toggleLeft">
            <i :class="leftCollapsed ? 'el-icon-s-unfold' : 'el-icon-s-fold'" />
          </button>
          <button v-if="!leftCollapsed" type="button" class="icon-btn" title="刷新集合" @click="bootstrap">
            <i class="el-icon-refresh" />
          </button>
        </div>
      </div>

      <div v-if="!leftCollapsed" class="rail-search">
        <el-input
          v-model.trim="filterText"
          size="small"
          prefix-icon="el-icon-search"
          placeholder="Search collections"
          clearable
        />
      </div>

      <div v-loading="loadingModels" class="collections-tree">
        <div v-for="m in filteredModels" :key="m.key" class="folder">
          <button class="folder-row" type="button" @click="toggleOpen(m.key)">
            <i class="el-icon-arrow-right folder-caret" :class="{ open: isOpen(m.key) }" />
            <span v-if="!leftCollapsed" class="folder-name">{{ displayName(m) }}</span>
            <span v-if="!leftCollapsed" class="folder-key mono">{{ m.key }}</span>
          </button>
          <div v-show="isOpen(m.key)" class="folder-items">
            <button
              v-for="req in requestsByModelKey[m.key] || []"
              :key="req.id"
              type="button"
              class="req-row"
              :class="{ active: activeRequestId === req.id }"
              @click="activateRequest(req)"
            >
              <span class="method-chip" :data-method="req.method">{{ req.method }}</span>
              <span v-if="!leftCollapsed" class="req-name">{{ req.name }}</span>
            </button>
          </div>
        </div>
        <div v-if="!loadingModels && filteredModels.length === 0" class="collections-empty">
          No matches
        </div>
      </div>
    </aside>

    <section class="workbench">
      <div ref="workspace" class="workbench-stack">
        <div class="request-pane" :style="{ height: requestPanePx + 'px' }">
          <div class="request-url-shell">
            <div class="method-wrap" :data-method="draft.method">
              <el-select v-model="draft.method" size="small" class="method-dd" popper-class="method-dd-popper">
                <el-option v-for="m in METHODS" :key="m" :label="m" :value="m" />
              </el-select>
            </div>
            <el-input
              v-model="draft.url"
              size="small"
              class="url-field"
              placeholder="Enter request URL"
            />
            <div class="url-actions">
              <el-tooltip content="Copy full URL (with query)" placement="bottom">
                <button type="button" class="ghost-btn" :disabled="!previewUrl" @click="copyUrl">
                  <i class="el-icon-document-copy" />
                </button>
              </el-tooltip>
              <el-button type="primary" size="small" class="send-pill" :loading="sending" @click="send">
                Send
              </el-button>
            </div>
          </div>

          <div class="request-meta">
            <div class="breadcrumb mono">
              <span class="bc-muted">{{ activeRequest ? activeRequest.resourceKey : "…" }}</span>
              <span class="bc-sep">/</span>
              <span>{{ activeRequest ? activeRequest.name : "Request" }}</span>
            </div>
            <div class="case-tools">
              <span class="case-label">No Environment</span>
              <el-divider direction="vertical" />
              <span class="case-caption">Examples</span>
              <el-select v-model="activeCaseId" size="mini" class="case-dd" @change="onCaseChange">
                <el-option v-for="c in activeCases" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
              <button type="button" class="linkish" @click="cloneCase">Duplicate</button>
              <button type="button" class="linkish" @click="newCase">Add</button>
              <button
                type="button"
                class="linkish danger"
                :disabled="activeCases.length <= 1"
                @click="deleteCase"
              >
                Remove
              </button>
            </div>
          </div>

          <el-tabs v-model="activeReqTab" class="pm-tabs req-tabs">
            <el-tab-pane label="Params" name="params">
              <div class="tab-desc muted">Query parameters</div>
              <div class="kv-toolbar">
                <button type="button" class="link-btn" @click="addParam">+ Add param</button>
              </div>
              <el-table :data="draft.params" size="mini" class="pm-table kv-table" stripe>
                <el-table-column label="" width="48">
                  <template slot-scope="{ row }">
                    <el-checkbox v-model="row.enabled" />
                  </template>
                </el-table-column>
                <el-table-column label="KEY">
                  <template slot-scope="{ row }">
                    <el-input v-model="row.key" size="mini" placeholder="key" class="cell-input" />
                  </template>
                </el-table-column>
                <el-table-column label="VALUE">
                  <template slot-scope="{ row }">
                    <el-input v-model="row.value" size="mini" placeholder="value" class="cell-input" />
                  </template>
                </el-table-column>
                <el-table-column label="" width="72">
                  <template slot-scope="{ $index }">
                    <button type="button" class="linkish danger" @click="removeParam($index)">✕</button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="Headers" name="headers">
              <div class="tab-desc muted">Request headers</div>
              <div class="kv-toolbar">
                <button type="button" class="link-btn" @click="addHeader">+ Add header</button>
              </div>
              <el-table :data="draft.headers" size="mini" class="pm-table kv-table" stripe>
                <el-table-column label="" width="48">
                  <template slot-scope="{ row }">
                    <el-checkbox v-model="row.enabled" />
                  </template>
                </el-table-column>
                <el-table-column label="KEY">
                  <template slot-scope="{ row }">
                    <el-input v-model="row.key" size="mini" placeholder="header" class="cell-input" />
                  </template>
                </el-table-column>
                <el-table-column label="VALUE">
                  <template slot-scope="{ row }">
                    <el-input v-model="row.value" size="mini" placeholder="value" class="cell-input" />
                  </template>
                </el-table-column>
                <el-table-column label="" width="72">
                  <template slot-scope="{ $index }">
                    <button type="button" class="linkish danger" @click="removeHeader($index)">✕</button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="Body" name="body">
              <div class="body-toolbar">
                <span class="seg-label">raw</span>
                <span class="seg-muted">JSON</span>
                <span class="flex-spacer"></span>
                <button type="button" class="link-btn" @click="formatBody">Beautify</button>
                <button type="button" class="link-btn" @click="clearBody">Clear</button>
              </div>
              <el-input
                v-model="draft.bodyRaw"
                type="textarea"
                :autosize="{ minRows: 10, maxRows: 28 }"
                class="body-editor"
                :placeholder="bodyJsonPlaceholder"
              />
            </el-tab-pane>
          </el-tabs>
        </div>

        <div
          class="split-hit"
          title="Drag to resize"
          @mousedown.prevent="startSplitDrag"
        >
          <span class="split-grip"></span>
        </div>

        <div class="response-pane">
          <div class="response-toolbar">
            <div class="response-title">
              Response
              <span v-if="response.status != null" class="status-chip" :data-band="statusClass(response.status)">
                {{ response.status }}
              </span>
              <span v-else class="status-chip status-chip--idle">Idle</span>
              <span class="stat">{{ response.timeMs != null ? response.timeMs + " ms" : "" }}</span>
              <span class="stat">{{ response.sizeBytes != null ? formatBytes(response.sizeBytes) : "" }}</span>
            </div>
            <div class="response-actions">
              <button type="button" class="ghost-btn" :disabled="!response.rawText" @click="copyResponse">
                <i class="el-icon-document-copy" />
                Copy body
              </button>
            </div>
          </div>

          <el-tabs v-model="activeRespTab" class="pm-tabs resp-tabs">
            <el-tab-pane label="Body" name="body">
              <pre class="resp-body">{{ response.prettyBody || response.rawText || "" }}</pre>
            </el-tab-pane>
            <el-tab-pane label="Headers" name="headers">
              <pre class="resp-body">{{ response.prettyHeaders }}</pre>
            </el-tab-pane>
            <el-tab-pane label="Raw" name="raw">
              <pre class="resp-body">{{ response.rawText || "" }}</pre>
            </el-tab-pane>
          </el-tabs>
        </div>
      </div>
    </section>
  </div>
</template>

<script>
import { requestJson, adminApiUrl } from "../utils/request.js";
import { apiUrl } from "../config.js";

const STORAGE_KEY = "searea.api-explorer.v1";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const BODY_JSON_PLACEHOLDER = ["{", '  "field": "value"', "}"].join("\n");

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function safeJsonPretty(value) {
  try {
    if (typeof value === "string") {
      return JSON.stringify(JSON.parse(value), null, 2);
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function toQueryString(params) {
  const q = new URLSearchParams();
  for (const p of params || []) {
    if (!p || !p.enabled) continue;
    const k = String(p.key || "").trim();
    if (!k) continue;
    q.set(k, String(p.value ?? ""));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function normalizePath(p) {
  if (!p) return "";
  const s = String(p).trim();
  if (!s) return "";
  return s.startsWith("/") ? s : `/${s}`;
}

function buildDefaultBodyFromMeta(meta) {
  const fields = (meta && meta.fields) || {};
  const out = {};
  for (const [name, def] of Object.entries(fields)) {
    if (!def || def.kind === "auto") continue;
    if (Array.isArray(def.choices) && def.choices.length > 0) {
      const first = def.choices[0];
      if (first && Object.prototype.hasOwnProperty.call(first, "value")) {
        out[name] = first.value;
      }
      continue;
    }
    if (def.kind === "integer") out[name] = 0;
    else if (def.kind === "foreign_key") out[name] = 1;
    else out[name] = "";
  }
  return out;
}

export default {
  name: "ApiExplorerView",
  data() {
    return {
      METHODS,
      filterText: "",
      leftCollapsed: false,
      models: [],
      modelMetaByKey: {},
      openModels: new Set(),
      loadingModels: false,
      sending: false,
      activeReqTab: "params",
      activeRespTab: "body",
      requests: [],
      requestsById: {},
      activeRequestId: "",
      casesByRequestId: {},
      activeCaseIdByRequestId: {},
      activeCaseId: "",
      draft: {
        method: "GET",
        url: "/api/models",
        params: [],
        headers: [{ enabled: true, key: "content-type", value: "application/json" }],
        bodyRaw: "",
      },
      response: {
        status: null,
        timeMs: null,
        sizeBytes: null,
        rawText: "",
        prettyBody: "",
        prettyHeaders: "",
      },
      requestPanePx: 400,
      splitDragging: false,
      _splitStartY: 0,
      _splitStartH: 0,
      bodyJsonPlaceholder: BODY_JSON_PLACEHOLDER,
    };
  },
  computed: {
    filteredModels() {
      const q = String(this.filterText || "").toLowerCase().trim();
      if (!q) return this.models;
      return this.models.filter((m) => {
        const name = this.displayName(m).toLowerCase();
        return m.key.toLowerCase().includes(q) || name.includes(q);
      });
    },
    requestsByModelKey() {
      const out = {};
      for (const r of this.requests) {
        (out[r.resourceKey] ||= []).push(r);
      }
      return out;
    },
    activeRequest() {
      return this.activeRequestId ? this.requestsById[this.activeRequestId] : null;
    },
    activeCases() {
      return this.activeRequestId ? this.casesByRequestId[this.activeRequestId] || [] : [];
    },
    previewUrl() {
      const path = normalizePath(this.draft.url);
      if (!path) return "";
      const qs = toQueryString(this.draft.params);
      const rel = `${path}${qs}`;
      if (typeof window === "undefined" || !window.location || !window.location.origin) {
        return rel;
      }
      return `${window.location.origin}${rel}`;
    },
  },
  created() {
    this.restoreWorkspace();
    this.bootstrap();
  },
  mounted() {
    window.addEventListener("mousemove", this.onSplitDrag);
    window.addEventListener("mouseup", this.endSplitDrag);
    this.$nextTick(() => this.initSplitHeight());
  },
  beforeDestroy() {
    window.removeEventListener("mousemove", this.onSplitDrag);
    window.removeEventListener("mouseup", this.endSplitDrag);
  },
  methods: {
    toggleLeft() {
      this.leftCollapsed = !this.leftCollapsed;
      this.persistWorkspace();
    },
    statusClass(code) {
      if (code >= 200 && code < 300) return "ok";
      if (code >= 300 && code < 400) return "redirect";
      if (code >= 400 && code < 500) return "client";
      if (code >= 500) return "server";
      return "unknown";
    },
    formatBytes(n) {
      const x = Number(n);
      if (!Number.isFinite(x) || x < 0) return "";
      if (x < 1024) return `${x} B`;
      if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
      return `${(x / (1024 * 1024)).toFixed(2)} MB`;
    },
    initSplitHeight() {
      const el = this.$refs.workspace;
      if (!el || typeof el.clientHeight !== "number" || el.clientHeight <= 0) return;
      const h = el.clientHeight;
      const split = 10;
      const target = Math.round(h * 0.56);
      const max = h - split - 160;
      this.requestPanePx = Math.min(Math.max(220, target), Math.max(220, max));
    },
    startSplitDrag(e) {
      this.splitDragging = true;
      this._splitStartY = e.clientY;
      this._splitStartH = this.requestPanePx;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    onSplitDrag(e) {
      if (!this.splitDragging) return;
      const el = this.$refs.workspace;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const split = 10;
      const delta = e.clientY - this._splitStartY;
      let next = this._splitStartH + delta;
      const minTop = 200;
      const maxTop = Math.max(minTop, rect.height - split - 140);
      next = Math.min(Math.max(next, minTop), maxTop);
      this.requestPanePx = next;
    },
    endSplitDrag() {
      if (!this.splitDragging) return;
      this.splitDragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    copyUrl() {
      const url = this.previewUrl;
      if (!url) return;
      navigator.clipboard
        .writeText(url)
        .then(() => this.$message.success("URL copied"))
        .catch(() => this.$message.error("Copy failed"));
    },
    displayName(m) {
      const a = m && m.admin;
      return (a && a.label) || m.modelName || m.key;
    },
    isOpen(modelKey) {
      return this.openModels.has(modelKey);
    },
    toggleOpen(modelKey) {
      const next = new Set(this.openModels);
      if (next.has(modelKey)) next.delete(modelKey);
      else next.add(modelKey);
      this.openModels = next;
      this.persistWorkspace();
    },
    async bootstrap() {
      this.loadingModels = true;
      try {
        const list = await requestJson(adminApiUrl("models"));
        this.models = Array.isArray(list) ? list : [];
        if (this.models.length) {
          const next = new Set(this.openModels);
          next.add(this.models[0].key);
          this.openModels = next;
        }
        await this.ensureMetaLoadedForModels(this.models.map((m) => m.key));
        this.buildRequestsAndCases();
        if (!this.activeRequestId && this.requests.length) {
          this.activateRequest(this.requests[0]);
        } else if (this.activeRequestId && this.activeRequest) {
          this.activateRequest(this.activeRequest);
        }
      } catch (e) {
        this.$message.error(e.message || String(e));
      } finally {
        this.loadingModels = false;
        this.$nextTick(() => this.initSplitHeight());
      }
    },

    async ensureMetaLoadedForModels(keys) {
      const missing = keys.filter((k) => !this.modelMetaByKey[k]);
      await Promise.all(
        missing.map((k) =>
          requestJson(adminApiUrl(k, "meta"))
            .then((meta) => {
              this.$set(this.modelMetaByKey, k, meta);
            })
            .catch(() => {})
        )
      );
    },

    buildRequestsAndCases() {
      const reqs = [];
      const reqById = {};
      const casesByReq = this.casesByRequestId || {};
      const activeCaseMap = this.activeCaseIdByRequestId || {};

      const createReq = (resourceKey, name, method, urlTemplate) => {
        const id = `${resourceKey}:${method}:${name}`; // stable id for localStorage
        const req = { id, resourceKey, name, method, urlTemplate };
        reqs.push(req);
        reqById[id] = req;
        if (!casesByReq[id] || casesByReq[id].length === 0) {
          casesByReq[id] = this.defaultCasesForRequest(req);
        }
        if (!activeCaseMap[id] && casesByReq[id] && casesByReq[id].length) {
          activeCaseMap[id] = casesByReq[id][0].id;
        }
      };

      for (const m of this.models) {
        const key = m.key;
        createReq(key, "List", "GET", apiUrl(`/${key}`));
        createReq(key, "Get Item", "GET", apiUrl(`/${key}/:id`));
        createReq(key, "Create", "POST", apiUrl(`/${key}`));
        createReq(key, "Patch", "PATCH", apiUrl(`/${key}/:id`));
        createReq(key, "Delete", "DELETE", apiUrl(`/${key}/:id`));
      }

      this.requests = reqs;
      this.requestsById = reqById;
      this.casesByRequestId = casesByReq;
      this.activeCaseIdByRequestId = activeCaseMap;
      this.persistWorkspace();
    },

    defaultCasesForRequest(req) {
      const meta = this.modelMetaByKey[req.resourceKey] || {};
      const fkNames = Object.entries((meta && meta.fields) || {})
        .filter(([, d]) => d && d.kind === "foreign_key")
        .map(([n]) => n);

      const base = {
        id: uid(),
        name: "default",
        method: req.method,
        url: req.urlTemplate,
        params: [],
        headers: [{ enabled: true, key: "content-type", value: "application/json" }],
        bodyRaw: "",
      };

      if (req.name === "List") {
        const cases = [
          { ...base, id: uid(), name: "default" },
          {
            ...base,
            id: uid(),
            name: "paging",
            params: [
              { enabled: true, key: "page", value: "1" },
              { enabled: true, key: "pageSize", value: "20" },
            ],
          },
        ];
        if (fkNames.length) {
          cases.push({
            ...base,
            id: uid(),
            name: "expand",
            params: [{ enabled: true, key: "expand", value: fkNames.slice(0, 3).join(",") }],
          });
        }
        cases.push({
          ...base,
          id: uid(),
          name: "invalid (page)",
          params: [{ enabled: true, key: "page", value: "abc" }],
        });
        return cases;
      }

      if (req.name === "Get Item") {
        return [
          { ...base, id: uid(), name: "id=1", url: req.urlTemplate.replace(":id", "1") },
          { ...base, id: uid(), name: "invalid id", url: req.urlTemplate.replace(":id", "abc") },
        ];
      }

      if (req.name === "Create") {
        const body = buildDefaultBodyFromMeta(meta);
        return [
          { ...base, id: uid(), name: "default", bodyRaw: JSON.stringify(body, null, 2) },
          { ...base, id: uid(), name: "empty body", bodyRaw: "{}" },
        ];
      }

      if (req.name === "Patch") {
        const body = buildDefaultBodyFromMeta(meta);
        const patchBody = {};
        const firstKey = Object.keys(body)[0];
        if (firstKey) patchBody[firstKey] = body[firstKey];
        return [
          {
            ...base,
            id: uid(),
            name: "patch id=1",
            url: req.urlTemplate.replace(":id", "1"),
            bodyRaw: JSON.stringify(patchBody, null, 2),
          },
          {
            ...base,
            id: uid(),
            name: "put id=1",
            method: "PUT",
            url: req.urlTemplate.replace(":id", "1"),
            bodyRaw: JSON.stringify(patchBody, null, 2),
          },
        ];
      }

      if (req.name === "Delete") {
        return [
          { ...base, id: uid(), name: "id=1", url: req.urlTemplate.replace(":id", "1") },
          { ...base, id: uid(), name: "not found", url: req.urlTemplate.replace(":id", "999999") },
        ];
      }

      return [{ ...base }];
    },

    loadDraftFromActiveCase() {
      if (!this.activeRequestId || !this.activeCaseId) return;
      const list = this.casesByRequestId[this.activeRequestId] || [];
      const c = list.find((x) => x.id === this.activeCaseId);
      if (!c) return;
      this.draft = {
        method: c.method,
        url: c.url,
        params: (c.params || []).map((x) => ({ ...x })),
        headers: (c.headers || []).map((x) => ({ ...x })),
        bodyRaw: c.bodyRaw || "",
      };
    },

    activateRequest(req) {
      this.activeRequestId = req.id;
      const cases = this.casesByRequestId[req.id] || [];
      let caseId = this.activeCaseIdByRequestId[req.id];
      if (!caseId || !cases.some((c) => c.id === caseId)) {
        caseId = cases[0] ? cases[0].id : "";
        if (caseId) {
          this.$set(this.activeCaseIdByRequestId, req.id, caseId);
        }
      }
      this.activeCaseId = caseId || "";
      this.loadDraftFromActiveCase();
      /* Patch 请求下有 PUT 示例 case，method 可与模板 PATCH 不一致；其余请求应与侧边栏一致 */
      if (req.name !== "Patch" && this.draft.method !== req.method) {
        this.draft.method = req.method;
        this.saveDraftToActiveCase();
      }
      this.persistWorkspace();
    },

    onCaseChange() {
      if (!this.activeRequestId) return;
      this.$set(this.activeCaseIdByRequestId, this.activeRequestId, this.activeCaseId);
      this.loadDraftFromActiveCase();
      this.persistWorkspace();
    },

    saveDraftToActiveCase() {
      if (!this.activeRequestId || !this.activeCaseId) return;
      const list = this.casesByRequestId[this.activeRequestId] || [];
      const idx = list.findIndex((x) => x.id === this.activeCaseId);
      if (idx === -1) return;
      const next = {
        ...list[idx],
        method: this.draft.method,
        url: this.draft.url,
        params: this.draft.params.map((x) => ({ ...x })),
        headers: this.draft.headers.map((x) => ({ ...x })),
        bodyRaw: this.draft.bodyRaw,
      };
      list.splice(idx, 1, next);
      this.$set(this.casesByRequestId, this.activeRequestId, list);
      this.persistWorkspace();
    },

    cloneCase() {
      if (!this.activeRequestId || !this.activeCaseId) return;
      this.saveDraftToActiveCase();
      const list = this.casesByRequestId[this.activeRequestId] || [];
      const src = list.find((x) => x.id === this.activeCaseId);
      if (!src) return;
      const copy = { ...src, id: uid(), name: `${src.name} copy` };
      const next = [...list, copy];
      this.$set(this.casesByRequestId, this.activeRequestId, next);
      this.activeCaseId = copy.id;
      this.activeCaseIdByRequestId[this.activeRequestId] = copy.id;
      this.loadDraftFromActiveCase();
      this.persistWorkspace();
    },

    newCase() {
      if (!this.activeRequestId) return;
      this.saveDraftToActiveCase();
      const list = this.casesByRequestId[this.activeRequestId] || [];
      const base = list[0] || {
        id: uid(),
        name: "default",
        method: this.draft.method,
        url: this.draft.url,
        params: [],
        headers: [{ enabled: true, key: "content-type", value: "application/json" }],
        bodyRaw: "",
      };
      const c = { ...base, id: uid(), name: "new case" };
      const next = [...list, c];
      this.$set(this.casesByRequestId, this.activeRequestId, next);
      this.activeCaseId = c.id;
      this.activeCaseIdByRequestId[this.activeRequestId] = c.id;
      this.loadDraftFromActiveCase();
      this.persistWorkspace();
    },

    deleteCase() {
      if (!this.activeRequestId || !this.activeCaseId) return;
      const list = this.casesByRequestId[this.activeRequestId] || [];
      if (list.length <= 1) return;
      const next = list.filter((x) => x.id !== this.activeCaseId);
      this.$set(this.casesByRequestId, this.activeRequestId, next);
      const newActive = next[0].id;
      this.activeCaseId = newActive;
      this.activeCaseIdByRequestId[this.activeRequestId] = newActive;
      this.loadDraftFromActiveCase();
      this.persistWorkspace();
    },

    addParam() {
      this.draft.params.push({ enabled: true, key: "", value: "" });
    },
    removeParam(i) {
      this.draft.params.splice(i, 1);
    },
    addHeader() {
      this.draft.headers.push({ enabled: true, key: "", value: "" });
    },
    removeHeader(i) {
      this.draft.headers.splice(i, 1);
    },
    formatBody() {
      const pretty = safeJsonPretty(this.draft.bodyRaw);
      if (!pretty) {
        this.$message.warning("不是合法 JSON");
        return;
      }
      this.draft.bodyRaw = pretty;
    },
    clearBody() {
      this.draft.bodyRaw = "";
    },

    async send() {
      this.saveDraftToActiveCase();
      this.sending = true;
      const t0 = performance.now();
      try {
        const path = normalizePath(this.draft.url);
        const url = `${path}${toQueryString(this.draft.params)}`;
        const headers = {};
        for (const h of this.draft.headers || []) {
          if (!h || !h.enabled) continue;
          const k = String(h.key || "").trim();
          if (!k) continue;
          headers[k] = String(h.value ?? "");
        }
        let body = undefined;
        if (["POST", "PUT", "PATCH"].includes(this.draft.method)) {
          const raw = String(this.draft.bodyRaw || "").trim();
          if (raw) {
            try {
              JSON.parse(raw);
            } catch {
              this.$message.error("Body 不是合法 JSON");
              return;
            }
            body = raw;
          } else {
            body = "{}";
          }
        }

        const res = await fetch(url, {
          method: this.draft.method,
          headers,
          body,
        });
        const rawText = await res.text();
        const timeMs = Math.round(performance.now() - t0);
        const headersObj = {};
        res.headers.forEach((v, k) => {
          headersObj[k] = v;
        });
        const prettyBody = safeJsonPretty(rawText) || rawText;
        let sizeBytes = 0;
        try {
          sizeBytes = new TextEncoder().encode(rawText).length;
        } catch {
          sizeBytes = rawText.length;
        }
        this.response = {
          status: res.status,
          timeMs,
          sizeBytes,
          rawText,
          prettyBody,
          prettyHeaders: JSON.stringify(headersObj, null, 2),
        };
        if (!res.ok) {
          this.$message.error(`Request failed (${res.status})`);
        }
      } catch (e) {
        this.$message.error(e.message || String(e));
      } finally {
        this.sending = false;
      }
    },

    copyResponse() {
      if (!this.response.rawText) return;
      navigator.clipboard
        .writeText(this.response.rawText)
        .then(() => this.$message.success("已复制"))
        .catch(() => this.$message.error("复制失败"));
    },

    persistWorkspace() {
      try {
        const payload = {
          openModels: Array.from(this.openModels),
          activeRequestId: this.activeRequestId,
          casesByRequestId: this.casesByRequestId,
          activeCaseIdByRequestId: this.activeCaseIdByRequestId,
          leftCollapsed: this.leftCollapsed,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    },

    restoreWorkspace() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const v = JSON.parse(raw);
        if (v && typeof v === "object") {
          this.openModels = new Set(Array.isArray(v.openModels) ? v.openModels : []);
          this.activeRequestId = typeof v.activeRequestId === "string" ? v.activeRequestId : "";
          this.casesByRequestId = v.casesByRequestId && typeof v.casesByRequestId === "object" ? v.casesByRequestId : {};
          this.activeCaseIdByRequestId =
            v.activeCaseIdByRequestId && typeof v.activeCaseIdByRequestId === "object" ? v.activeCaseIdByRequestId : {};
          this.leftCollapsed = Boolean(v.leftCollapsed);
        }
      } catch {
        // ignore
      }
    },
  },
};
</script>

<style scoped>
.api-explorer {
  display: grid;
  grid-template-columns: 292px minmax(0, 1fr);
  align-items: stretch;
  isolation: isolate;
  height: calc(100vh - 168px);
  min-height: 520px;
  max-height: calc(100vh - 120px);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #d9d9d9;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.api-explorer.is-left-collapsed {
  grid-template-columns: 56px minmax(0, 1fr);
}

.api-explorer::v-deep .el-button,
.api-explorer::v-deep .el-input__inner,
.api-explorer::v-deep .el-textarea__inner,
.api-explorer::v-deep .el-tabs__item,
.api-explorer::v-deep .el-select-dropdown__item {
  font-family: inherit;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.muted {
  color: #6b7280;
}

.rail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* Grid 子项默认 min-height:auto 会按内容撑开，flex 子项无法获得固定高度 → overflow 不滚动 */
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  position: relative;
  z-index: 2;
  background: #f2f2f2;
  border-right: 1px solid #e0e0e0;
  color: #212121;
}

.rail--collapsed .rail-search {
  display: none;
}

.rail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  padding: 14px 12px 10px;
  border-bottom: 1px solid #e0e0e0;
  background: linear-gradient(180deg, #fafafa 0%, #f2f2f2 100%);
}

.rail-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.rail-logo {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 800;
  background: #ffffff;
  border: 1px solid #e5e5e5;
  color: #ff6c37;
  flex-shrink: 0;
}

.rail-eyebrow {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #757575;
  font-weight: 800;
}

.rail-title {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 800;
  color: #212121;
}

.rail-tools {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid #d0d0d0;
  background: #ffffff;
  color: #424242;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}

.icon-btn:hover {
  border-color: #ff6c37;
  color: #ff6c37;
}

.rail-search {
  flex-shrink: 0;
  padding: 10px 12px;
}

.rail-search::v-deep .el-input__inner {
  border-radius: 8px;
  border-color: #cfcfcf;
  background: #ffffff;
}

.collections-tree {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 8px 10px 14px;
}

.folder + .folder {
  margin-top: 6px;
}

.folder-row {
  width: 100%;
  display: grid;
  grid-template-columns: 18px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #212121;
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.folder-row:hover {
  background: rgba(255, 108, 55, 0.06);
}

.folder-caret {
  font-size: 12px;
  color: #616161;
  transition: transform 150ms ease;
}

.folder-caret.open {
  transform: rotate(90deg);
}

.folder-name {
  font-weight: 700;
  font-size: 13px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-key {
  font-size: 11px;
  color: #757575;
  justify-self: end;
}

.folder-items {
  margin-top: 6px;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.req-row {
  width: 100%;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #303030;
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.req-row:hover {
  background: rgba(0, 0, 0, 0.04);
}

.req-row.active {
  background: rgba(255, 108, 55, 0.14);
  border-color: rgba(255, 108, 55, 0.35);
}

.method-chip {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 10px;
  font-weight: 800;
  padding: 4px 6px;
  border-radius: 6px;
  text-align: center;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
}

.method-chip[data-method="GET"] {
  color: #098171;
  border-color: rgba(9, 129, 113, 0.35);
  background: rgba(9, 129, 113, 0.08);
}

.method-chip[data-method="POST"] {
  color: #d97706;
  border-color: rgba(217, 119, 6, 0.35);
  background: rgba(217, 119, 6, 0.1);
}

.method-chip[data-method="PUT"] {
  color: #2563eb;
  border-color: rgba(37, 99, 235, 0.35);
  background: rgba(37, 99, 235, 0.08);
}

.method-chip[data-method="PATCH"] {
  color: #7c3aed;
  border-color: rgba(124, 58, 237, 0.35);
  background: rgba(124, 58, 237, 0.08);
}

.method-chip[data-method="DELETE"] {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.35);
  background: rgba(220, 38, 38, 0.08);
}

.req-name {
  font-size: 12px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collections-empty {
  padding: 16px 10px;
  color: #757575;
  font-size: 13px;
}

.rail--collapsed .folder-row {
  grid-template-columns: 18px;
  justify-items: center;
}

.rail--collapsed .folder-items {
  padding-left: 0;
  align-items: center;
}

.rail--collapsed .req-row {
  grid-template-columns: 1fr;
  justify-items: center;
}

.workbench {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  z-index: 1;
  background: #ffffff;
}

.workbench-stack {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.request-pane {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.request-url-shell {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 14px 16px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
}

.method-wrap {
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #d0d0d0;
  background: #ffffff;
}

.method-wrap[data-method="GET"] {
  border-color: rgba(9, 129, 113, 0.45);
}

.method-wrap[data-method="POST"] {
  border-color: rgba(217, 119, 6, 0.45);
}

.method-wrap[data-method="PUT"] {
  border-color: rgba(37, 99, 235, 0.45);
}

.method-wrap[data-method="PATCH"] {
  border-color: rgba(124, 58, 237, 0.45);
}

.method-wrap[data-method="DELETE"] {
  border-color: rgba(220, 38, 38, 0.45);
}

.method-dd {
  width: 118px;
}

.method-dd::v-deep .el-input__inner {
  border: none;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.url-field {
  flex: 1;
  min-width: 0;
}

.url-field::v-deep .el-input__inner {
  height: 36px;
  line-height: 36px;
  border-radius: 6px;
  border: 1px solid #cfcfcf;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
}

.url-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #cfcfcf;
  background: #ffffff;
  color: #424242;
  cursor: pointer;
  font-size: 13px;
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ghost-btn:not(:disabled):hover {
  border-color: #ff6c37;
  color: #ff6c37;
}

.send-pill.el-button--primary {
  height: 36px;
  padding: 0 22px;
  border-radius: 6px;
  font-weight: 800;
  letter-spacing: 0.02em;
  background: #ff6c37;
  border-color: #ff6c37;
}

.send-pill.el-button--primary:hover,
.send-pill.el-button--primary:focus {
  background: #ff7c4d;
  border-color: #ff7c4d;
}

.request-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 16px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.breadcrumb {
  font-size: 12px;
  color: #424242;
}

.bc-muted {
  color: #757575;
}

.bc-sep {
  margin: 0 6px;
  color: #9e9e9e;
}

.case-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}

.case-label {
  color: #757575;
  font-weight: 700;
}

.case-caption {
  color: #616161;
  font-weight: 700;
}

.case-dd {
  min-width: 140px;
}

.case-tools::v-deep .el-divider--vertical {
  margin: 0 4px;
  height: 16px;
}

.linkish {
  border: none;
  background: transparent;
  padding: 2px 6px;
  font-size: 12px;
  font-weight: 700;
  color: #ff6c37;
  cursor: pointer;
}

.linkish.danger {
  color: #dc2626;
}

.linkish:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pm-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pm-tabs::v-deep .el-tabs__header {
  margin: 0;
  padding: 0 16px;
  border-bottom: 1px solid #e8e8e8;
  background: #ffffff;
}

.pm-tabs::v-deep .el-tabs__nav-wrap::after {
  display: none;
}

.pm-tabs::v-deep .el-tabs__nav {
  border: none;
}

.pm-tabs::v-deep .el-tabs__item {
  height: 44px;
  line-height: 44px;
  padding: 0 14px;
  font-weight: 700;
  font-size: 13px;
  color: #616161;
  border: none;
  border-bottom: 3px solid transparent;
}

.pm-tabs::v-deep .el-tabs__item.is-active {
  color: #ff6c37;
  border-bottom-color: #ff6c37;
}

.pm-tabs::v-deep .el-tabs__active-bar {
  display: none;
}

.pm-tabs::v-deep .el-tabs__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
}

.req-tabs::v-deep .el-tab-pane {
  height: 100%;
}

.tab-desc {
  font-size: 12px;
  margin-bottom: 8px;
}

.kv-toolbar,
.body-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.link-btn {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 12px;
  font-weight: 800;
  color: #ff6c37;
  cursor: pointer;
}

.flex-spacer {
  flex: 1;
}

.seg-label {
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #424242;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #e0e0e0;
  background: #ffffff;
}

.seg-muted {
  margin-left: 8px;
  font-size: 12px;
  color: #757575;
}

.pm-table::v-deep .el-table__header-wrapper th {
  background: #fafafa;
  color: #616161;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.pm-table::v-deep td,
.pm-table::v-deep th {
  padding: 6px 0;
}

.cell-input::v-deep .el-input__inner {
  border-radius: 6px;
}

.body-editor {
  width: 100%;
}

.body-editor::v-deep textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.55;
  border-radius: 8px;
  border-color: #d0d0d0;
  min-height: 220px;
}

.split-hit {
  flex: 0 0 10px;
  cursor: row-resize;
  background: #fafafa;
  border-top: 1px solid #e6e6e6;
  border-bottom: 1px solid #e6e6e6;
  display: grid;
  place-items: center;
}

.split-grip {
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: #bdbdbd;
}

.response-pane {
  flex: 1 1 auto;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #ffffff;
}

.response-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.response-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-weight: 900;
  font-size: 13px;
  color: #212121;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 900;
  border: 1px solid #e0e0e0;
  background: #ffffff;
  color: #424242;
}

.status-chip--idle {
  color: #757575;
}

.status-chip[data-band="ok"] {
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.35);
  color: #047857;
}

.status-chip[data-band="redirect"] {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.35);
  color: #1d4ed8;
}

.status-chip[data-band="client"],
.status-chip[data-band="server"] {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
  color: #b91c1c;
}

.stat {
  font-size: 12px;
  font-weight: 800;
  color: #616161;
}

.response-actions {
  display: flex;
  gap: 8px;
}

.resp-tabs {
  flex: 1;
  min-height: 0;
}

.resp-tabs::v-deep .el-tabs__content {
  padding: 0;
}

.resp-tabs::v-deep .el-tab-pane {
  height: 100%;
}

.resp-body {
  margin: 0;
  padding: 14px 16px;
  height: 100%;
  min-height: 200px;
  box-sizing: border-box;
  overflow: auto;
  font-size: 12px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  color: #e5e7eb;
  background: #1e1e1e;
  border-top: 1px solid #2a2a2a;
}

@media (max-width: 980px) {
  .api-explorer {
    height: auto;
    max-height: none;
    grid-template-columns: 1fr;
  }

  .rail {
    border-right: 0;
    border-bottom: 1px solid #e0e0e0;
    max-height: 320px;
    min-height: 0;
  }
}
</style>

