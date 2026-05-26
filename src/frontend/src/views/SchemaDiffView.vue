<template>
  <div class="schema-diff api-workbench" v-loading="loading">
    <aside class="schema-rail rail">
      <div class="rail-head">
        <div class="rail-brand">
          <span class="rail-logo">SD</span>
          <div class="rail-titles">
            <p class="rail-eyebrow">Database</p>
            <p class="rail-title">Schema Diff</p>
          </div>
        </div>
        <button type="button" class="icon-btn" title="刷新" @click="refresh">
          <i class="el-icon-refresh" />
        </button>
      </div>

      <div class="rail-search">
        <el-input
          v-model="tableQuery"
          size="small"
          prefix-icon="el-icon-search"
          placeholder="Search tables"
          clearable
        />
      </div>

      <div class="rail-filters">
        <el-checkbox v-model="onlyWithDiff">仅显示有差异</el-checkbox>
        <el-checkbox v-model="onlyMissingTables">仅显示未建表</el-checkbox>
      </div>

      <div class="rail-summary">
        <div class="summary-row mono">
          <span>tables</span>
          <strong>{{ schemaSummary.totalTables }}</strong>
        </div>
        <div class="summary-row mono">
          <span>missing</span>
          <strong>{{ schemaSummary.missingTables }}</strong>
        </div>
        <div class="summary-row mono">
          <span>autofix</span>
          <strong>{{ schemaSummary.autoFixable }}</strong>
        </div>
        <div class="summary-row mono">
          <span>migrate</span>
          <strong>{{ schemaSummary.needsMigration }}</strong>
        </div>
      </div>

      <div class="tables-tree">
        <button
          v-for="t in filteredTables"
          :key="t.resourceKey"
          type="button"
          class="table-row"
          :class="{ active: selectedTable && selectedTable.resourceKey === t.resourceKey }"
          @click="openKey = t.resourceKey"
        >
          <span class="table-row-main">
            <span class="table-key mono">{{ t.resourceKey }}</span>
            <span class="table-name mono">{{ t.table }}</span>
          </span>
          <span class="table-badges mono">
            <span class="diff-chip diff-chip--add">+{{ t.diff.missingColumns.length }}</span>
            <span class="diff-chip diff-chip--mod">~{{ t.diff.changedColumns.length }}</span>
            <span class="diff-chip diff-chip--del">-{{ t.diff.extraColumns.length }}</span>
          </span>
          <span class="table-state mono" :class="t.exists ? 'ok' : 'bad'">
            {{ t.exists ? "OK" : "MISSING" }}
          </span>
        </button>

        <div v-if="!loading && filteredTables.length === 0" class="collections-empty">
          No matches
        </div>
      </div>
    </aside>

    <section class="workbench">
      <div class="workbench-stack">
        <div class="schema-toolbar">
          <div class="schema-title">
            <span class="schema-dot" :class="dialectClass" />
            <div>
              <div class="schema-eyebrow mono">{{ dialectLabel }} / SCHEMA</div>
              <div class="schema-heading">
                {{ selectedTable ? selectedTable.resourceKey : "No table selected" }}
              </div>
            </div>
          </div>

          <div class="schema-actions">
            <el-tooltip
              content="迁移会统一处理建表/加列/改列/删列；包含改列/删列时默认禁用，开启后每次执行仍会二次确认。"
              placement="bottom"
            >
              <span class="switch-wrap">
                <el-switch
                  v-model="dangerMode"
                  active-text="允许高风险"
                  inactive-text="普通模式"
                  active-color="#ef4444"
                  inactive-color="#757575"
                />
              </span>
            </el-tooltip>
            <button type="button" class="ghost-btn" :disabled="loading" @click="refresh">
              <i class="el-icon-refresh" />
              刷新
            </button>
            <el-button type="primary" size="small" class="send-pill" :loading="syncing" @click="migrateAll">
              执行迁移
            </el-button>
          </div>
        </div>

        <div class="schema-meta">
          <div class="breadcrumb mono">
            <span class="bc-muted">{{ selectedTable ? selectedTable.table : "…" }}</span>
            <span class="bc-sep">/</span>
            <span>{{ selectedTable && selectedTable.exists ? "ready" : "missing" }}</span>
          </div>
          <div v-if="selectedTable" class="case-tools">
            <span class="status-chip" :data-band="selectedTable.exists ? 'ok' : 'server'">
              {{ selectedTable.exists ? "已建表" : "未建表" }}
            </span>
            <span class="stat mono">+{{ selectedTable.diff.missingColumns.length }}</span>
            <span class="stat mono">~{{ selectedTable.diff.changedColumns.length }}</span>
            <span class="stat mono">-{{ selectedTable.diff.extraColumns.length }}</span>
            <el-button
              v-if="tableMigrationAllowed(selectedTable)"
              size="mini"
              type="warning"
              plain
              :loading="runningKey === `${selectedTable.resourceKey}:runMigration`"
              :disabled="tableHasHighRisk(selectedTable) && !dangerMode"
              @click="runTableMigration(selectedTable)"
            >
              表级迁移
            </el-button>
          </div>
        </div>

        <div class="workbench-body">
          <el-alert
            v-if="canCreateMissingTables"
            type="warning"
            :closable="false"
            show-icon
            class="notice"
            title="存在尚未创建的表"
            :description="`共 ${schemaSummary.missingTables} 个。请点击「执行迁移」统一处理。`"
          />

          <el-alert
            v-if="error"
            :title="error"
            type="error"
            :closable="false"
            show-icon
            class="notice"
          />

          <el-empty v-if="!loading && !diff" description="暂无数据" />

          <el-empty v-else-if="diff && !selectedTable" description="暂无匹配表" />

          <template v-else-if="selectedTable">
            <div class="section">
              <div class="section-head">
                <div>
                  <h3>字段差异</h3>
                  <p class="tab-desc muted">type 区分 create / modify / delete，SQL 操作保持原有迁移逻辑。</p>
                </div>
              </div>

              <el-table :data="buildDiffRows(selectedTable)" size="mini" class="pm-table diff-table" stripe border>
                <el-table-column prop="type" label="TYPE" width="96">
                  <template #default="{ row }">
                    <el-tag v-if="row.type === 'create'" size="mini" type="success">create</el-tag>
                    <el-tag v-else-if="row.type === 'modify'" size="mini" type="warning">modify</el-tag>
                    <el-tag v-else size="mini" type="danger">delete</el-tag>
                  </template>
                </el-table-column>

                <el-table-column prop="name" label="COLUMN" width="180" />

                <el-table-column label="CHANGES" width="190">
                  <template #default="{ row }">
                    <template v-if="row.type === 'modify'">
                      <el-tag v-for="c in row.changes" :key="c" size="mini" class="change-tag">{{ c }}</el-tag>
                    </template>
                    <span v-else class="muted">-</span>
                  </template>
                </el-table-column>

                <el-table-column label="ACTUAL">
                  <template #default="{ row }">
                    <template v-if="row.actual">
                      <code>{{ row.actual.typeSql }}</code>
                      <span v-if="row.actual.notnull" class="pill">NOT NULL</span>
                      <span v-if="row.actual.default !== undefined" class="pill">DEFAULT {{ row.actual.default }}</span>
                    </template>
                    <span v-else class="muted">-</span>
                  </template>
                </el-table-column>

                <el-table-column label="EXPECTED">
                  <template #default="{ row }">
                    <template v-if="row.expected">
                      <code>{{ row.expected.typeSql }}</code>
                      <span v-if="row.expected.notnull" class="pill">NOT NULL</span>
                      <span v-if="row.expected.default !== undefined" class="pill">DEFAULT {{ row.expected.default }}</span>
                    </template>
                    <span v-else class="muted">-</span>
                  </template>
                </el-table-column>

                <el-table-column label="SQL" min-width="260">
                  <template #default="{ row }">
                    <div v-if="row.sqlText" class="sql-cell">
                      <span class="sql-inline">{{ inlineSqlText(row) }}</span>
                      <div class="sql-actions">
                        <button type="button" class="linkish" @click="openSql(row)">查看</button>
                        <button type="button" class="linkish" @click="copySql(row.sqlText)">复制</button>
                      </div>
                    </div>
                    <span v-else class="muted">（无）</span>
                  </template>
                </el-table-column>

                <el-table-column label="RUN" width="92">
                  <template #default="{ row }">
                    <el-tooltip
                      :disabled="row.runnable && (!row.isDangerous || dangerMode)"
                      :content="row.runDisabledReason || '不可执行'"
                      placement="top"
                    >
                      <span class="run-wrap">
                        <el-button
                          size="mini"
                          type="primary"
                          :disabled="!row.runnable || runningKey === row.runKey || (row.isDangerous && !dangerMode)"
                          :loading="runningKey === row.runKey"
                          @click="runRow(row)"
                        >
                          Run
                        </el-button>
                      </span>
                    </el-tooltip>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <div v-if="(selectedTable.diff.warnings || []).length" class="section">
              <h3>警告</h3>
              <el-alert
                v-for="(w, idx) in selectedTable.diff.warnings"
                :key="idx"
                :title="w"
                type="warning"
                :closable="false"
                show-icon
                class="warn"
              />
            </div>

            <div v-if="migrationSqlByTable && migrationSqlByTable[selectedTable.resourceKey]" class="response-pane sql-pane">
              <div class="response-toolbar">
                <div class="response-title">
                  Migration SQL
                  <span class="status-chip status-chip--idle">preview</span>
                </div>
                <button
                  type="button"
                  class="ghost-btn"
                  @click="copySql(migrationSqlByTable[selectedTable.resourceKey])"
                >
                  <i class="el-icon-document-copy" />
                  Copy SQL
                </button>
              </div>
              <pre class="resp-body">{{ migrationSqlByTable[selectedTable.resourceKey] }}</pre>
            </div>
          </template>
        </div>
      </div>
    </section>

    <el-dialog :visible.sync="sqlDialogVisible" width="720px" custom-class="sql-dialog">
      <template #title>
        <span class="mono">{{ sqlDialogTitle }}</span>
      </template>
      <pre class="resp-body dialog-sql">{{ sqlDialogText }}</pre>
      <template #footer>
        <el-button size="small" @click="sqlDialogVisible = false">关闭</el-button>
        <el-button size="small" type="primary" @click="copySql(sqlDialogText)">复制 SQL</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { requestJson, adminApiUrl } from "../utils/request.js";

export default {
  name: "SchemaDiffView",
  data() {
    return {
      loading: false,
      syncing: false,
      runningKey: "",
      error: "",
      diff: null,
      migrationSqlByTable: null,
      openKey: "",
      dangerMode: false,
      tableQuery: "",
      onlyWithDiff: false,
      onlyMissingTables: false,
      sqlDialogVisible: false,
      sqlDialogTitle: "",
      sqlDialogText: "",
    };
  },
  created() {
    this.refresh();
  },
  computed: {
    dialectLabel() {
      const d = this.diff && this.diff.tables && this.diff.tables[0] ? this.diff.tables[0].dialect : "";
      return d ? d.toUpperCase() : "DB";
    },
    dialectClass() {
      const d = this.diff && this.diff.tables && this.diff.tables[0] ? this.diff.tables[0].dialect : "";
      if (d === "mysql") return "mysql";
      if (d === "sqlite") return "sqlite";
      return "unknown";
    },
    canCreateMissingTables() {
      return this.schemaSummary.missingTables > 0;
    },
    schemaSummary() {
      const tables = (this.diff && this.diff.tables) ? this.diff.tables : [];
      let autoFixable = 0;
      let needsMigration = 0;
      for (const t of tables) {
        if (!t.exists) autoFixable += 1;
        autoFixable += t.diff.missingColumns.length;
        needsMigration += t.diff.extraColumns.length + t.diff.changedColumns.length;
      }
      return {
        totalTables: tables.length,
        missingTables: tables.filter((t) => !t.exists).length,
        autoFixable,
        needsMigration,
      };
    },
    filteredTables() {
      const tables = (this.diff && this.diff.tables) ? this.diff.tables : [];
      const q = String(this.tableQuery || "").trim().toLowerCase();
      return tables.filter((t) => {
        if (this.onlyMissingTables && t.exists) return false;
        if (this.onlyWithDiff) {
          const has = (t.diff?.missingColumns?.length || 0) + (t.diff?.changedColumns?.length || 0) + (t.diff?.extraColumns?.length || 0);
          if (!has) return false;
        }
        if (!q) return true;
        return String(t.resourceKey || "").toLowerCase().includes(q) || String(t.table || "").toLowerCase().includes(q);
      });
    },
    selectedTable() {
      const tables = this.filteredTables;
      if (!tables.length) return null;
      return tables.find((t) => t.resourceKey === this.openKey) || tables[0];
    },
  },
  methods: {
    tableMigrationAllowed(t) {
      return Boolean(t && t.serverSql && t.serverSql.canRunMigration);
    },
    tableHasHighRisk(t) {
      return Boolean(
        t &&
          t.diff &&
          ((t.diff.changedColumns && t.diff.changedColumns.length > 0) ||
            (t.diff.extraColumns && t.diff.extraColumns.length > 0))
      );
    },
    /** SQLite 表重建：存在 __new 临时表脚本且无 INSERT，表示无同名列可拷贝，需手工迁数据。 */
    migrationNeedsManualInsert(migrationSql) {
      if (!migrationSql || typeof migrationSql !== "string") return false;
      if (!/__new["`]/.test(migrationSql)) return false;
      return !/\bINSERT\s+INTO\b/i.test(migrationSql);
    },
    buildDiffRows(t) {
      const rows = [];
      const migrationSql = this.formatSql(t && t.serverSql && t.serverSql.migrationSql);
      const hasRisky =
        (t.diff.changedColumns && t.diff.changedColumns.length > 0) ||
        (t.diff.extraColumns && t.diff.extraColumns.length > 0);
      const canRunMigration = this.tableMigrationAllowed(t);
      for (const c of t.diff.missingColumns || []) {
        const exp = c.expected;
        const runnable = canRunMigration;
        let runDisabledReason = "";
        if (!canRunMigration) {
          if (exp.primaryKey) runDisabledReason = "主键列不能通过 ADD COLUMN 补齐。";
          else if (exp.notnull && exp.default === undefined) {
            runDisabledReason = "NOT NULL 且无 DEFAULT：需要手工补齐数据或 DEFAULT 后再执行迁移。";
          } else runDisabledReason = "当前无法执行迁移。";
        } else if (hasRisky && !this.dangerMode) {
          runDisabledReason = "高风险：请先开启右上角「允许高风险」。";
        }
        rows.push({
          type: "create",
          name: c.name,
          actual: null,
          expected: c.expected,
          changes: [],
          sqlText: migrationSql,
          runnable,
          runDisabledReason,
          runKey: `${t.resourceKey}:runMigration`,
          runPayload: canRunMigration ? { diff: this.diff, resourceKey: t.resourceKey } : null,
          isDangerous: hasRisky,
        });
      }
      for (const c of t.diff.changedColumns || []) {
        let runDisabledReason = "";
        if (!canRunMigration) {
          if (!t.exists) runDisabledReason = "未建表：请先执行迁移创建表。";
          else if (!hasRisky) runDisabledReason = "无改列/删列差异。";
          else if (!migrationSql) runDisabledReason = "无法生成 Migration SQL。";
          else if (this.migrationNeedsManualInsert(migrationSql)) {
            runDisabledReason = "SQLite 重建表但无同名列可拷贝，需手工写 INSERT，无法一键执行。";
          } else runDisabledReason = "当前无法执行迁移。";
        } else if (!this.dangerMode) {
          runDisabledReason = "高风险：请先开启右上角「允许高风险」。";
        }
        rows.push({
          type: "modify",
          name: c.name,
          actual: c.actual,
          expected: c.expected,
          changes: c.changes || [],
          sqlText: migrationSql || "（无单行 SQL：请以下方 Migration SQL 为准）",
          runnable: canRunMigration,
          runDisabledReason,
          runKey: `${t.resourceKey}:runMigration`,
          runPayload: canRunMigration
            ? { diff: this.diff, resourceKey: t.resourceKey }
            : null,
          isDangerous: true,
        });
      }
      for (const c of t.diff.extraColumns || []) {
        let runDisabledReason = "";
        if (!canRunMigration) {
          if (!t.exists) runDisabledReason = "未建表：请先执行迁移创建表。";
          else if (!hasRisky) runDisabledReason = "无删列/改列差异。";
          else if (!migrationSql) runDisabledReason = "无法生成 Migration SQL。";
          else if (this.migrationNeedsManualInsert(migrationSql)) {
            runDisabledReason = "SQLite 重建表但无同名列可拷贝，需手工写 INSERT，无法一键执行。";
          } else runDisabledReason = "当前无法执行迁移。";
        } else if (!this.dangerMode) {
          runDisabledReason = "高风险：请先开启右上角「允许高风险」。";
        }
        rows.push({
          type: "delete",
          name: c.name,
          actual: c.actual,
          expected: null,
          changes: [],
          sqlText: migrationSql || "（无单行 SQL：请以下方 Migration SQL 为准）",
          runnable: canRunMigration,
          runDisabledReason,
          runKey: `${t.resourceKey}:runMigration`,
          runPayload: canRunMigration
            ? { diff: this.diff, resourceKey: t.resourceKey }
            : null,
          isDangerous: true,
        });
      }
      const order = { modify: 1, create: 2, delete: 3 };
      rows.sort((a, b) => {
        const oa = order[a.type] || 9;
        const ob = order[b.type] || 9;
        if (oa !== ob) return oa - ob;
        return String(a.name).localeCompare(String(b.name));
      });
      return rows;
    },
    inlineSqlText(row) {
      if (!row || !row.sqlText) return "";
      if (row.type === "modify" || row.type === "delete") {
        return "Migration SQL（内容较长，点击「查看」）";
      }
      const text = String(row.sqlText).replace(/\s+/g, " ").trim();
      if (text.length <= 120) return text;
      return `${text.slice(0, 117)}...`;
    },
    async runTableMigration(t) {
      if (!this.tableMigrationAllowed(t)) return;
      if (this.tableHasHighRisk(t) && !this.dangerMode) return;
      await this.runRow({
        runnable: true,
        runKey: `${t.resourceKey}:runMigration`,
        runPayload: { diff: this.diff, resourceKey: t.resourceKey },
        isDangerous: this.tableHasHighRisk(t),
      });
    },
    async runRow(row) {
      if (!row || !row.runnable || !row.runPayload) return;
      if (row.isDangerous) {
        if (!this.dangerMode) return;
        const ok = window.confirm(
          "将执行高风险迁移（可能改列/删列）。\n\n建议：先复制/备份数据。\n\n确认继续？"
        );
        if (!ok) return;
      }
      this.runningKey = row.runKey || "";
      this.error = "";
      try {
        const res = await requestJson(adminApiUrl("schema-migrate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row.runPayload),
        });
        this.diff = res.after;
        this.migrationSqlByTable = this.buildMigrationMap(this.diff);
      } catch (e) {
        this.error = e.message || String(e);
      } finally {
        this.runningKey = "";
      }
    },
    openSql(row) {
      this.sqlDialogTitle = `${row.type || ""} ${row.name || ""}`.trim();
      this.sqlDialogText = row.sqlText || "";
      this.sqlDialogVisible = true;
    },
    async copySql(text) {
      const t = String(text || "");
      if (!t) return;
      try {
        await navigator.clipboard.writeText(t);
      } catch {
        // fallback
        const el = document.createElement("textarea");
        el.value = t;
        el.setAttribute("readonly", "true");
        el.style.position = "fixed";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      this.$message && this.$message.success ? this.$message.success("已复制") : null;
    },
    formatSql(sql) {
      if (Array.isArray(sql)) return sql.join("\n");
      return String(sql || "");
    },
    buildMigrationMap(diff) {
      const out = {};
      for (const t of diff?.tables || []) {
        const sql = this.formatSql(t?.serverSql?.migrationSql);
        if (sql) out[t.resourceKey] = sql;
      }
      return out;
    },
    async refresh() {
      this.loading = true;
      this.error = "";
      try {
        this.diff = await requestJson(adminApiUrl("schema-diff"));
        this.migrationSqlByTable = this.buildMigrationMap(this.diff);
        const miss = this.diff && this.diff.tables ? this.diff.tables.find((x) => !x.exists) : null;
        const first = this.diff && this.diff.tables && this.diff.tables[0] ? this.diff.tables[0].resourceKey : "";
        this.openKey = (miss && miss.resourceKey) || first || "";
      } catch (e) {
        this.error = e.message || String(e);
      } finally {
        this.loading = false;
      }
    },
    async migrateAll() {
      this.syncing = true;
      this.error = "";
      try {
        const hasHighRisk = (this.diff?.tables || []).some((t) => this.tableHasHighRisk(t));
        if (hasHighRisk && !this.dangerMode) {
          this.error = "存在改列/删列迁移，请先开启「允许高风险」。";
          return;
        }
        if (hasHighRisk) {
          const ok = window.confirm(
            "将执行高风险迁移（可能改列/删列）。\n\n建议：先复制/备份数据。\n\n确认继续？"
          );
          if (!ok) return;
        }
        const res = await requestJson(adminApiUrl("schema-migrate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diff: this.diff }),
        });
        this.diff = res.after;
        this.migrationSqlByTable = this.buildMigrationMap(this.diff);
      } catch (e) {
        this.error = e.message || String(e);
      } finally {
        this.syncing = false;
      }
    },
  },
};
</script>

<style scoped>
.api-workbench {
  display: grid;
  grid-template-columns: 292px minmax(0, 1fr);
  align-items: stretch;
  isolation: isolate;
  height: calc(100vh - 168px);
  min-height: 560px;
  max-height: calc(100vh - 120px);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #d9d9d9;
  background: #ffffff;
  color: #212121;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
}

.api-workbench::v-deep .el-button,
.api-workbench::v-deep .el-input__inner,
.api-workbench::v-deep .el-textarea__inner,
.api-workbench::v-deep .el-tabs__item,
.api-workbench::v-deep .el-select-dropdown__item {
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
  font-size: 12px;
  font-weight: 900;
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
  padding: 10px 12px 8px;
}

.rail-search::v-deep .el-input__inner {
  border-radius: 8px;
  border-color: #cfcfcf;
  background: #ffffff;
}

.rail-filters {
  display: grid;
  gap: 4px;
  padding: 0 12px 10px;
  border-bottom: 1px solid #e6e6e6;
}

.rail-filters::v-deep .el-checkbox {
  margin-right: 0;
  color: #616161;
  font-weight: 600;
}

.rail-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid #e6e6e6;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  background: #ffffff;
  color: #757575;
  font-size: 11px;
}

.summary-row strong {
  color: #212121;
}

.tables-tree {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 8px 10px 14px;
}

.table-row {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 8px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #303030;
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.table-row + .table-row {
  margin-top: 4px;
}

.table-row:hover {
  background: rgba(0, 0, 0, 0.04);
}

.table-row.active {
  background: rgba(255, 108, 55, 0.14);
  border-color: rgba(255, 108, 55, 0.35);
}

.table-row-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.table-key {
  font-size: 12px;
  font-weight: 800;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-name {
  font-size: 11px;
  color: #757575;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-badges {
  display: inline-flex;
  gap: 4px;
  justify-self: end;
  font-size: 10px;
}

.diff-chip {
  min-width: 26px;
  padding: 3px 5px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
  text-align: center;
  font-weight: 900;
}

.diff-chip--add {
  color: #047857;
  border-color: rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.1);
}

.diff-chip--mod {
  color: #d97706;
  border-color: rgba(217, 119, 6, 0.35);
  background: rgba(217, 119, 6, 0.1);
}

.diff-chip--del {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.35);
  background: rgba(220, 38, 38, 0.08);
}

.table-state {
  grid-column: 2;
  justify-self: end;
  font-size: 10px;
  font-weight: 900;
}

.table-state.ok {
  color: #047857;
}

.table-state.bad {
  color: #dc2626;
}

.collections-empty {
  padding: 16px 10px;
  color: #757575;
  font-size: 13px;
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

.schema-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
}

.schema-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.schema-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
  flex-shrink: 0;
  background: #9e9e9e;
  box-shadow: 0 0 0 4px rgba(158, 158, 158, 0.12);
}

.schema-dot.mysql {
  background: #d97706;
  box-shadow: 0 0 0 4px rgba(217, 119, 6, 0.12);
}

.schema-dot.sqlite {
  background: #ff6c37;
  box-shadow: 0 0 0 4px rgba(255, 108, 55, 0.14);
}

.schema-eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #757575;
  font-weight: 900;
  text-transform: uppercase;
}

.schema-heading {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 900;
  color: #212121;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.switch-wrap {
  display: inline-block;
  padding-right: 4px;
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

.schema-meta {
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

.workbench-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
}

.notice {
  margin-bottom: 12px;
}

.section {
  margin: 0 0 16px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 8px;
}

.section h3 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 900;
  color: #212121;
}

.tab-desc {
  font-size: 12px;
  margin: 0;
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

.diff-table::v-deep .el-table__body-wrapper {
  overflow-x: auto;
}

.pill {
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  border: 1px solid rgba(255, 108, 55, 0.22);
  background: rgba(255, 108, 55, 0.08);
  color: #bf4c1f;
}

.sql-cell {
  display: grid;
  gap: 6px;
}

.sql-actions {
  display: inline-flex;
  gap: 8px;
}

.linkish {
  border: none;
  background: transparent;
  padding: 2px 0;
  font-size: 12px;
  font-weight: 800;
  color: #ff6c37;
  cursor: pointer;
}

.change-tag {
  margin-right: 6px;
}

.warn {
  margin: 6px 0;
}

.sql-inline {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.run-wrap {
  display: inline-block;
}

.run-wrap::v-deep .el-button--primary {
  background: #ff6c37;
  border-color: #ff6c37;
}

.response-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  overflow: hidden;
}

.response-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
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

.resp-body {
  margin: 0;
  padding: 14px 16px;
  min-height: 220px;
  max-height: 36vh;
  box-sizing: border-box;
  overflow: auto;
  font-size: 12px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  color: #e5e7eb;
  background: #1e1e1e;
  border-top: 1px solid #2a2a2a;
}

.dialog-sql {
  max-height: 52vh;
}

::v-deep .sql-dialog .el-dialog__header {
  border-bottom: 1px solid #e8e8e8;
}

@media (max-width: 980px) {
  .api-workbench {
    height: auto;
    max-height: none;
    grid-template-columns: 1fr;
  }

  .rail {
    border-right: 0;
    border-bottom: 1px solid #e0e0e0;
    max-height: 360px;
    min-height: 0;
  }

  .schema-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .schema-actions {
    justify-content: flex-start;
  }
}
</style>

