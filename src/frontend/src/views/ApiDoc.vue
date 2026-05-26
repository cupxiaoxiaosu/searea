<template>
  <div class="doc">
    <h1>REST API 说明</h1>
    <p class="lead">
      与 Koa 中间件 <code>createKoaRestMiddleware</code> 一致；公共前缀 <code>{{ base }}</code>（开发环境由 Vite 代理到后端）。
    </p>

    <el-card v-for="(meta, key) in resources" :key="key" class="block" shadow="hover">
      <div slot="header">
        <span class="card-title">{{ meta.label }}</span>
        <el-tag size="small" type="info">{{ key }}</el-tag>
      </div>
      <p class="muted">{{ meta.description }}</p>
      <el-table :data="endpointsFor(key)" border size="small" class="ep-table">
        <el-table-column prop="method" label="方法" width="90" />
        <el-table-column prop="path" label="路径" min-width="220" />
        <el-table-column prop="desc" label="说明" />
      </el-table>
      <p v-if="meta.listExpandQuery" class="hint">
        列表/详情支持查询参数 <code>?{{ meta.listExpandQuery }}</code>：展开外键嵌套对象，且不返回对应的 <code>*_id</code> 标量。
      </p>
    </el-card>
  </div>
</template>

<script>
import { BACKEND_PATH } from "../config.js";
import { API_RESOURCES } from "../api/resources.js";

export default {
  name: "ApiDoc",
  data() {
    return {
      base: BACKEND_PATH,
      resources: API_RESOURCES,
    };
  },
  methods: {
    endpointsFor(resourceKey) {
      const p = `${BACKEND_PATH}/${API_RESOURCES[resourceKey].path}`;
      return [
        { method: "GET", path: p, desc: "列表（JSON 数组）" },
        { method: "GET", path: `${p}/:id`, desc: "单条详情" },
        { method: "POST", path: p, desc: "创建；响应 201，Location 指向新资源" },
        { method: "PATCH", path: `${p}/:id`, desc: "部分更新可写字段" },
        { method: "PUT", path: `${p}/:id`, desc: "同 PATCH" },
        { method: "DELETE", path: `${p}/:id`, desc: "删除；成功 204" },
      ];
    },
  },
};
</script>

<style scoped>
.doc h1 {
  margin-top: 0;
  color: #1e40af;
}
.lead {
  max-width: 720px;
  line-height: 1.6;
}
.block {
  margin-bottom: 20px;
}
.card-title {
  font-weight: 600;
}
.muted {
  color: #475569;
  margin: 0 0 12px;
}
.hint {
  margin: 12px 0 0;
  font-size: 13px;
  color: #64748b;
}
.ep-table {
  margin-top: 8px;
}
</style>
