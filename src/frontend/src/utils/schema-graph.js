/**
 * Table singularization (aligned with packages/db-sqlite schema-compiler).
 * @param {string} table
 * @returns {string}
 */
export function singularize(table) {
  if (table.length > 1 && table.endsWith("s")) {
    return table.slice(0, -1);
  }
  return table;
}

/**
 * @param {string} typeLabel
 * @param {Record<string, unknown>} field
 * @returns {string}
 */
export function fieldTypeLabel(field) {
  const k = field && typeof field === "object" ? field.kind : "";
  if (k === "auto") {
    return "AutoField";
  }
  if (k === "integer") {
    return "IntegerField";
  }
  if (k === "char") {
    const m = field.max_length;
    return m != null ? `CharField(max_length=${m})` : "CharField";
  }
  if (k === "text") {
    return "TextField";
  }
  if (k === "boolean") {
    return "BooleanField";
  }
  if (k === "datetime") {
    return "DateTimeField";
  }
  if (k === "foreign_key") {
    return `ForeignKey → ${field.target ?? "?"}`;
  }
  if (k === "one_to_one") {
    return `OneToOneField → ${field.target ?? "?"}`;
  }
  if (k === "many_to_many") {
    return `ManyToManyField → ${field.target ?? "?"}`;
  }
  return k || "unknown";
}

/**
 * @typedef {{ key: string, modelName: string, table: string }} ModelRow
 * @typedef {{ modelName: string, table: string, fields: Record<string, unknown> }} ModelMeta
 *
 * @param {ModelRow[]} modelRows
 * @param {Record<string, ModelMeta>} metaByKey
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildSchemaGraph(modelRows, metaByKey) {
  /** @type {Map<string, { key: string | null, modelName: string, table: string, fields: Record<string, unknown>, synthetic: boolean }>} */
  const nodes = new Map();

  for (const row of modelRows) {
    const meta = metaByKey[row.key];
    if (!meta) {
      continue;
    }
    nodes.set(meta.table, {
      key: row.key,
      modelName: meta.modelName,
      table: meta.table,
      fields: meta.fields,
      synthetic: false
    });
  }

  /** @type {Array<{ fromTable: string, fromField: string, toTable: string, toField: string | null, kind: string }>} */
  const edges = [];
  for (const row of modelRows) {
    const meta = metaByKey[row.key];
    if (!meta) {
      continue;
    }
    for (const [fieldName, field] of Object.entries(meta.fields)) {
      const f = field;
      if (!f || typeof f !== "object" || !("kind" in f)) {
        continue;
      }
      if (f.kind === "foreign_key" || f.kind === "one_to_one") {
        if (typeof f.target === "string") {
          edges.push({
            fromTable: meta.table,
            fromField: fieldName,
            toTable: f.target,
            toField: "id",
            kind: f.kind
          });
        }
        continue;
      }
      if (f.kind === "many_to_many" && typeof f.target === "string") {
        const throughTable =
          typeof f.through === "string" && f.through.length > 0
            ? f.through
            : `${singularize(meta.table)}_${fieldName}`;
        const hadThrough = nodes.has(throughTable);
        if (!hadThrough) {
          const sourceSing = singularize(meta.table);
          const targetSing = singularize(f.target);
          const sk = `${sourceSing}_id`;
          const tk = `${targetSing}_id`;
          nodes.set(throughTable, {
            key: null,
            modelName: `${throughTable} (M2M)`,
            table: throughTable,
            fields: {
              [sk]: { kind: "foreign_key", target: meta.table },
              [tk]: { kind: "foreign_key", target: f.target }
            },
            synthetic: true
          });
          edges.push(
            {
              fromTable: throughTable,
              fromField: sk,
              toTable: meta.table,
              toField: "id",
              kind: "foreign_key"
            },
            {
              fromTable: throughTable,
              fromField: tk,
              toTable: f.target,
              toField: "id",
              kind: "foreign_key"
            }
          );
        }
        edges.push({
          fromTable: meta.table,
          fromField: fieldName,
          toTable: throughTable,
          toField: null,
          kind: "many_to_many"
        });
      }
    }
  }

  const seen = new Set();
  const uniqueEdges = edges.filter((e) => {
    const k = `${e.fromTable}.${e.fromField}->${e.toTable}.${e.toField ?? "_card"}`;
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });

  const nodeList = [...nodes.values()];
  nodeList.sort((a, b) => a.table.localeCompare(b.table));
  return { nodes: nodeList, edges: uniqueEdges };
}

/**
 * Rows of table cards: referenced tables (FK/M2M targets) are placed in later rows.
 * Edges that point FROM a synthetic M2M through table are ignored for ranking only
 * (they would create a cycle: book → through → book).
 *
 * @param {object[]} nodes
 * @param {object[]} edges
 * @returns {object[][]} outer = row top-to-bottom, inner = left-to-right
 */
export function buildLayoutRows(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }
  const byTable = new Map(nodes.map((n) => [n.table, n]));
  const syntheticFrom = new Set(
    nodes.filter((n) => n.synthetic).map((n) => n.table)
  );
  const layoutEdges = edges.filter(
    (e) => !(e.kind === "foreign_key" && syntheticFrom.has(e.fromTable))
  );
  const nextRank = new Map();
  for (const n of nodes) {
    nextRank.set(n.table, 0);
  }
  const n = nodes.length;
  for (let k = 0; k < n + 2; k += 1) {
    for (const e of layoutEdges) {
      if (!byTable.has(e.fromTable) || !byTable.has(e.toTable)) {
        continue;
      }
      const f = e.fromTable;
      const t = e.toTable;
      nextRank.set(t, Math.max(nextRank.get(t) ?? 0, (nextRank.get(f) ?? 0) + 1));
    }
  }
  const rowMap = new Map();
  let maxR = 0;
  for (const node of nodes) {
    const r = nextRank.get(node.table) ?? 0;
    maxR = Math.max(maxR, r);
    if (!rowMap.has(r)) {
      rowMap.set(r, []);
    }
    rowMap.get(r).push(node);
  }
  const rows = [];
  for (let r = 0; r <= maxR; r += 1) {
    if (rowMap.has(r)) {
      const row = rowMap.get(r);
      row.sort((a, b) => a.table.localeCompare(b.table));
      rows.push(row);
    }
  }
  return rows;
}
