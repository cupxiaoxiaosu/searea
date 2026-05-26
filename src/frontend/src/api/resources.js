/**
 * 与 examples/tutorials/koa-rest/koa-rest-server.mjs 中 `models` 的 key 对齐（schools / students）。
 * 用于表格列、表单字段与 API 文档页。
 */
export const API_RESOURCES = {
  schools: {
    label: "学校",
    path: "schools",
    description: "学校基础信息",
    fields: [
      { prop: "id", label: "ID", table: true, form: false },
      { prop: "name", label: "名称", table: true, form: true, required: true, placeholder: "学校名称" },
      { prop: "address", label: "地址", table: true, form: true, required: false, placeholder: "可空" },
      { prop: "size", label: "规模", table: true, form: true, required: true, type: "number", min: 0 },
    ],
  },
  students: {
    label: "学生",
    path: "students",
    description: "学生及其所属学校（外键 school）",
    listExpandQuery: "expand=school",
    fields: [
      { prop: "id", label: "ID", table: true, form: false },
      { prop: "name", label: "姓名", table: true, form: true, required: true },
      { prop: "age", label: "年龄", table: true, form: true, required: true, type: "number", min: 0 },
      {
        prop: "school_id",
        label: "学校",
        table: true,
        form: true,
        required: true,
        type: "number",
        min: 1,
        submitAs: "school",
        hint: "请求体字段为 school（数值 id），与 ORM 一致",
      },
    ],
  },
};
