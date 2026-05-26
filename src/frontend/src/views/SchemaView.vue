<template>
  <section class="schema-graph-wrap">
    <SchemaGraphView />
  </section>
</template>

<script>
import SchemaGraphView from "./SchemaGraphView.vue";

export default {
  name: "SchemaView",
  components: {
    SchemaGraphView
  }
};
</script>

<style scoped>
.schema-graph-wrap {
  display: block;
}
</style>
