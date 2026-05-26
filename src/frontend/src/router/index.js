import Vue from "vue";
import Router from "vue-router";

import ModelView from "../views/ModelView.vue";
import SchemaView from "../views/SchemaView.vue";
import SchemaDiffView from "../views/SchemaDiffView.vue";
import ApiExplorerView from "../views/ApiExplorerView.vue";

Vue.use(Router);

export default new Router({
  mode: "history",
  base: import.meta.env.BASE_URL,
  routes: [
    { path: "/schema", name: "schema", component: SchemaView },
    { path: "/schema-diff", name: "schema-diff", component: SchemaDiffView },
    { path: "/api-explorer", name: "api-explorer", component: ApiExplorerView },
    {
      path: "/model/:modelKey",
      name: "model",
      component: ModelView,
      props: true,
    },
  ],
});
