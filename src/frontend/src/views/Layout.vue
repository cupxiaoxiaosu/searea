<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="brand">校园管理</div>
      <el-menu
        :default-active="$route.path"
        router
        background-color="#1e3a8a"
        text-color="#e2e8f0"
        active-text-color="#fbbf24"
      >
        <el-menu-item index="/schools">
          <span>学校</span>
        </el-menu-item>
        <el-menu-item index="/students">
          <span>学生</span>
        </el-menu-item>
        <el-menu-item index="/api-doc">
          <span>API 文档</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-main class="main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script>
export default {
  name: "Layout",
};
</script>

<style scoped>
.layout {
  min-height: 100vh;
}
.aside {
  background: #1e3a8a;
  color: #e2e8f0;
}
.brand {
  padding: 20px 16px;
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.02em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.main {
  padding: 24px;
  background: #f8fafc;
}
</style>
