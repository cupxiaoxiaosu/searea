<template>
  <div class="page">
    <div class="toolbar">
      <h2>{{ meta.label }}</h2>
      <div class="actions">
        <el-checkbox v-if="meta.listExpandQuery" v-model="expandFk" class="chk">列表展开关联</el-checkbox>
        <el-button type="primary" icon="el-icon-plus" @click="openCreate">新增</el-button>
        <el-button icon="el-icon-refresh" @click="load">刷新</el-button>
      </div>
    </div>

    <el-table :data="rows" v-loading="loading" stripe border class="table">
      <el-table-column
        v-for="col in visibleColumns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        :min-width="col.prop === 'address' ? 200 : 120"
      >
        <template slot-scope="scope">
          <span v-if="col.prop === 'school' && scope.row.school">
            {{ scope.row.school.name }} (#{{ scope.row.school.id }})
          </span>
          <span v-else-if="col.prop === 'school'">—</span>
          <span v-else>{{ scope.row[col.prop] }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template slot-scope="scope">
          <el-button type="text" class="link-btn" @click="openEdit(scope.row)">编辑</el-button>
          <el-button type="text" class="link-btn danger" @click="removeRow(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog :title="dialogTitle" :visible.sync="dialogVisible" width="520px" @closed="resetForm">
      <el-form ref="form" :model="form" :rules="rules" label-width="100px">
        <el-form-item v-for="f in formFields" :key="f.prop" :label="f.label" :prop="f.prop">
          <el-input v-if="!f.type || f.type === 'string'" v-model="form[f.prop]" :placeholder="f.placeholder" />
          <el-input-number
            v-else-if="f.type === 'number'"
            v-model="form[f.prop]"
            :min="f.min != null ? f.min : undefined"
            controls-position="right"
            style="width: 100%"
          />
          <div v-if="f.hint" class="field-hint">{{ f.hint }}</div>
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button @click="dialogVisible = false">取 消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保 存</el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
import { getJson, postJson, patchJson, deleteJson } from "../api/http.js";
import { API_RESOURCES } from "../api/resources.js";

export default {
  name: "ResourceCrud",
  props: {
    resourceKey: { type: String, required: true },
  },
  data() {
    return {
      loading: false,
      saving: false,
      rows: [],
      expandFk: false,
      dialogVisible: false,
      editingId: null,
      form: {},
    };
  },
  computed: {
    meta() {
      return API_RESOURCES[this.resourceKey];
    },
    dialogTitle() {
      return this.editingId ? `编辑${this.meta.label}` : `新增${this.meta.label}`;
    },
    tableFieldDefs() {
      return this.meta.fields.filter((f) => f.table);
    },
    visibleColumns() {
      const base = this.tableFieldDefs.filter((f) => f.prop !== "school");
      if (this.resourceKey !== "students" || !this.expandFk) {
        return base;
      }
      return [...base, { prop: "school", label: "学校(展开)" }];
    },
    formFields() {
      return this.meta.fields.filter((f) => f.form);
    },
    rules() {
      const r = {};
      for (const f of this.formFields) {
        if (f.required) {
          r[f.prop] = [{ required: true, message: `请填写${f.label}`, trigger: "blur" }];
        }
      }
      return r;
    },
  },
  watch: {
    resourceKey() {
      this.load();
    },
    expandFk() {
      this.load();
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    listPath() {
      const q =
        this.resourceKey === "students" && this.expandFk && this.meta.listExpandQuery
          ? `?${this.meta.listExpandQuery}`
          : "";
      return `/${this.meta.path}${q}`;
    },
    async load() {
      this.loading = true;
      try {
        this.rows = await getJson(this.listPath());
      } catch (e) {
        this.$message.error(e.message);
      } finally {
        this.loading = false;
      }
    },
    buildBodyFromForm() {
      const body = {};
      for (const f of this.formFields) {
        const key = f.submitAs || f.prop;
        let v = this.form[f.prop];
        if (f.type === "number" && v !== "" && v != null) v = Number(v);
        body[key] = v;
      }
      return body;
    },
    openCreate() {
      this.editingId = null;
      this.form = {};
      for (const f of this.formFields) {
        if (f.type === "number") this.$set(this.form, f.prop, f.min != null ? f.min : undefined);
        else this.$set(this.form, f.prop, f.prop === "address" ? "" : "");
      }
      this.dialogVisible = true;
    },
    openEdit(row) {
      this.editingId = row.id;
      this.form = {};
      for (const f of this.formFields) {
        let v = row[f.prop];
        if (f.prop === "school_id" && (v === undefined || v === null) && row.school) {
          v = row.school.id;
        }
        this.$set(this.form, f.prop, v);
      }
      this.dialogVisible = true;
    },
    resetForm() {
      this.editingId = null;
      this.form = {};
      if (this.$refs.form) this.$refs.form.resetFields();
    },
    submit() {
      this.$refs.form.validate((valid) => {
        if (!valid) return;
        this.saving = true;
        const run = async () => {
          try {
            const body = this.buildBodyFromForm();
            if (this.editingId == null) {
              await postJson(`/${this.meta.path}`, body);
              this.$message.success("已创建");
            } else {
              await patchJson(`/${this.meta.path}/${this.editingId}`, body);
              this.$message.success("已保存");
            }
            this.dialogVisible = false;
            await this.load();
          } catch (e) {
            this.$message.error(e.message);
          } finally {
            this.saving = false;
          }
        };
        run();
      });
    },
    removeRow(row) {
      this.$confirm(`确定删除「${row.name || row.id}」?`, "提示", { type: "warning" })
        .then(async () => {
          await deleteJson(`/${this.meta.path}/${row.id}`);
          this.$message.success("已删除");
          await this.load();
        })
        .catch(() => {});
    },
  },
};
</script>

<style scoped>
.page {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.toolbar h2 {
  margin: 0;
  color: #1e40af;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.chk {
  margin-right: 8px;
}
.table {
  width: 100%;
}
.link-btn {
  cursor: pointer;
  padding: 0 6px;
}
.link-btn.danger {
  color: #dc2626;
}
.field-hint {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
}
</style>
