<template>
  <div>
    <div v-if="modelKey" class="view-extras">
      <el-tag size="medium" type="info">{{ modelKey }}</el-tag>
      <el-tag size="medium">{{ listTotal }} records</el-tag>
    </div>

    <section class="content-grid">
      <el-card class="panel table-panel" shadow="never">
        <div slot="header" class="panel-header">
          <div>
            <p class="eyebrow">Data table</p>
            <h3>{{ currentModelName }} records</h3>
          </div>
          <div class="table-header-right">
            <el-tag size="small" class="fields-tag">{{ fields.length }} fields</el-tag>
            <el-button type="text" size="small" class="api-inline-btn" @click="openListApiDoc">
              API
            </el-button>
            <el-button type="primary" size="small" @click="openCreateDialog">
              Create record
            </el-button>
          </div>
        </div>

        <div v-if="filterableFields.length" class="list-filter-bar">
          <el-form class="list-filter-form" :inline="true" size="small" @submit.native.prevent="applyListFilters">
            <el-form-item
              v-for="field in filterableFields"
              :key="field"
              :label="columnLabel(field)"
              class="list-filter-item"
            >
              <el-select
                v-if="filterFieldKind(field) === 'boolean'"
                v-model="listFilters[field]"
                clearable
                placeholder="any"
                class="list-filter-control"
              >
                <el-option label="true" :value="'true'" />
                <el-option label="false" :value="'false'" />
              </el-select>
              <el-select
                v-else-if="fieldHasChoices(field)"
                v-model="listFilters[field]"
                clearable
                filterable
                placeholder="any"
                class="list-filter-control"
              >
                <el-option
                  v-for="opt in fieldChoiceOptions(field)"
                  :key="'f-' + field + '-' + String(opt.value)"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
              <el-input
                v-else
                v-model.trim="listFilters[field]"
                class="list-filter-control"
                clearable
                :placeholder="field"
                @keydown.enter.native="applyListFilters"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="applyListFilters">筛选</el-button>
              <el-button @click="resetListFilters">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <el-table v-loading="loading" :data="items" stripe class="admin-table">
          <el-table-column
            v-for="field in fields"
            :key="field"
            :label="columnLabel(field)"
            min-width="140"
            :show-overflow-tooltip="!cellHasInlineRelationAction(field)"
          >
            <template slot-scope="{ row }">
              <span
                v-if="isFkOrO2oField(field)"
                class="data-cell-clickable"
                :class="{ 'is-disabled': !canOpenFkDetail(row, field) }"
                :title="formatCell(row, field)"
                @click="onFkValueClick(row, field)"
              >{{ formatCell(row, field) }}</span>
              <span
                v-else-if="isManyToManyField(field)"
                class="data-cell-clickable"
                :class="{ 'is-disabled': !canOpenM2mDetail(row, field) }"
                :title="formatCell(row, field)"
                @click="onM2mValueClick(row, field)"
              >{{ formatCell(row, field) }}</span>
              <span v-else>{{ formatCell(row, field) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            v-if="reverseRelations.length"
            min-width="200"
            fixed="right"
            class-name="col-fk-links col-child-links"
          >
            <template slot="header">
              <span class="table-col-head"
                >子集
                <el-tooltip
                  content="子表外键指向本行，即一对多；多对一/多对多可在本表对应列的显示值上点击查看"
                  placement="top"
                >
                  <i class="el-icon-question col-head-hint" />
                </el-tooltip>
              </span>
            </template>
            <template slot-scope="{ row }">
              <div class="fk-link-buttons">
                <el-button
                  v-for="rev in reverseRelations"
                  :key="'o2m-' + rev.sourceTable + rev.fkField"
                  type="text"
                  size="mini"
                  class="fk-link-btn"
                  :disabled="row.id == null || row.id === ''"
                  :title="`查 ${rev.label}（${rev.fkField}＝本行 id）`"
                  @click="openO2mListDialog(row, rev)"
                >
                  {{ rev.label }}
                </el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="actions" width="230" fixed="right">
            <template slot-scope="{ row }">
              <el-button size="mini" @click="editItem(row)">Edit</el-button>
              <el-button size="mini" type="danger" @click="deleteItem(row)">Delete</el-button>
              <el-button size="mini" type="text" @click="openRowApiDoc(row)">API</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="list-pagination">
          <el-pagination
            background
            layout="total, sizes, prev, pager, next, jumper"
            :current-page="listPage"
            :page-size="listPageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="listTotal"
            @current-change="onListPageChange"
            @size-change="onListPageSizeChange"
          />
        </div>
      </el-card>
    </section>

    <el-dialog
      :title="formDialogTitle"
      :visible.sync="formDialogVisible"
      width="520px"
      :close-on-click-modal="false"
      append-to-body
      custom-class="model-form-dialog"
      @close="onFormDialogClose"
    >
      <el-form class="admin-form" label-position="top" @submit.native.prevent="createItem">
        <el-form-item v-for="field in formFields" :key="field" :label="columnLabel(field)">
          <template v-if="isRelationField(field)">
            <div class="relation-control">
              <el-select
                v-model="form[field]"
                class="field-control"
                :placeholder="field"
                :multiple="isManyToManyField(field)"
                clearable
                filterable
              >
                <el-option
                  v-for="option in relationOptions[field] || []"
                  :key="option.id"
                  :label="relationOptionLabel(option, field)"
                  :value="option.id"
                />
              </el-select>
              <el-button class="manage-button" size="mini" @click="openRelatedModel(field)">
                管理 {{ relationTarget(field) }}
              </el-button>
            </div>
          </template>
          <el-select
            v-else-if="fieldHasChoices(field)"
            v-model="form[field]"
            class="field-control"
            :placeholder="field"
            clearable
            filterable
          >
            <el-option
              v-for="opt in fieldChoiceOptions(field)"
              :key="'form-' + field + '-' + String(opt.value)"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-input v-else v-model.trim="form[field]" class="field-control" :placeholder="field" />
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button type="text" @click="openFormApiDoc">API</el-button>
        <el-button @click="closeFormDialog">Cancel</el-button>
        <el-button type="primary" :loading="submitting" @click="createItem">
          {{ editingId ? "Save" : "Create" }}
        </el-button>
      </span>
    </el-dialog>

    <el-dialog
      :title="fkDialogTitle"
      :visible.sync="fkDialogVisible"
      width="520px"
      :close-on-click-modal="true"
      append-to-body
      custom-class="fk-detail-dialog"
      @close="onFkDialogClose"
    >
      <div v-loading="fkDialogLoading" class="fk-detail-body">
        <el-descriptions
          v-if="!fkDialogLoading && fkDialogRecord && fkDetailEntries.length"
          :column="1"
          border
          size="small"
        >
          <el-descriptions-item
            v-for="ent in fkDetailEntries"
            :key="ent.key"
            :label="ent.label"
          >
            {{ ent.value }}
          </el-descriptions-item>
        </el-descriptions>
        <p
          v-else-if="!fkDialogLoading && !fkDialogRecord"
          class="fk-detail-empty"
        >
          暂无关联数据
        </p>
        <p v-else-if="!fkDialogLoading" class="fk-detail-empty">无字段可展示</p>
      </div>
      <span slot="footer" class="dialog-footer">
        <el-button v-if="fkDialogTargetKey" type="text" @click="openFkDetailApiDoc">API</el-button>
        <el-button @click="fkDialogVisible = false">关闭</el-button>
        <el-button
          v-if="fkDialogTargetKey"
          type="primary"
          @click="goToRelatedModelFromFkDialog"
        >
          打开 {{ relatedModelDisplayName(fkDialogTargetKey) }} 表
        </el-button>
      </span>
    </el-dialog>

    <el-dialog
      :title="relListDialogTitle"
      :visible.sync="relListDialogVisible"
      width="720px"
      :close-on-click-modal="true"
      append-to-body
      custom-class="rel-list-dialog"
      @close="onRelListDialogClose"
    >
      <div v-loading="relListDialogLoading" class="rel-list-body">
        <el-table
          v-if="relListDialogRows.length"
          :data="relListDialogRows"
          stripe
          size="small"
          max-height="420"
        >
          <el-table-column
            v-for="col in relListDialogColumns"
            :key="col.prop"
            :label="col.label"
            min-width="120"
            show-overflow-tooltip
          >
            <template slot-scope="scope">
              {{ formatCellForTargetMeta(scope.row, col.prop) }}
            </template>
          </el-table-column>
        </el-table>
        <p v-else class="fk-detail-empty">暂无数据</p>
      </div>
      <span slot="footer" class="dialog-footer">
        <el-button v-if="relListDialogTargetKey" type="text" @click="openRelListApiDoc">API</el-button>
        <el-button @click="relListDialogVisible = false">关闭</el-button>
        <el-button
          v-if="relListDialogTargetKey"
          type="primary"
          @click="goToRelatedModelFromListDialog"
        >
          打开 {{ relatedModelDisplayName(relListDialogTargetKey) }} 表
        </el-button>
      </span>
    </el-dialog>

    <el-dialog
      :title="apiDocDialogTitle"
      :visible.sync="apiDocDialogVisible"
      width="720px"
      append-to-body
      custom-class="api-doc-ctx-dialog"
    >
      <div v-if="!apiDocDialogItems.length" class="api-doc-empty">No API description loaded.</div>
      <div v-for="(item, idx) in apiDocDialogItems" v-else :key="idx" class="api-doc-block">
        <h4 v-if="item.label" class="api-doc-block-title">{{ item.label }}</h4>
        <p v-if="item.note" class="api-doc-note">{{ item.note }}</p>
        <div v-if="item.endpoint" class="endpoint-card-inner">
          <div class="endpoint-summary">
            <el-tag size="mini" :type="methodTagType(item.endpoint.method)">
              {{ item.endpoint.method }}
            </el-tag>
            <code class="api-path-code">{{ item.endpoint.path }}</code>
          </div>
          <p v-if="item.endpoint.description" class="endpoint-description">
            {{ item.endpoint.description }}
          </p>
          <div
            class="docs-samples"
            :class="{
              'docs-samples--4': item.endpoint.query
            }"
          >
            <div v-if="item.endpoint.query">
              <strong>Query</strong>
              <pre>{{ formatApiJson(item.endpoint.query) }}</pre>
            </div>
            <div>
              <strong>Params</strong>
              <pre>{{ formatApiJson(item.endpoint.params) }}</pre>
            </div>
            <div>
              <strong>Request body</strong>
              <pre>{{ formatApiJson(item.endpoint.requestBody) }}</pre>
            </div>
            <div v-if="item.endpoint.responseExamples && item.endpoint.responseExamples.length">
              <strong>Response body</strong>
              <div
                v-for="(ex, exIdx) in item.endpoint.responseExamples"
                :key="exIdx"
                class="api-doc-response-ex"
              >
                <p class="api-doc-note"><strong>{{ ex.label }}</strong></p>
                <p>
                  示例：GET
                  <code>{{ item.endpoint.path }}{{ ex.queryString ? "?" + ex.queryString : "" }}</code>
                  <span v-if="!ex.queryString" class="api-doc-subtle">（不含 page、pageSize 为数组；可与列过滤同用）</span>
                </p>
                <pre>{{ formatApiJson(ex.responseBody) }}</pre>
              </div>
            </div>
            <div v-else>
              <strong>Response body</strong>
              <pre>{{ formatApiJson(item.endpoint.responseBody) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { requestJson, adminApiUrl, getAdminApiBase } from "../utils/request.js";

export default {
  name: "ModelView",
  inject: {
    adminSetError: {
      default() {
        return () => {};
      }
    },
    adminModels: {
      default() {
        return () => [];
      }
    }
  },
  props: {
    modelKey: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      fields: [],
      fieldMeta: {},
      formFields: [],
      relationOptions: {},
      reverseRelations: [],
      items: [],
      listPage: 1,
      listPageSize: 20,
      listTotal: 0,
      listFilters: {},
      form: {},
      editingId: "",
      loading: true,
      submitting: false,
      formDialogVisible: false,
      fkDialogVisible: false,
      fkDialogTitle: "",
      fkDialogRecord: null,
      fkDialogLoading: false,
      fkDialogTargetKey: "",
      fkDialogTargetFieldMeta: {},
      relListDialogVisible: false,
      relListDialogTitle: "",
      relListDialogLoading: false,
      relListDialogRows: [],
      relListDialogColumns: [],
      relListDialogTargetKey: "",
      relListDialogFieldMeta: {},
      relListO2mContext: null,
      apiDocsResponse: null,
      apiDocDialogVisible: false,
      apiDocDialogTitle: "",
      apiDocDialogItems: []
    };
  },
  computed: {
    fkDetailEntries() {
      const rec = this.fkDialogRecord;
      if (rec == null || typeof rec !== "object" || Array.isArray(rec)) {
        return [];
      }
      const keys = this.filterRedundantFkIdKeys(Object.keys(rec), rec);
      const ordered = this.orderFkDetailKeys(keys, this.fkDialogTargetFieldMeta || {});
      return ordered.map((key) => ({
        key,
        label: this.detailLabelForModelField(key, this.fkDialogTargetFieldMeta || {}),
        value: this.formatDetailValue(rec[key], key, this.fkDialogTargetFieldMeta || {})
      }));
    },
    models() {
      const m = this.adminModels;
      return typeof m === "function" ? m() : m;
    },
    currentModelName() {
      const current = this.models.find((model) => model.key === this.modelKey);
      if (!current) {
        return "Model";
      }
      return (current.admin && current.admin.label) || current.modelName;
    },
    formDialogTitle() {
      const name = this.currentModelName;
      return this.editingId ? `Edit · ${name}` : `New · ${name}`;
    },
    adminApiBase() {
      return getAdminApiBase();
    },
    filterableFields() {
      return this.fields.filter((f) => {
        const fm = this.fieldMeta[f] || {};
        return fm.kind !== "many_to_many";
      });
    }
  },
  watch: {
    modelKey: {
      handler() {
        this.loadModel();
      },
      immediate: true
    }
  },
  methods: {
    loadModel() {
      if (!this.modelKey) {
        return Promise.resolve();
      }
      this.formDialogVisible = false;
      this.loading = true;
      this.adminSetError("");
      this.listPage = 1;
      return Promise.all([
        requestJson(adminApiUrl(this.modelKey, "meta")),
        requestJson(adminApiUrl("api-docs")).catch(() => null)
      ])
        .then(([meta, apiDocs]) => {
          this.apiDocsResponse = apiDocs && typeof apiDocs === "object" ? apiDocs : null;
          this.fieldMeta = meta.fields || {};
          this.reverseRelations = Array.isArray(meta.reverseRelations) ? meta.reverseRelations : [];
          this.fields = Object.keys(this.fieldMeta);
          this.formFields = this.fields.filter((field) => {
            const fm = this.fieldMeta[field] || {};
            return fm.kind !== "auto";
          });
          this.initListFilters();
          this.resetForm();
          this.items = [];
          this.listTotal = 0;
          return this.loadRelationOptions();
        })
        .then(() => this.fetchListData())
        .catch((error) => {
          this.adminSetError(error.message || String(error));
        })
        .finally(() => {
          this.loading = false;
        });
    },
    initListFilters() {
      const next = {};
      for (const f of this.filterableFields) {
        const bool = this.filterFieldKind(f) === "boolean";
        const choices = this.fieldHasChoices(f);
        next[f] = bool || choices ? undefined : "";
      }
      this.listFilters = next;
    },
    buildListRequestUrl() {
      const q = new URLSearchParams();
      q.set("page", String(this.listPage));
      q.set("pageSize", String(this.listPageSize));
      for (const f of this.filterableFields) {
        const raw = this.listFilters[f];
        if (raw === undefined || raw === null) {
          continue;
        }
        const s = String(raw).trim();
        if (s.length === 0) {
          continue;
        }
        q.set(f, s);
      }
      return `${this.adminApiBase}/${this.modelKey}?${q.toString()}`;
    },
    fetchListData() {
      if (!this.modelKey) {
        return Promise.resolve();
      }
      return requestJson(this.buildListRequestUrl()).then((body) => {
        // Paged: { items, total, page, pageSize }. Do not use `body.total != null` as
        // the only gate: when `total` is missing, `undefined != null` is false in JS
        // and the handler used to clear rows even if `items` was populated.
        if (
          body &&
          typeof body === "object" &&
          !Array.isArray(body) &&
          Array.isArray(body.items)
        ) {
          this.items = body.items;
          const t = body.total;
          this.listTotal =
            typeof t === "number" && !Number.isNaN(t)
              ? t
              : (() => {
                  const n = Number(t);
                  return !Number.isNaN(n) ? Math.max(0, n) : body.items.length;
                })();
          if (body.page != null) {
            this.listPage = body.page;
          }
          if (body.pageSize != null) {
            this.listPageSize = body.pageSize;
          }
          const maxPage = Math.max(1, Math.ceil(this.listTotal / this.listPageSize) || 1);
          if (this.listPage > maxPage) {
            this.listPage = maxPage;
            return this.fetchListData();
          }
          return undefined;
        }
        if (Array.isArray(body)) {
          this.items = body;
          this.listTotal = body.length;
        } else {
          this.items = [];
          this.listTotal = 0;
        }
        return undefined;
      });
    },
    refreshList() {
      if (!this.modelKey) {
        return Promise.resolve();
      }
      this.loading = true;
      this.adminSetError("");
      return this.fetchListData()
        .catch((e) => {
          this.adminSetError(e.message || String(e));
        })
        .finally(() => {
          this.loading = false;
        });
    },
    applyListFilters() {
      this.listPage = 1;
      this.refreshList();
    },
    resetListFilters() {
      this.initListFilters();
      this.listPage = 1;
      this.refreshList();
    },
    onListPageChange(p) {
      this.listPage = p;
      this.refreshList();
    },
    onListPageSizeChange(s) {
      this.listPageSize = s;
      this.listPage = 1;
      this.refreshList();
    },
    filterFieldKind(field) {
      return (this.fieldMeta[field] && this.fieldMeta[field].kind) || "";
    },
    fieldChoiceOptions(field) {
      const fm = this.fieldMeta[field] || {};
      const ch = fm.choices;
      if (!Array.isArray(ch) || ch.length === 0) {
        return [];
      }
      return ch.map((c) => ({
        value: c.value,
        label: c.label != null && String(c.label) !== "" ? String(c.label) : String(c.value)
      }));
    },
    fieldHasChoices(field) {
      return this.fieldChoiceOptions(field).length > 0;
    },
    choiceLabelFromMeta(fieldMeta, field, raw) {
      if (raw === undefined || raw === null) {
        return null;
      }
      const fm = (fieldMeta && fieldMeta[field]) || {};
      const ch = fm.choices;
      if (!Array.isArray(ch) || ch.length === 0) {
        return null;
      }
      const hit = ch.find((c) => c.value === raw || String(c.value) === String(raw));
      if (!hit) {
        return null;
      }
      return hit.label != null && String(hit.label) !== "" ? String(hit.label) : String(hit.value);
    },
    loadRelationOptions() {
      const relationFields = this.formFields.filter((field) => this.isRelationField(field));
      return Promise.all(
        relationFields.map((field) =>
          requestJson(adminApiUrl(this.relationTarget(field))).then((items) => {
            this.$set(this.relationOptions, field, Array.isArray(items) ? items : []);
          })
        )
      );
    },
    isRelationField(field) {
      const fm = this.fieldMeta[field] || {};
      return (
        fm.kind === "foreign_key" || fm.kind === "one_to_one" || fm.kind === "many_to_many"
      );
    },
    isManyToManyField(field) {
      const fm = this.fieldMeta[field] || {};
      return fm.kind === "many_to_many";
    },
    relationTarget(field) {
      const fm = this.fieldMeta[field] || {};
      return fm.target || "";
    },
    /**
     * 表头/表单标签：外键、一对一、多对多 用关联模型在 catalog 里的 admin.label，
     * 而非物理列名（如 school_id）；其它列仍用字段名。
     */
    columnLabel(field) {
      const fm = this.fieldMeta[field] || {};
      if (typeof fm.label === "string" && fm.label.length > 0) {
        return fm.label;
      }
      const target = fm.target;
      if (
        target &&
        (fm.kind === "foreign_key" ||
          fm.kind === "one_to_one" ||
          fm.kind === "many_to_many")
      ) {
        const m = this.models.find((x) => x.key === target);
        if (m) {
          const t = m.admin && m.admin.label;
          if (t) {
            return t;
          }
          if (m.modelName) {
            return m.modelName;
          }
        }
        return target;
      }
      return field;
    },
    /** 与 core `foreignKeyApiNestedKey` 一致：展开行所在 key */
    fkColumnToNestedKey(columnName) {
      if (columnName.length > 3 && columnName.endsWith("_id")) {
        return columnName.slice(0, -3);
      }
      return columnName;
    },
    /** 与 core `foreignKeyApiIdKey` 一致：JSON 中外键标量 */
    fkApiIdKey(field) {
      if (field.length > 3 && field.endsWith("_id")) {
        return field;
      }
      return `${field}_id`;
    },
    m2mApiIdsKey(field) {
      return `${field}_ids`;
    },
    m2mValues(row, field) {
      if (row == null) {
        return [];
      }
      if (Array.isArray(row[field])) {
        return row[field];
      }
      const idsKey = this.m2mApiIdsKey(field);
      return Array.isArray(row[idsKey]) ? row[idsKey] : [];
    },
    m2mItemId(item) {
      return item && typeof item === "object" ? item.id : item;
    },
    m2mItemLabel(item, field) {
      if (item && typeof item === "object") {
        const target = this.relationTarget(field);
        const df = target ? this.displayFieldForTargetTable(target) : "";
        const val = df ? item[df] : undefined;
        if (val !== undefined && val !== null && val !== "") {
          return String(val);
        }
        if (item.name != null && item.name !== "") return String(item.name);
        if (item.title != null && item.title !== "") return String(item.title);
        if (item.id != null) return String(item.id);
        return JSON.stringify(item);
      }
      return item === undefined || item === null ? "" : String(item);
    },
    displayFieldForTargetTable(targetTableKey) {
      const m = this.models.find((x) => x.key === targetTableKey);
      const f = m && m.admin && m.admin.display_field;
      return f && String(f).length > 0 ? f : "id";
    },
    cellHasInlineRelationAction(field) {
      return this.isFkOrO2oField(field) || this.isManyToManyField(field);
    },
    onFkValueClick(row, field) {
      if (!this.canOpenFkDetail(row, field)) {
        return;
      }
      this.openFkDetail(row, field);
    },
    onM2mValueClick(row, field) {
      if (!this.canOpenM2mDetail(row, field)) {
        return;
      }
      this.openM2mListDialog(row, field);
    },
    isFkOrO2oField(field) {
      const fm = this.fieldMeta[field] || {};
      return fm.kind === "foreign_key" || fm.kind === "one_to_one";
    },
    canOpenFkDetail(row, field) {
      if (row == null) {
        return false;
      }
      const nestedKey = this.fkColumnToNestedKey(field);
      const nested = row[nestedKey];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return true;
      }
      const idK = this.fkApiIdKey(field);
      const id = row[idK] !== undefined && row[idK] !== "" ? row[idK] : row[field];
      return id != null && id !== "";
    },
    openFkDetail(row, field) {
      if (!this.canOpenFkDetail(row, field)) {
        return;
      }
      const target = this.relationTarget(field);
      if (!target) {
        return;
      }
      const idK = this.fkApiIdKey(field);
      const rawId = row[idK] !== undefined && row[idK] !== "" ? row[idK] : row[field];
      this.fkDialogTargetKey = target;
      this.fkDialogTitle = `${this.columnLabel(field)} · 引用详情`;
      this.adminSetError("");
      this.fkDialogTargetFieldMeta = {};
      this.fkDialogRecord = null;
      this.fkDialogVisible = true;
      this.fkDialogLoading = true;
      Promise.all([requestJson(adminApiUrl(target, "meta")), requestJson(adminApiUrl(target, String(rawId)))])
        .then(([m, rec]) => {
          this.fkDialogTargetFieldMeta = (m && m.fields) || {};
          this.fkDialogRecord = rec && typeof rec === "object" ? { ...rec } : null;
        })
        .catch((error) => {
          this.adminSetError(error.message || String(error));
          this.fkDialogVisible = false;
        })
        .finally(() => {
          this.fkDialogLoading = false;
        });
    },
    onFkDialogClose() {
      this.fkDialogRecord = null;
      this.fkDialogTargetKey = "";
      this.fkDialogTargetFieldMeta = {};
    },
    /** 有嵌套行时隐去多余的 `xxx_id` 标量 */
    filterRedundantFkIdKeys(keys, rec) {
      return keys.filter((k) => {
        if (k.length > 3 && k.endsWith("_id")) {
          const nestedName = this.fkColumnToNestedKey(k);
          const nested = rec[nestedName];
          if (nested != null && typeof nested === "object" && !Array.isArray(nested)) {
            return false;
          }
        }
        return true;
      });
    },
    orderFkDetailKeys(keys, fieldMeta) {
      const metaKeyList = Object.keys(fieldMeta);
      const fromMeta = metaKeyList.filter((k) => keys.includes(k));
      const rest = keys.filter((k) => !fromMeta.includes(k)).sort();
      const ordered = [];
      if (keys.includes("id")) {
        ordered.push("id");
      }
      for (const k of fromMeta) {
        if (k !== "id" && !ordered.includes(k)) {
          ordered.push(k);
        }
      }
      for (const k of rest) {
        if (k !== "id" && !ordered.includes(k)) {
          ordered.push(k);
        }
      }
      return ordered;
    },
    /** 用目标表 meta 的 `label`；嵌套名与 `fkColumnToNestedKey(逻辑名)` 对齐 */
    detailLabelForModelField(key, fieldMeta) {
      const f = fieldMeta[key];
      if (f && typeof f.label === "string" && f.label.length > 0) {
        return f.label;
      }
      for (const [fname, fm] of Object.entries(fieldMeta)) {
        if (this.fkColumnToNestedKey(fname) === key) {
          if (fm && typeof fm.label === "string" && fm.label.length > 0) {
            return fm.label;
          }
          return fname;
        }
      }
      return key;
    },
    formatDetailValue(val, key, fieldMeta) {
      const meta =
        fieldMeta && typeof fieldMeta === "object" && !Array.isArray(fieldMeta)
          ? fieldMeta
          : this.fieldMeta;
      if (val === null || val === undefined) {
        return "—";
      }
      if (typeof val === "object") {
        if (Array.isArray(val)) {
          return val.length
            ? val
                .map((v) => (v != null && typeof v === "object" ? JSON.stringify(v) : String(v)))
                .join(", ")
            : "—";
        }
        if (val.id != null) {
          const t = val.name != null ? val.name : val.title;
          if (t != null && t !== "") {
            return `${t}（id: ${val.id}）`;
          }
        }
        return JSON.stringify(val);
      }
      const choiceL = this.choiceLabelFromMeta(meta, key, val);
      if (choiceL != null) {
        return choiceL;
      }
      return String(val);
    },
    relatedModelDisplayName(targetKey) {
      const m = this.models.find((x) => x.key === targetKey);
      if (m) {
        const t = m.admin && m.admin.label;
        if (t) {
          return t;
        }
        if (m.modelName) {
          return m.modelName;
        }
      }
      return targetKey;
    },
    goToRelatedModelFromFkDialog() {
      const target = this.fkDialogTargetKey;
      this.fkDialogVisible = false;
      if (target) {
        this.$router.push({ name: "model", params: { modelKey: target } });
      }
    },
    canOpenM2mDetail(row, field) {
      return this.m2mValues(row, field).length > 0;
    },
    /**
     * 子集 / 多对多弹窗内表格：列顺序与主表一致，用模型 meta 的 label，不用原始字段名当表头。
     * 不单独为嵌套对象建列，外键用逻辑名一列 + format 展示对端 `display_field`（列可为 `xx_id`）。
     */
    buildRelListColumnsFromMeta(fieldMeta) {
      if (!fieldMeta || typeof fieldMeta !== "object") {
        return [];
      }
      const names = Object.keys(fieldMeta);
      const ordered = names.includes("id")
        ? ["id", ...names.filter((k) => k !== "id")]
        : names;
      const out = [];
      for (const fname of ordered) {
        const f = fieldMeta[fname];
        if (f == null) {
          continue;
        }
        if (f.kind === "many_to_many") {
          continue;
        }
        const label = typeof f.label === "string" && f.label.length > 0 ? f.label : fname;
        out.push({ prop: fname, label });
      }
      return out;
    },
    /**
     * 与 {@link formatCell} 相同含义，子表用 `relListDialogFieldMeta` 判断类型。
     */
    formatCellForTargetMeta(row, field) {
      if (row == null) {
        return "";
      }
      const fieldMeta = this.relListDialogFieldMeta;
      const fm = fieldMeta[field] || {};
      if (fm.kind === "many_to_many") {
        const v = row[field];
        if (Array.isArray(v)) {
          return v.length
            ? v
                .map((item) => {
                  if (item && typeof item === "object") {
                    const df = fm.target ? this.displayFieldForTargetTable(fm.target) : "";
                    const val = df ? item[df] : undefined;
                    if (val !== undefined && val !== null && val !== "") return String(val);
                    if (item.name != null && item.name !== "") return String(item.name);
                    if (item.title != null && item.title !== "") return String(item.title);
                    if (item.id != null) return String(item.id);
                    return JSON.stringify(item);
                  }
                  return String(item);
                })
                .join(", ")
            : "";
        }
        return v === undefined || v === null ? "" : String(v);
      }
      if (fm.kind === "foreign_key" || fm.kind === "one_to_one") {
        const nestedKey = this.fkColumnToNestedKey(field);
        const ent = row[nestedKey];
        if (ent && typeof ent === "object" && !Array.isArray(ent)) {
          const df = this.displayFieldForTargetTable(fm.target);
          const val = ent[df];
          if (val !== undefined && val !== null && val !== "") {
            return String(val);
          }
          if (ent.id != null) {
            return String(ent.id);
          }
          return "—";
        }
        const idK = this.fkApiIdKey(field);
        const raw = row[idK] !== undefined && row[idK] !== "" ? row[idK] : row[field];
        if (raw != null && raw !== "") {
          return String(raw);
        }
        return "—";
      }
      const raw = row[field];
      if (raw === undefined || raw === null) {
        return "";
      }
      if (typeof raw === "object") {
        return JSON.stringify(raw);
      }
      const choiceL = this.choiceLabelFromMeta(fieldMeta, field, raw);
      if (choiceL != null) {
        return choiceL;
      }
      return String(raw);
    },
    openM2mListDialog(row, field) {
      if (!this.canOpenM2mDetail(row, field)) {
        return;
      }
      this.relListO2mContext = null;
      const target = this.relationTarget(field);
      this.relListDialogTargetKey = target;
      const values = this.m2mValues(row, field);
      const n = values.length;
      this.relListDialogTitle = `${this.columnLabel(field)} · 多对多（${n} 条）`;
      this.adminSetError("");
      this.relListDialogFieldMeta = {};
      this.relListDialogVisible = true;
      this.relListDialogLoading = true;
      this.relListDialogRows = [];
      this.relListDialogColumns = [];
      const opts = this.relationOptions[field] || [];
      const map = new Map(opts.map((o) => [String(o.id), o]));
      this.relListDialogRows = values.map((item) => {
        if (item && typeof item === "object") {
          return { ...item };
        }
        const id = this.m2mItemId(item);
        const hit = map.get(String(id));
        if (hit) {
          return { ...hit };
        }
        return { id, _note: "未在选项缓存中，请刷新本页" };
      });
      requestJson(adminApiUrl(target, "meta"))
        .then((m) => {
          this.relListDialogFieldMeta = (m && m.fields) || {};
          this.relListDialogColumns = this.buildRelListColumnsFromMeta(this.relListDialogFieldMeta);
        })
        .catch((e) => {
          this.adminSetError(e.message || String(e));
        })
        .finally(() => {
          this.relListDialogLoading = false;
        });
    },
    openO2mListDialog(row, rev) {
      const parentId = row.id;
      if (parentId == null || parentId === "") {
        return;
      }
      this.relListO2mContext = { rev, parentId: String(parentId) };
      this.relListDialogTargetKey = rev.sourceTable;
      this.relListDialogTitle =
        rev.kind === "many_to_many" ? `${rev.label} · 多对多` : `${rev.label} · 子集`;
      this.adminSetError("");
      this.relListDialogFieldMeta = {};
      this.relListDialogVisible = true;
      this.relListDialogLoading = true;
      this.relListDialogRows = [];
      this.relListDialogColumns = [];
      const q = new URLSearchParams();
      q.set(rev.fkField, String(parentId));
      const url = `${this.adminApiBase}/${rev.sourceTable}?${q.toString()}`;
      Promise.all([requestJson(url), requestJson(adminApiUrl(rev.sourceTable, "meta"))])
        .then(([list, m]) => {
          const arr =
            Array.isArray(list)
              ? list
              : list && typeof list === "object" && Array.isArray(list.items)
                ? list.items
                : [];
          this.relListDialogFieldMeta = (m && m.fields) || {};
          this.relListDialogRows = arr;
          this.relListDialogColumns = this.buildRelListColumnsFromMeta(this.relListDialogFieldMeta);
        })
        .catch((e) => {
          this.adminSetError(e.message || String(e));
          this.relListDialogVisible = false;
        })
        .finally(() => {
          this.relListDialogLoading = false;
        });
    },
    onRelListDialogClose() {
      this.relListDialogRows = [];
      this.relListDialogColumns = [];
      this.relListDialogTargetKey = "";
      this.relListDialogFieldMeta = {};
      this.relListO2mContext = null;
    },
    goToRelatedModelFromListDialog() {
      const t = this.relListDialogTargetKey;
      this.relListDialogVisible = false;
      if (t) {
        this.$router.push({ name: "model", params: { modelKey: t } });
      }
    },
    formatCell(row, field) {
      if (row == null) {
        return "";
      }
      const fm = this.fieldMeta[field] || {};
      if (fm.kind === "many_to_many") {
        const values = this.m2mValues(row, field);
        return values.length ? values.map((item) => this.m2mItemLabel(item, field)).join(", ") : "";
      }
      if (this.isFkOrO2oField(field)) {
        const nestedKey = this.fkColumnToNestedKey(field);
        const ent = row[nestedKey];
        if (ent && typeof ent === "object" && !Array.isArray(ent)) {
          const df = this.displayFieldForTargetTable(fm.target);
          const val = ent[df];
          if (val !== undefined && val !== null && val !== "") {
            return String(val);
          }
          if (ent.id != null) {
            return String(ent.id);
          }
          return "—";
        }
        const idK = this.fkApiIdKey(field);
        if (row[idK] != null && row[idK] !== "") {
          return String(row[idK]);
        }
        return "—";
      }
      const raw = row[field];
      if (raw === undefined || raw === null) {
        return "";
      }
      if (typeof raw === "object") {
        return JSON.stringify(raw);
      }
      const choiceL = this.choiceLabelFromMeta(this.fieldMeta, field, raw);
      if (choiceL != null) {
        return choiceL;
      }
      return String(raw);
    },
    relationOptionLabel(option, field) {
      if (field) {
        const t = this.relationTarget(field);
        if (t) {
          const df = this.displayFieldForTargetTable(t);
          if (option[df] != null && option[df] !== "") {
            return String(option[df]);
          }
        }
      }
      return option.name || option.title || option.id;
    },
    openRelatedModel(field) {
      const target = this.relationTarget(field);
      if (!target) {
        return;
      }
      this.$router.push({ name: "model", params: { modelKey: target } });
    },
    openCreateDialog() {
      this.resetForm();
      this.adminSetError("");
      this.formDialogVisible = true;
    },
    closeFormDialog() {
      this.formDialogVisible = false;
    },
    onFormDialogClose() {
      this.resetForm();
      this.adminSetError("");
    },
    resetForm() {
      this.form = this.formFields.reduce((nextForm, field) => {
        if (this.isManyToManyField(field)) {
          nextForm[field] = [];
        } else if (this.fieldHasChoices(field)) {
          nextForm[field] = undefined;
        } else {
          nextForm[field] = "";
        }
        return nextForm;
      }, {});
      this.editingId = "";
    },
    createItem() {
      const payload = this.formFields.reduce((nextPayload, field) => {
        const value = this.form[field];
        const include = Array.isArray(value)
          ? value.length > 0
          : value !== "" && value !== undefined && value !== null;
        if (include) {
          nextPayload[field] = value;
        }
        return nextPayload;
      }, {});

      if (Object.keys(payload).length === 0) {
        this.adminSetError("at least one field is required");
        return;
      }
      this.adminSetError("");
      this.submitting = true;
      requestJson(
        this.editingId
          ? adminApiUrl(this.modelKey, this.editingId)
          : adminApiUrl(this.modelKey),
        {
          method: this.editingId ? "PUT" : "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      )
        .then(() => {
          this.resetForm();
          this.formDialogVisible = false;
          return this.refreshList();
        })
        .catch((error) => {
          this.adminSetError(error.message || String(error));
        })
        .finally(() => {
          this.submitting = false;
        });
    },
    editItem(row) {
      this.editingId = String(row.id);
      this.form = this.formFields.reduce((nextForm, field) => {
        let value = row[field];
        if (this.isFkOrO2oField(field)) {
          const idK = this.fkApiIdKey(field);
          if (row[idK] != null && row[idK] !== "") {
            value = row[idK];
          } else if (value && typeof value === "object" && !Array.isArray(value) && value.id != null) {
            value = value.id;
          }
        } else if (this.isManyToManyField(field)) {
          value = this.m2mValues(row, field)
            .map((item) => this.m2mItemId(item))
            .filter((id) => id !== undefined && id !== null);
        }
        if (value === undefined || value === null) {
          nextForm[field] = this.isManyToManyField(field)
            ? []
            : this.fieldHasChoices(field)
              ? undefined
              : "";
        } else {
          nextForm[field] = value;
        }
        return nextForm;
      }, {});
      this.adminSetError("");
      this.formDialogVisible = true;
    },
    deleteItem(row) {
      requestJson(adminApiUrl(this.modelKey, String(row.id)), {
        method: "DELETE"
      })
        .then(() => {
          if (this.editingId === String(row.id)) {
            this.formDialogVisible = false;
            this.resetForm();
          }
          return this.refreshList();
        })
        .catch((error) => {
          this.adminSetError(error.message || String(error));
        });
    },
    apiDocForKey(key) {
      const models = (this.apiDocsResponse && this.apiDocsResponse.models) || [];
      return models.find((m) => m.key === key) || null;
    },
    endpointBy(modelDoc, method, path) {
      if (!modelDoc || !Array.isArray(modelDoc.endpoints)) {
        return null;
      }
      return modelDoc.endpoints.find((e) => e.method === method && e.path === path) || null;
    },
    showApiDocDialog(title, items) {
      this.apiDocDialogTitle = title;
      this.apiDocDialogItems = items.filter((x) => x && x.endpoint);
      this.apiDocDialogVisible = true;
    },
    formatApiJson(value) {
      if (value === null || value === undefined) {
        return "null";
      }
      return JSON.stringify(value, null, 2);
    },
    methodTagType(method) {
      if (method === "POST") {
        return "success";
      }
      if (method === "PUT") {
        return "warning";
      }
      if (method === "DELETE") {
        return "danger";
      }
      return "info";
    },
    openListApiDoc() {
      const doc = this.apiDocForKey(this.modelKey);
      const base = adminApiUrl(this.modelKey);
      const ep =
        this.endpointBy(doc, "GET", base) || {
          method: "GET",
          path: base,
          description: "List records for this model.",
          params: {},
          requestBody: null,
          responseBody: null
        };
      const note =
        "Query string: column equality filters (AND) plus `page` / `pageSize`. With pagination, the JSON body is `{ items, total, page, pageSize }` instead of a raw array. See the Query block below.";
      this.showApiDocDialog(`List · ${this.currentModelName}`, [{ label: "List", endpoint: ep, note }]);
    },
    openFormApiDoc() {
      const doc = this.apiDocForKey(this.modelKey);
      const base = adminApiUrl(this.modelKey);
      const isEdit = Boolean(this.editingId);
      const ep = isEdit
        ? this.endpointBy(doc, "PUT", `${base}/:id`) || {
            method: "PUT",
            path: `${base}/:id`,
            description: "Update a record by id.",
            params: { id: "Primary key" },
            requestBody: {},
            responseBody: null
          }
        : this.endpointBy(doc, "POST", base) || {
            method: "POST",
            path: base,
            description: "Create a record.",
            params: {},
            requestBody: {},
            responseBody: null
          };
      const label = isEdit ? "Update" : "Create";
      this.showApiDocDialog(
        `${label} · ${this.currentModelName}`,
        [{ label, endpoint: ep, note: isEdit ? "Replace `:id` with the record id (same as the row you are editing)." : undefined }]
      );
    },
    openRowApiDoc(row) {
      const id = row && row.id;
      if (id == null || id === "") {
        return;
      }
      const doc = this.apiDocForKey(this.modelKey);
      const base = adminApiUrl(this.modelKey);
      const pathId = `${base}/:id`;
      const g = this.endpointBy(doc, "GET", pathId);
      const p = this.endpointBy(doc, "PUT", pathId);
      const d = this.endpointBy(doc, "DELETE", pathId);
      const withPath = (e, m) => {
        if (!e) {
          return { method: m, path: pathId, description: "", params: { id: "Primary key" }, requestBody: m === "PUT" ? {} : null, responseBody: m === "DELETE" ? null : null };
        }
        return {
          ...e,
          path: e.path.replace(":id", String(id))
        };
      };
      this.showApiDocDialog(`Row · ${this.currentModelName} (id ${id})`, [
        { label: "Read one", endpoint: withPath(g, "GET"), note: "Path shows this row’s id." },
        { label: "Update", endpoint: withPath(p, "PUT") },
        { label: "Delete", endpoint: withPath(d, "DELETE") }
      ]);
    },
    openFkDetailApiDoc() {
      const k = this.fkDialogTargetKey;
      if (!k) {
        return;
      }
      const doc = this.apiDocForKey(k);
      const pathId = `${this.adminApiBase}/${k}/:id`;
      const rawId = this.fkDialogRecord && this.fkDialogRecord.id != null ? this.fkDialogRecord.id : "";
      if (rawId === "") {
        return;
      }
      const g = this.endpointBy(doc, "GET", pathId);
      const p = this.endpointBy(doc, "PUT", pathId);
      const d = this.endpointBy(doc, "DELETE", pathId);
      const withPath = (e, m) => {
        if (!e) {
          return { method: m, path: pathId, description: "", params: { id: "Primary key" }, requestBody: m === "PUT" ? {} : null, responseBody: null };
        }
        return { ...e, path: e.path.replace(":id", String(rawId)) };
      };
      this.showApiDocDialog(`${this.relatedModelDisplayName(k)} · row API`, [
        { label: "Read one", endpoint: withPath(g, "GET") },
        { label: "Update", endpoint: withPath(p, "PUT") },
        { label: "Delete", endpoint: withPath(d, "DELETE") }
      ]);
    },
    openRelListApiDoc() {
      const key = this.relListDialogTargetKey;
      if (!key) {
        return;
      }
      const o2m = this.relListO2mContext;
      if (o2m && o2m.rev) {
        const { rev, parentId } = o2m;
        const childDoc = this.apiDocForKey(rev.sourceTable);
        const listPath = adminApiUrl(rev.sourceTable);
        const listEp = this.endpointBy(childDoc, "GET", listPath);
        const path = `${listPath}?${rev.fkField}=${parentId}`;
        const firstListResponse =
          listEp && listEp.responseExamples && listEp.responseExamples[0]
            ? listEp.responseExamples[0].responseBody
            : listEp
              ? listEp.responseBody
              : null;
        const synthetic = {
          method: "GET",
          path,
          description: `List ${rev.label} where ${rev.fkField} equals the parent id (this dialog uses the same request).`,
          params: {},
          requestBody: null,
          responseBody: firstListResponse
        };
        this.showApiDocDialog(`子集 API · ${rev.label}`, [
          {
            label: "Filtered list",
            endpoint: synthetic,
            note: "This is the same list endpoint with an equality filter on the foreign key column."
          }
        ]);
        return;
      }
      const doc = this.apiDocForKey(key);
      const listPath = adminApiUrl(key);
      const ep = this.endpointBy(doc, "GET", listPath);
      const endpoint =
        ep || {
          method: "GET",
          path: listPath,
          description: "List related model records.",
          params: {},
          requestBody: null,
          responseBody: null
        };
      this.showApiDocDialog(`多对多 · ${this.relListDialogTitle}`, [
        {
          label: "Related model list (reference)",
          endpoint,
          note: "Dialog rows are taken from the parent row’s m2m id list; to fetch a row by id use GET with /:id on the related model."
        }
      ]);
    }
  }
};
</script>

<style scoped>
.view-extras {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  align-items: start;
}

.table-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.panel {
  border: 1px solid #dbe4f0;
  border-radius: 18px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-header h3 {
  color: #0f172a;
  font-size: 18px;
  margin: 0;
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #1e40af;
  font-weight: 700;
  margin-bottom: 6px;
}

.admin-form {
  display: grid;
  gap: 2px;
}

.field-control {
  width: 100%;
}

.relation-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.manage-button {
  cursor: pointer;
}

.data-cell-clickable {
  color: #1d4ed8;
  cursor: pointer;
}

.data-cell-clickable:hover:not(.is-disabled) {
  text-decoration: underline;
  color: #1e3a8a;
}

.data-cell-clickable.is-disabled {
  color: #334155;
  cursor: default;
  text-decoration: none;
}

.fk-link-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  justify-content: flex-start;
}

.fk-link-btn {
  padding: 0 4px;
  margin: 0;
}

.table-col-head {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.col-head-hint {
  color: #94a3b8;
  font-size: 14px;
  cursor: help;
  vertical-align: -1px;
}

.fk-detail-body {
  min-height: 48px;
}

.fk-detail-empty {
  margin: 0;
  color: #64748b;
  font-size: 14px;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 8px;
}

.form-actions .el-button,
.table-panel .el-button {
  cursor: pointer;
}

.admin-table {
  width: 100%;
}

.table-panel {
  min-width: 0;
}

.list-filter-bar {
  padding: 12px 16px 0;
  border-bottom: 1px solid #edf2f7;
  background: #fafbfc;
}

.list-filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 4px 8px;
}

.list-filter-item {
  margin-bottom: 8px;
}

.list-filter-item ::v-deep .el-form-item__label {
  color: #475569;
  font-weight: 500;
  padding-right: 6px;
}

.list-filter-control {
  min-width: 120px;
  max-width: 200px;
}

.list-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid #edf2f7;
  background: #ffffff;
}

::v-deep .el-card__header {
  background: #ffffff;
  border-bottom: 1px solid #edf2f7;
}

::v-deep .el-card__body {
  background: #ffffff;
}

::v-deep .el-form-item__label {
  color: #334155;
  font-weight: 600;
  padding-bottom: 5px;
}

::v-deep .el-input__inner,
::v-deep .el-select .el-input__inner {
  border-radius: 10px;
  border-color: #cbd5e1;
}

::v-deep .el-input__inner:focus {
  border-color: #3b82f6;
}

::v-deep .el-table th.el-table__cell {
  background: #f8fafc;
  color: #334155;
  font-weight: 700;
}

::v-deep .el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell {
  background: #f8fafc;
}

::v-deep .el-table__body tr:hover > td.el-table__cell {
  background: #eff6ff;
}

::v-deep .model-form-dialog .el-dialog__body {
  padding-top: 8px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
}

@media (max-width: 1180px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .panel-header,
  .relation-control {
    flex-direction: column;
    align-items: stretch;
  }
}

.api-inline-btn {
  font-weight: 600;
  color: #1d4ed8;
}

.api-doc-empty {
  margin: 0;
  color: #64748b;
  font-size: 14px;
}

.api-doc-block + .api-doc-block {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid #e2e8f0;
}

.api-doc-block-title {
  margin: 0 0 8px;
  font-size: 15px;
  color: #0f172a;
}

.api-doc-note {
  margin: 0 0 10px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.45;
}

.api-doc-subtle {
  margin-left: 6px;
  color: #94a3b8;
  font-size: 12px;
}

.api-doc-response-ex + .api-doc-response-ex {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e2e8f0;
}

.endpoint-card-inner {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 14px;
  background: #ffffff;
}

.endpoint-card-inner .endpoint-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.api-path-code {
  color: #1e3a8a;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  padding: 4px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.endpoint-card-inner .endpoint-description {
  margin: 10px 0 12px;
  color: #475569;
  font-size: 14px;
}

.endpoint-card-inner .docs-samples {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.endpoint-card-inner .docs-samples--4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.endpoint-card-inner .docs-samples strong {
  display: block;
  margin-bottom: 6px;
  color: #334155;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.endpoint-card-inner .docs-samples pre {
  min-height: 72px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border-radius: 12px;
  background: #0f172a;
  color: #dbeafe;
  font-size: 11px;
  line-height: 1.45;
}

@media (max-width: 900px) {
  .endpoint-card-inner .docs-samples {
    grid-template-columns: 1fr;
  }
}
</style>
