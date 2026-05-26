function normalizeSqlType(s) {
  return String(s ?? "").trim().toUpperCase();
}

function typeAffinity(sqlType) {
  const t = normalizeSqlType(sqlType);
  if (!t) return "unknown";
  // SQLite affinity rules (simplified)
  if (t.includes("INT")) return "integer";
  if (t.includes("CHAR") || t.includes("CLOB") || t.includes("TEXT")) return "text";
  if (t.includes("BLOB")) return "blob";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "real";
  return "numeric";
}

function quoteIdentForDialect(name, dialect) {
  return dialect === "mysql"
    ? `\`${String(name).replaceAll("`", "``")}\``
    : `"${String(name).replaceAll('"', '""')}"`;
}

function buildAddColumnSql({ table, columnName, expected, dialect }) {
  const tblName = quoteIdentForDialect(table, dialect);
  return `ALTER TABLE ${tblName} ADD COLUMN ${buildColumnDefinition({
    columnName,
    column: expected,
    dialect,
  })};`;
}

function buildColumnDefinition({ columnName, column, dialect }) {
  const colName = quoteIdentForDialect(columnName, dialect);
  if (column.primaryKey) return `${colName} ${column.typeSql}`;
  const parts = [colName, column.typeSql, column.notnull ? "NOT NULL" : ""];
  if (column.default !== undefined) parts.push(`DEFAULT ${sqlLiteral(column.default)}`);
  return parts.filter(Boolean).join(" ");
}

function buildCreateTableSql({ table, expected, dialect }) {
  const tblName = quoteIdentForDialect(table, dialect);
  const cols = expected
    .map((c) =>
      buildColumnDefinition({
        columnName: c.name,
        column: c,
        dialect,
      })
    )
    .join(", ");
  const suffix = dialect === "mysql" ? " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" : "";
  return `CREATE TABLE ${tblName} (${cols})${suffix};`;
}

function parseVarcharLen(sqlType) {
  const t = normalizeSqlType(sqlType);
  const m = t.match(/VARCHAR\s*\(\s*(\d+)\s*\)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function sqlLiteral(v) {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  // SQLite string literal uses single quotes; double quotes are identifiers.
  return `'${String(v).replaceAll("'", "''")}'`;
}

function stripQuotedDefault(s) {
  const quote = s[0];
  if (s.length < 2 || s.at(-1) !== quote) return s;
  if (quote === "'") return s.slice(1, -1).replaceAll("''", "'");
  if (quote === '"') return s.slice(1, -1).replaceAll('""', '"');
  return s;
}

function normalizeDefaultForCompare(v) {
  // PRAGMA table_info: no DEFAULT clause → dflt_value is null. Model omits default → undefined.
  // Treat both as “no literal default” so we don’t false-positive changedColumns after migrations.
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return stripQuotedDefault(s);
}

function isTextLengthCompatible(exp, act) {
  // TEXT affinity columns are compatible between TEXT and VARCHAR(N) in SQLite/MySQL.
  // When model side does not require a fixed max_length, ignore DB-side varchar length.
  if ((exp?.affinity ?? "") !== "text" || (act?.affinity ?? "") !== "text") return false;
  if ((exp?.max_length ?? null) !== null) return false;
  return (act?.max_length ?? null) !== null;
}

function normalizeSqliteActualColumn(row) {
  const typeSql = row.type ?? "";
  const primaryKey = Boolean(row.pk);
  const affinity = typeAffinity(typeSql);
  const isIntegerPrimaryKey = primaryKey && affinity === "integer";

  return {
    name: row.name,
    typeSql: isIntegerPrimaryKey ? "INTEGER PRIMARY KEY AUTOINCREMENT" : typeSql,
    affinity,
    primaryKey,
    // PRAGMA reports notnull=0 for INTEGER PRIMARY KEY even though this is the
    // canonical non-null id shape created by our SQLite adaptor.
    notnull: isIntegerPrimaryKey ? true : Boolean(row.notnull),
    default: row.dflt_value ?? undefined,
    max_length: parseVarcharLen(typeSql),
  };
}

function expectedColumnFromFieldDialect(name, def, dialect) {
  const isPk = Boolean(def?.primaryKey);
  if (isPk) {
    if (dialect === "mysql") {
      return {
        name,
        typeSql: "BIGINT PRIMARY KEY AUTO_INCREMENT",
        affinity: "integer",
        primaryKey: true,
        notnull: true,
        default: undefined,
        max_length: null,
      };
    }
    return {
      name,
      typeSql: "INTEGER PRIMARY KEY AUTOINCREMENT",
      affinity: "integer",
      primaryKey: true,
      notnull: true,
      default: undefined,
      max_length: null,
    };
  }
  const t = def?.type;
  let typeSql;
  if (t === "number") typeSql = dialect === "mysql" ? "BIGINT" : "INTEGER";
  else if (t === "fk") typeSql = dialect === "mysql" ? "BIGINT" : "INTEGER";
  else if (t === "date") typeSql = "DATE";
  else if (t === "datetime") typeSql = "DATETIME";
  else if (t === "char") {
    const ml = def?.max_length;
    if (typeof ml === "number" && Number.isFinite(ml) && ml > 0) {
      typeSql = `VARCHAR(${Math.floor(ml)})`;
    } else {
      throw new Error(`Field "${name}" with type "char" requires a positive max_length`);
    }
  } else if (t === "text") {
    typeSql = "TEXT";
  } else {
    throw new Error(`Unsupported field type "${t}" for field "${name}"`);
  }
  const notnull = def?.null ? false : true;
  const hasDefault = def && typeof def === "object" && Object.prototype.hasOwnProperty.call(def, "default");
  const dflt = hasDefault ? def.default : undefined;
  return {
    name,
    typeSql,
    affinity: typeAffinity(typeSql),
    primaryKey: false,
    notnull,
    default: dflt,
    // In MySQL, our default string type is VARCHAR(255); treat it as an explicit length to avoid false positives.
    max_length:
      t === "char"
        ? (typeof def?.max_length === "number"
            ? Math.floor(def.max_length)
            : null)
        : null,
  };
}

async function tableExists(db, table) {
  const dialect = String(db?.dialect ?? "sqlite").toLowerCase();
  if (dialect === "mysql") {
    const row = await db.rawGet(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [table]
    );
    return { exists: Boolean(row?.name) };
  }

  const row = await db.rawGet(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name=?",
    [table]
  );
  return { exists: Boolean(row?.name) };
}

async function actualColumns(db, table) {
  const dialect = String(db?.dialect ?? "sqlite").toLowerCase();
  if (dialect === "mysql") {
    const rows = await db.rawAll(
      "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS typeSql, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS dflt, COLUMN_KEY AS colKey, CHARACTER_MAXIMUM_LENGTH AS charMax FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION",
      [table]
    );
    return rows.map((r) => {
      const typeSql = r.typeSql ?? "";
      return {
        name: r.name,
        typeSql,
        affinity: typeAffinity(typeSql),
        primaryKey: String(r.colKey ?? "").toUpperCase() === "PRI",
        notnull: String(r.isNullable ?? "").toUpperCase() !== "YES",
        default: r.dflt === null ? undefined : r.dflt,
        max_length:
          r.charMax == null ? parseVarcharLen(typeSql) : Number(r.charMax),
      };
    });
  }

  const rows = await db.rawAll(`PRAGMA table_info(${JSON.stringify(table)})`);
  return rows.map(normalizeSqliteActualColumn);
}

function diffOneTable({ resourceKey, ModelClass, actual, exists, dialect }) {
  const expected = Object.entries(ModelClass.fields ?? {}).map(([name, def]) =>
    expectedColumnFromFieldDialect(name, def, dialect || "sqlite")
  );
  // Missing table: report table-level absence only.
  // Field-level diffs should run after table exists.
  if (!exists) {
    return {
      resourceKey,
      table: ModelClass.table,
      exists,
      expected,
      actual: [],
      diff: { missingColumns: [], extraColumns: [], changedColumns: [], warnings: [] },
    };
  }

  const expBy = new Map(expected.map((c) => [c.name, c]));
  const actBy = new Map(actual.map((c) => [c.name, c]));
  const missingColumns = [];
  const extraColumns = [];
  const changedColumns = [];
  const warnings = [];

  for (const [name, exp] of expBy.entries()) {
    const act = actBy.get(name);
    if (!act) {
      // SQLite: ADD COLUMN with NOT NULL requires DEFAULT in practice
      if (exp.notnull && exp.default === undefined && !exp.primaryKey) {
        warnings.push(`表 ${resourceKey}: 列 ${name} 为 NOT NULL 且无 default，无法直接 ADD COLUMN。`);
      }
      missingColumns.push({ name, expected: exp });
      continue;
    }

    const changes = [];
    if (exp.primaryKey !== act.primaryKey) changes.push("primaryKey");
    if (exp.affinity !== act.affinity) changes.push("type");
    if (Boolean(exp.notnull) !== Boolean(act.notnull)) changes.push("null");
    const expDef = normalizeDefaultForCompare(exp.default);
    const actDef = normalizeDefaultForCompare(act.default);
    if (expDef !== actDef) changes.push("default");
    if ((exp.max_length ?? null) !== (act.max_length ?? null)) {
      if (!isTextLengthCompatible(exp, act)) {
        changes.push("max_length");
      }
    }

    // SQLite noise: INTEGER PRIMARY KEY columns often show up in PRAGMA as type "INTEGER"
    // while our model uses a fuller DDL string. If both sides are PK + integer affinity,
    // ignore harmless "type" noise.
    if (exp.primaryKey && act.primaryKey && exp.affinity === "integer" && act.affinity === "integer") {
      const idxType = changes.indexOf("type");
      if (idxType >= 0) changes.splice(idxType, 1);
      // PRAGMA often reports notnull=0 for INTEGER PRIMARY KEY even though PK implies NOT NULL-ish behavior.
      const idxNull = changes.indexOf("null");
      if (idxNull >= 0) changes.splice(idxNull, 1);
    }
    if (changes.length) {
      changedColumns.push({ name, expected: exp, actual: act, changes });
    }
  }

  for (const [name, act] of actBy.entries()) {
    if (!expBy.has(name)) {
      extraColumns.push({ name, actual: act });
    }
  }

  return {
    resourceKey,
    table: ModelClass.table,
    exists,
    expected,
    actual,
    diff: { missingColumns, extraColumns, changedColumns, warnings },
  };
}

export async function computeSchemaDiff({ models, db }) {
  const tables = [];
  for (const [resourceKey, ModelClass] of Object.entries(models ?? {})) {
    const table = ModelClass.table;
    const ex = await tableExists(db, table);
    const actual = ex.exists ? await actualColumns(db, table) : [];
    const dialect = String(db?.dialect ?? "sqlite").toLowerCase();
    const t = diffOneTable({ resourceKey, ModelClass, actual, exists: ex.exists, dialect });

    t.dialect = dialect;
    const migrationSql = buildMigrationSql(t);
    t.serverSql = {
      migrationSql,
      canRunMigration: migrationSql.length > 0,
    };
    tables.push(t);
  }
  return { tables };
}

export function buildMigrationSql(diffTable) {
  const dialect = String(diffTable?.dbDialect ?? diffTable?.dialect ?? "").toLowerCase();
  const { table, expected, actual = [], diff = {} } = diffTable;
  if (!diffTable?.exists) {
    return [buildCreateTableSql({ table, expected, dialect })];
  }

  if (dialect === "mysql") {
    const lines = [];
    for (const c of diff.missingColumns || []) {
      lines.push(buildAddColumnSql({
        table,
        columnName: c.name,
        expected: c.expected,
        dialect,
      }));
    }
    for (const c of diff.changedColumns || []) {
      const exp = expected.find((x) => x.name === c.name);
      if (!exp) continue;
      if (exp.primaryKey) continue;
      const parts = [
        `MODIFY COLUMN \`${c.name}\``,
        exp.typeSql,
        exp.notnull ? "NOT NULL" : "NULL",
        exp.default !== undefined ? `DEFAULT ${sqlLiteral(exp.default)}` : "",
      ].filter(Boolean);
      lines.push(`ALTER TABLE \`${table}\` ${parts.join(" ")};`);
    }
    for (const c of diff.extraColumns || []) {
      lines.push(`ALTER TABLE \`${table}\` DROP COLUMN \`${c.name}\`;`);
    }
    if (!lines.length) return [];
    return lines;
  }

  const warnCount = (diff.warnings || []).length;
  const hasRisky = Boolean(diff.extraColumns?.length || diff.changedColumns?.length || warnCount);
  if (!hasRisky) {
    const lines = [];
    for (const c of diff.missingColumns || []) {
      lines.push(buildAddColumnSql({
        table,
        columnName: c.name,
        expected: c.expected,
        dialect,
      }));
    }
    if (!lines.length) return [];
    return lines;
  }
  const tmp = `${table}__new`;

  const cols = expected
    .map((c) =>
      buildColumnDefinition({
        columnName: c.name,
        column: c,
        dialect,
      })
    )
    .join(", ");

  const common = expected.filter((c) => actual.some((a) => a.name === c.name)).map((c) => `"${c.name}"`);
  const insertCols = common.join(", ");
  const selectCols = common.join(", ");

  const lines = [];
  lines.push("BEGIN;");
  lines.push(`CREATE TABLE "${tmp}" (${cols});`);
  if (common.length) {
    lines.push(`INSERT INTO "${tmp}" (${insertCols}) SELECT ${selectCols} FROM "${table}";`);
  }
  lines.push(`DROP TABLE "${table}";`);
  lines.push(`ALTER TABLE "${tmp}" RENAME TO "${table}";`);
  lines.push("COMMIT;");
  return lines;
}

export async function applySchemaMigration({ db, diff, resourceKey } = {}) {
  const dialect = String(db?.dialect ?? "sqlite").toLowerCase();
  if (
    diff == null ||
    typeof diff !== "object" ||
    !Array.isArray(diff.tables)
  ) {
    return {
      ok: false,
      error:
        "diff 为必填：须传入与 GET /schema-diff（computeSchemaDiff）一致的 { tables } 快照，禁止由 apply 内部重算",
      executed: [],
      dialect,
      sql: [],
    };
  }
  const before = diff;
  const tables = resourceKey
    ? before.tables.filter((t) => t.resourceKey === resourceKey)
    : before.tables;
  const executed = [];

  if (resourceKey && tables.length === 0) {
    return {
      ok: false,
      error: `No diff entry for: ${resourceKey}`,
      executed,
      dialect,
    };
  }

  for (const t of tables) {
    const tableWithDialect = { ...t, dialect };
    const sql = t.serverSql?.migrationSql ?? buildMigrationSql(tableWithDialect);
    if (!sql.length) {
      executed.push({ ok: true, kind: "noop", table: t.table, resourceKey: t.resourceKey, sql: [] });
      continue;
    }
    if (!t.serverSql?.canRunMigration) {
      executed.push({
        ok: false,
        kind: "migration",
        table: t.table,
        resourceKey: t.resourceKey,
        sql,
        error: "当前迁移无法自动执行，请检查 warnings 或手工处理 SQL",
      });
      continue;
    }
    try {
      for (const stmt of sql) {
        if (String(stmt).trim().startsWith("--")) continue;
        await db.exec(stmt);
      }
      executed.push({ ok: true, kind: "migration", table: t.table, resourceKey: t.resourceKey, sql });
    } catch (e) {
      executed.push({
        ok: false,
        kind: "migration",
        table: t.table,
        resourceKey: t.resourceKey,
        sql,
        error: e.message || String(e),
      });
    }
  }

  const firstError = executed.find((x) => !x.ok);
  return {
    ok: !firstError,
    error: firstError?.error,
    executed,
    dialect,
    sql: executed.flatMap((step) => step.sql).filter(Boolean),
  };
}

