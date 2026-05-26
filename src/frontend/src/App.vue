<template>
  <main class="admin-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">D</div>
        <div>
          <h1>{{ title }}</h1>
          <p>ORM Admin</p>
        </div>
      </div>

      <nav v-if="models.length > 0" class="model-nav" aria-label="Admin models">
        <router-link
          to="/schema"
          tag="button"
          class="model-nav-item docs-nav-item"
          active-class="active"
        >
          <span class="model-initial">S</span>
          <span>
            <strong>Schema</strong>
            <small>表与外键</small>
          </span>
        </router-link>
        <router-link
          to="/schema-diff"
          tag="button"
          class="model-nav-item docs-nav-item"
          active-class="active"
        >
          <span class="model-initial">D</span>
          <span>
            <strong>数据库差异</strong>
            <small>模型 vs SQLite</small>
          </span>
        </router-link>
        <router-link
          to="/api-explorer"
          tag="button"
          class="model-nav-item docs-nav-item"
          active-class="active"
        >
          <span class="model-initial">P</span>
          <span>
            <strong>API Explorer</strong>
            <small>Postman 风格</small>
          </span>
        </router-link>
        <div v-for="group in modelNavGroups" :key="group.label" class="app-nav-group">
          <p class="app-nav-label">{{ group.label }}</p>
          <router-link
            v-for="model in group.models"
            :key="model.key"
            :to="{ name: 'model', params: { modelKey: model.key } }"
            tag="button"
            class="model-nav-item"
            active-class="active"
          >
            <span class="model-initial">{{ modelDisplayInitial(model) }}</span>
            <span>
              <strong>{{ modelDisplayName(model) }}</strong>
              <small>{{ model.key }}</small>
            </span>
          </router-link>
        </div>
      </nav>
    </aside>

    <section v-if="models.length > 0" class="workspace">
      <header class="workspace-header">
        <div>
          <p class="eyebrow">{{ headerEyebrow }}</p>
          <h2>{{ headerTitle }}</h2>
        </div>
        <div class="header-actions" />
      </header>

      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
        class="error-alert"
      />

      <router-view />
    </section>

    <section v-else-if="!loading" class="workspace workspace--empty">
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
        class="error-alert"
      />
    </section>
  </main>
</template>

<script>
import { requestJson, adminApiUrl } from "./utils/request.js";

export default {
  name: "AdminApp",
  provide() {
    return {
      adminSetError: (msg) => {
        this.error = msg || "";
      },
      adminModels: () => this.models,
    };
  },
  data() {
    return {
      title: "Searea Admin",
      models: [],
      loading: true,
      error: "",
    };
  },
  computed: {
    modelNavGroups() {
      const list = this.models;
      const byApp = new Map();
      const noApp = [];
      for (const m of list) {
        const app = m.admin && m.admin.app ? m.admin.app : null;
        if (!app) {
          noApp.push(m);
          continue;
        }
        if (!byApp.has(app)) {
          byApp.set(app, []);
        }
        byApp.get(app).push(m);
      }
      const sortModels = (arr) =>
        arr.slice().sort((a, b) => {
          const oa = a.admin && a.admin.order != null ? a.admin.order : 999;
          const ob = b.admin && b.admin.order != null ? b.admin.order : 999;
          if (oa !== ob) {
            return oa - ob;
          }
          return (a.modelName || "").localeCompare(b.modelName || "");
        });
      const groups = Array.from(byApp.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, models]) => ({ label, models: sortModels(models) }));
      if (noApp.length) {
        groups.push({ label: "其他", models: sortModels(noApp) });
      }
      return groups;
    },
    headerEyebrow() {
      if (this.$route.name === "schema") {
        return "Schema";
      }
      if (this.$route.name === "schema-diff") {
        return "Schema";
      }
      return "当前模型";
    },
    headerTitle() {
      if (this.$route.name === "schema") {
        return "表关系图";
      }
      if (this.$route.name === "schema-diff") {
        return "数据库差异";
      }
      if (this.$route.name === "api-explorer") {
        return "API Explorer";
      }
      if (this.$route.name === "model") {
        const k = this.$route.params.modelKey;
        const m = this.models.find((x) => x.key === k);
        if (!m) {
          return "Model";
        }
        return (m.admin && m.admin.label) || m.modelName;
      }
      return "Model";
    },
  },
  watch: {
    $route: "onRouteChange",
  },
  created() {
    this.bootstrap();
  },
  methods: {
    onRouteChange() {
      this.applyModelRouteGuards();
    },
    bootstrap() {
      this.loading = true;
      this.error = "";
      requestJson(adminApiUrl("models"))
        .then((models) => {
          this.models = Array.isArray(models) ? models : [];
          if (this.models.length === 0) {
            throw new Error("No admin models registered");
          }
          this.$nextTick(() => {
            this.applyInitialRoute();
          });
        })
        .catch((error) => {
          this.error = error.message || String(error);
        })
        .finally(() => {
          this.loading = false;
        });
    },
    applyInitialRoute() {
      this.applyModelRouteGuards();
      if (this.$route.matched.length === 0) {
        this.$router.replace({ name: "model", params: { modelKey: this.models[0].key } }).catch(() => {});
      }
    },
    applyModelRouteGuards() {
      if (this.models.length === 0) {
        return;
      }
      if (this.$route.name === "model") {
        const k = this.$route.params.modelKey;
        if (k && !this.models.some((m) => m.key === k)) {
          this.$router.replace({ name: "model", params: { modelKey: this.models[0].key } }).catch(() => {});
        }
      }
    },
    modelDisplayName(model) {
      const a = model.admin;
      return (a && a.label) || model.modelName;
    },
    modelDisplayInitial(model) {
      const name = this.modelDisplayName(model);
      return name && name.length > 0 ? name.slice(0, 1) : "?";
    },
  },
};
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 34rem),
    #f8fafc;
  color: #0f172a;
}

.sidebar {
  border-right: 1px solid #dbe4f0;
  background: linear-gradient(180deg, #0f172a 0%, #1e3a8a 100%);
  color: #ffffff;
  padding: 24px 18px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: #f59e0b;
  color: #111827;
  font-weight: 800;
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.28);
}

.brand h1,
.workspace-header h2 {
  margin: 0;
}

.brand h1 {
  font-size: 20px;
  letter-spacing: -0.02em;
}

.brand p,
.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.brand p {
  color: #bfdbfe;
  margin-top: 3px;
}

.model-nav {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.app-nav-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.app-nav-label {
  margin: 0 0 2px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(191, 219, 254, 0.75);
}

.model-nav-item {
  width: 100%;
  border: 1px solid rgba(191, 219, 254, 0.22);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  color: #dbeafe;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  text-decoration: none;
  font: inherit;
  transition:
    background 180ms ease,
    border-color 180ms ease,
    color 180ms ease;
}

.model-nav-item:hover,
.model-nav-item:focus-visible {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(191, 219, 254, 0.5);
  outline: none;
}

.model-nav-item.active {
  background: #ffffff;
  border-color: #ffffff;
  color: #1e3a8a;
}

.model-nav-item strong,
.model-nav-item small {
  display: block;
}

.model-nav-item strong {
  font-size: 14px;
}

.model-nav-item small {
  margin-top: 2px;
  color: inherit;
  opacity: 0.72;
}

.model-initial {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.16);
  font-weight: 700;
}

.model-nav-item.active .model-initial {
  background: #dbeafe;
}

.workspace {
  min-width: 0;
  padding: 28px;
}

.workspace--empty {
  max-width: 640px;
}

.workspace-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  margin-bottom: 18px;
}

.workspace-header h2 {
  color: #0f172a;
  font-size: 28px;
  letter-spacing: -0.03em;
}

.eyebrow {
  color: #1e40af;
  font-weight: 700;
  margin-bottom: 6px;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.error-alert {
  margin-bottom: 16px;
}

.docs-nav-item {
  margin-bottom: 10px;
}

@media (max-width: 520px) {
  .admin-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid #dbe4f0;
  }

  .model-nav {
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .model-nav-item {
    min-width: 190px;
  }

  .workspace {
    padding: 18px 14px;
  }

  .workspace-header,
  .header-actions {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
