import { validateModelInitConfig, validateRestEvents } from "./validate.js";
import { Manager, ReverseManager, ManyToManyManager, installReverseAccessor, resolveReverseAccessorName } from "./manager.js";
import { QuerySet } from "./queryset.js";

/** FK 标量 id（与 `school` 等访问器并存，不占用同名 own property） */
const fkIds = Symbol("fkIds");

function singularize(table) {
  const s = String(table ?? "");
  if (s.length > 3 && s.endsWith("ies")) return `${s.slice(0, -3)}y`;
  if (s.length > 1 && s.endsWith("s")) return s.slice(0, -1);
  return s;
}

function inferThroughField(Through, Related, fallbackName) {
  const matches = Object.entries(Through.fields ?? {})
    .filter(([, def]) => def?.type === "fk" && def.relatedModel === Related)
    .map(([name]) => name);
  return matches[0] ?? fallbackName;
}

/**
 * 把查询参数或 opts.expand 统一成 FK 字段名列表（去空白、去空段）。
 * @param {unknown} raw
 */
export function normalizeExpandList(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .flatMap((x) => String(x).split(","))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 构造/写入时：普通字段挂实例；FK 只写入符号表 `fkIds`，供 getter / values 读取 id。 */
function applyIncomingAttrs(instance, attrs) {
  const fields = instance.constructor.fields ?? {};

  for (const [key, value] of Object.entries(attrs ?? {})) {
    const def = fields[key];
    if (def?.type === "fk") {
      const v = value;
      if (v === undefined) continue;
      // 允许传入关联实例或标量 id
      (instance[fkIds] ??= {})[key] = v && typeof v === "object" ? v.id : v;
      continue;
    }
    if (def?.type === "m2m") {
      continue;
    }

    if (value !== undefined) {
      instance[key] = value;
    }
  }
}

class Model {
  static db = null; // global default db

  constructor(attrs = {}) {
    applyIncomingAttrs(this, attrs);
  }

  static useDB(db) {
    Model.db = db;
  }

  /**
   * Define a concrete model class without boilerplate `class X extends Model {}`.
   * 返回 **`Promise<typeof ConcreteModel>`**：须 `await Model.define(...)`。
   * 需要自定义方法时仍可用 `class X extends Model {}` 再 `await X.init({...})`。
   */
  static define({ table, fields = {}, db, managers, admin, events, ensureTable = false } = {}) {
    class ConcreteModel extends this {}
    return ConcreteModel.init({ table, fields, db, managers, admin, events, ensureTable });
  }

  /**
   * 注册表结构（可选建表）。
   *
   * 默认 **不自动建表**：用于“模型 vs 数据库差异检查/同步”的交互式流程。
   * 如需旧行为，显式传入 `ensureTable: true` 或在外部调用 `db.ensureTable(ModelClass)`。
   */
  static async init({ table, fields = {}, db, managers, admin, events, ensureTable = false } = {}) {
    this.table = table;
    this.fields = fields;
    this.db = db ?? Model.db;

    const extraManagers = validateModelInitConfig(this, {
      db: this.db,
      table: this.table,
      managers,
      admin,
    });

    this.admin = admin && typeof admin === "object" && !Array.isArray(admin) ? { ...admin } : {};
    this.events = validateRestEvents(events, `${this.table ?? "Model"}.events`);

    if (ensureTable && typeof this.db.ensureTable === "function") {
      await this.db.ensureTable(this);
    }

    this.objects = new Manager(this);

    for (const [name, ManagerClass] of Object.entries(extraManagers)) {
      this[name] = new ManagerClass(this);
    }

    // FK: `instance.school` is a Promise (no ORM-side cache); `await instance.school` loads by id.
    // Reverse: e.g. `school.student_set` (default from table `students` → `student_set`)
    for (const [name, def] of Object.entries(fields)) {
      if (def?.type === "m2m") {
        const relatedModel = def.relatedModel;
        if (!relatedModel) {
          throw new Error(`M2M field "${name}" requires relatedModel`);
        }
        const sourceFieldName = def.sourceField ?? singularize(this.table);
        const targetFieldName = def.targetField ?? singularize(relatedModel.table);
        let throughModel = def.through;
        if (!throughModel) {
          class AutoThroughModel extends Model {}
          await AutoThroughModel.init({
            table: def.throughTable ?? `${singularize(this.table)}_${name}`,
            fields: {
              id: { type: "number", primaryKey: true },
              [sourceFieldName]: { type: "fk", relatedModel: this, relatedName: "+" },
              [targetFieldName]: { type: "fk", relatedModel: relatedModel, relatedName: "+" },
            },
            db: this.db,
          });
          throughModel = AutoThroughModel;
        }
        def.throughModel = throughModel;
        def.sourceFieldName = def.sourceField ?? inferThroughField(throughModel, this, sourceFieldName);
        def.targetFieldName = def.targetField ?? inferThroughField(throughModel, relatedModel, targetFieldName);

        Object.defineProperty(this.prototype, name, {
          configurable: true,
          enumerable: true,
          get() {
            return new ManyToManyManager(this, {
              relatedModel,
              throughModel,
              sourceFieldName: def.sourceFieldName,
              targetFieldName: def.targetFieldName,
            });
          },
        });
        continue;
      }

      if (def?.type !== "fk") continue;
      const relatedModel = def.relatedModel;
      if (!relatedModel) {
        throw new Error(`FK field "${name}" requires relatedModel`);
      }

      Object.defineProperty(this.prototype, name, {
        configurable: true,
        enumerable: true,
        get() {
          const id = this[fkIds]?.[name];
          if (id === undefined || id === null) return null;
          return relatedModel.objects.get({ id });
        },
      });

      const revName = resolveReverseAccessorName(this, def);
      if (revName) {
        if (Object.prototype.hasOwnProperty.call(relatedModel.prototype, revName)) {
          throw new Error(
            `Cannot add reverse "${revName}" on ${relatedModel.table}: prototype already has this property`
          );
        }
        installReverseAccessor(relatedModel, revName, {
          childModel: this,
          fkFieldName: name,
        });
      }
    }

    return this;
  }

  static async serialize(instance, opts = {}) {
    const optsObj = typeof opts === "number" ? { fkDepth: opts } : { ...opts };
    const fkDepth = optsObj.fkDepth ?? 1;
    const expandProvided = Object.prototype.hasOwnProperty.call(optsObj, "expand");
    /** 客户端请求的展开名全集（逐层原样下传，子模型自行按本地 FK 过滤） */
    const expandCandidates = expandProvided ? normalizeExpandList(optsObj.expand) : [];

    const ModelClass = instance.constructor;
    const fields = ModelClass.fields ?? {};
    const fkNames = new Set(
      Object.entries(fields)
        .filter(([, d]) => d?.type === "fk")
        .map(([name]) => name)
    );
    const relationNames = new Set([
      ...fkNames,
      ...Object.entries(fields)
        .filter(([, d]) => d?.type === "m2m")
        .map(([name]) => name),
    ]);
    const expandMatched = expandCandidates.filter((name) => relationNames.has(name));
    const effectiveExpand = expandMatched.length > 0 ? new Set(expandMatched) : null;

    const out = {};

    async function getRelatedOrNull(Related, id) {
      try {
        return await Related.objects.get({ id });
      } catch (e) {
        if (e?.message === "DoesNotExist") return null;
        throw e;
      }
    }

    for (const [k, def] of Object.entries(fields)) {
      if (def?.type === "fk") {
        const id = instance[fkIds]?.[k];
        const prefetched = instance[`_prefetched_${k}`];

        if (effectiveExpand != null) {
          if (!effectiveExpand.has(k)) {
            if (id !== undefined) out[`${k}_id`] = id;
            continue;
          }
          if (id === undefined && !prefetched) {
            continue;
          }
          if (id === null) {
            out[k] = null;
            continue;
          }
          // 使用 selectRelated 预加载的对象，不再查库
          if (prefetched) {
            const Related = def.relatedModel;
            out[k] = await Related.serialize(prefetched, { fkDepth: 0, expand: expandCandidates });
            continue;
          }
          const Related = def.relatedModel;
          const rel = await getRelatedOrNull(Related, id);
          if (rel == null) {
            out[k] = null;
            continue;
          }
          out[k] = await Related.serialize(rel, { fkDepth: 0, expand: expandCandidates });
          continue;
        }

        if (fkDepth > 0 && (id != null || prefetched)) {
          if (prefetched) {
            const Related = def.relatedModel;
            out[k] = await Related.serialize(prefetched, { fkDepth: fkDepth - 1 });
          } else {
            const Related = def.relatedModel;
            const rel = await getRelatedOrNull(Related, id);
            if (rel == null) {
              out[`${k}_id`] = id;
              continue;
            }
            out[k] = await Related.serialize(rel, { fkDepth: fkDepth - 1 });
          }
        } else if (id !== undefined) {
          out[`${k}_id`] = id;
        }
        continue;
      }
      if (def?.type === "m2m") {
        const manager = instance[k];
        const relatedRows = await manager.all();
        const ids = relatedRows.map((row) => row.id);

        if (effectiveExpand != null) {
          if (!effectiveExpand.has(k)) {
            out[`${k}_ids`] = ids;
            continue;
          }
          out[k] = await Promise.all(
            relatedRows.map((row) => def.relatedModel.serialize(row, { fkDepth: 0, expand: expandCandidates }))
          );
          continue;
        }

        if (fkDepth > 0) {
          out[k] = await Promise.all(
            relatedRows.map((row) => def.relatedModel.serialize(row, { fkDepth: fkDepth - 1 }))
          );
        } else {
          out[`${k}_ids`] = ids;
        }
        continue;
      }
      if (instance[k] !== undefined) out[k] = instance[k];
    }
    if (instance.id !== undefined) out.id = instance.id;
    return out;
  }
}

export { Model, Manager, QuerySet, ReverseManager, ManyToManyManager };
export default Model;
