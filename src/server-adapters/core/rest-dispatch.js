import { normalizeExpandList } from "../../core/model.js";
import { FieldValidationError, validateFilterWhere, validateWriteAttrs } from "../../core/field-validation.js";
import { KNOWN_REST_EVENT_NAMES } from "../../core/validate.js";
import {
  buildApiDocs,
  buildResourceMeta,
  coerceFilterValue,
  fkFieldNames,
  guessModelName,
  adminCatalogFromModels,
  normalizeAdminCatalog,
} from "./admin-meta.js";
import { applySchemaMigration, computeSchemaDiff } from "./schema-diff.js";
import { createResponseFormatter } from "./response-format.js";

/**
 * @param {Record<string, typeof import("../../core/model.js").Model>} models
 */
function restEventsFromModels(models) {
  /** @type {Record<string, Record<string, Function>>} */
  const out = {};
  for (const [resource, M] of Object.entries(models)) {
    const raw = M?.events;
    if (!raw || typeof raw !== "object") continue;
    /** @type {Record<string, Function>} */
    const slice = {};
    for (const name of KNOWN_REST_EVENT_NAMES) {
      const fn = raw[name];
      if (typeof fn === "function") slice[name] = fn;
    }
    if (Object.keys(slice).length) out[resource] = slice;
  }
  return out;
}

/**
 * Per-resource shallow merge: `options.events` overrides the same handler on the model.
 * @param {Record<string, Record<string, Function>>} fromModels
 * @param {Record<string, Record<string, Function>>} [explicit]
 */
function mergeRestEvents(fromModels, explicit) {
  const keys = new Set([...Object.keys(fromModels), ...Object.keys(explicit ?? {})]);
  /** @type {Record<string, Record<string, Function>>} */
  const merged = {};
  for (const k of keys) {
    merged[k] = { ...(fromModels[k] ?? {}), ...(explicit?.[k] ?? {}) };
  }
  return merged;
}

export function pickWritableAttrs(modelClass, body) {
  const fields = modelClass.fields ?? {};
  const out = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    const def = fields[k];
    if (!def) continue;
    if (def.primaryKey) continue;
    out[k] = v;
  }
  return out;
}

/** @param {Record<string, unknown>} [query] */
export function valuesOptsFromQuery(query) {
  let raw = query?.expand;
  if (raw == null || raw === "") {
    return { fkDepth: 0 };
  }
  if (Array.isArray(raw)) raw = raw.join(",");
  const expand = normalizeExpandList(raw);
  if (!expand.length) return { fkDepth: 0 };
  return { fkDepth: 0, expand };
}

export function listFiltersFromQuery(query, ModelClass) {
  const skip = new Set(["page", "pageSize", "expand"]);
  const where = {};
  for (const k of Object.keys(query ?? {})) {
    if (skip.has(k)) continue;
    const raw = query[k];
    if (raw === undefined || raw === null) continue;
    const s = String(Array.isArray(raw) ? raw.join(",") : raw).trim();
    if (!s.length) continue;
    if (!Object.prototype.hasOwnProperty.call(ModelClass.fields ?? {}, k)) continue;
    where[k] = coerceFilterValue(ModelClass, k, s);
  }
  return where;
}

/** @typedef {{ type: 'next' }} RestNext */
/** @typedef {{ type: 'respond', status: number, headers?: Record<string,string>, body?: unknown }} RestRespond */

/**
 * Framework-agnostic REST + admin endpoints under `backendPath`.
 *
 * @param {object} [options]
 * @param {string} [options.backendPath]
 * @param {string} [options.prefix]
 * @param {Record<string, typeof import("../../core/model.js").Model>} [options.models]
 * @param {Record<string, object>} [options.events] — 与各模型类上的 `events` 按资源合并；同名处理函数以此参数为准
 * @param {Array<{ key: string, modelName?: string, admin?: object }>} [options.adminCatalog]
 *     — 非空时优先，并与 models 中尚未出现的 key 合并
 */
export function createRestDispatch(options = {}) {
  const backendPath = (options.backendPath ?? options.prefix ?? "/api").replace(/\/$/, "");
  const models = options.models ?? {};
  const eventsByKey = mergeRestEvents(restEventsFromModels(models), options.events ?? {});
  const catalogRows = options.adminCatalog?.length
    ? normalizeAdminCatalog(models, options.adminCatalog)
    : adminCatalogFromModels(models);
  const catalogByKey = Object.fromEntries(catalogRows.map((r) => [r.key, r]));

  const formatter = createResponseFormatter({ formatResponse: options.formatResponse });

  /**
   * @param {string} resource
   * @param {"onPost"|"onGetList"|"onGetItem"|"onPatch"|"onDelete"} eventName
   * @param {unknown} instance
   */
  async function runRestEvent(resource, eventName, instance) {
    const fn = eventsByKey?.[resource]?.[eventName];
    if (typeof fn !== "function") return { overridden: false };
    const out = await fn({ models, instance });
    if (out === undefined) return { overridden: false };
    return { overridden: true, body: out };
  }

  /** @returns {Promise<RestNext | RestRespond>} */
  return async function dispatchRest({ method, pathname, query = {}, readJsonBody }) {
    const p =
      pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;

    const under =
      p === backendPath ? "/" : p.startsWith(`${backendPath}/`) ? p.slice(backendPath.length) : null;

    if (under === null) {
      return { type: "next" };
    }

    const segments = under.split("/").filter(Boolean);
    if (segments.length > 2 || !segments[0]) {
      return { type: "next" };
    }

    const head = segments[0];
    const m = method.toUpperCase();

    if (head === "models" && segments.length === 1) {
      if (m !== "GET") {
        return { type: "respond", status: 405, headers: { Allow: "GET" }, body: formatter.wrap(405, { error: "Method not allowed" }) };
      }
      return {
        type: "respond",
        status: 200,
        body: formatter.wrap(200, catalogRows.map((row) => ({
          key: row.key,
          modelName: row.modelName ?? guessModelName(row.key),
          admin: row.admin ?? {},
        }))),
      };
    }

    if (head === "api-docs" && segments.length === 1) {
      if (m !== "GET") {
        return { type: "respond", status: 405, headers: { Allow: "GET" }, body: formatter.wrap(405, { error: "Method not allowed" }) };
      }
      return {
        type: "respond",
        status: 200,
        body: formatter.wrap(200, buildApiDocs(backendPath, models, catalogRows)),
      };
    }

    if (head === "schema-diff" && segments.length === 1) {
      if (m !== "GET") {
        return { type: "respond", status: 405, headers: { Allow: "GET" }, body: formatter.wrap(405, { error: "Method not allowed" }) };
      }
      const any = Object.values(models)[0];
      const db = any?.db;
      if (!db || typeof db.rawAll !== "function" || typeof db.rawGet !== "function") {
        return {
          type: "respond",
          status: 500,
          body: formatter.wrap(500, { error: "DB adaptor missing rawAll/rawGet; cannot compute schema diff" }),
        };
      }
      return { type: "respond", status: 200, body: formatter.wrap(200, await computeSchemaDiff({ models, db })) };
    }

    if (head === "schema-migrate" && segments.length === 1) {
      if (m !== "POST") {
        return {
          type: "respond",
          status: 405,
          headers: { Allow: "POST" },
          body: formatter.wrap(405, { error: "Method not allowed" }),
        };
      }
      const any = Object.values(models)[0];
      const db = any?.db;
      if (!db || typeof db.rawAll !== "function" || typeof db.rawGet !== "function") {
        return {
          type: "respond",
          status: 500,
          body: formatter.wrap(500, { error: "DB adaptor missing rawAll/rawGet; cannot migrate schema" }),
        };
      }
      const body = await readJsonBody();
      const resourceKey = body?.resourceKey != null ? String(body.resourceKey) : undefined;
      const diff = body?.diff;
      if (diff == null || typeof diff !== "object" || !Array.isArray(diff.tables)) {
        return {
          type: "respond",
          status: 400,
          body: formatter.wrap(400, {
            error:
              "请求体需提供 diff（与 GET /schema-diff 返回一致的 { tables }），不得由服务端在执行前重算 migration 快照",
          }),
        };
      }
      const sync = await applySchemaMigration({ db, diff, resourceKey });
      const after = await computeSchemaDiff({ models, db });
      return { type: "respond", status: sync.ok ? 200 : 400, body: formatter.wrap(sync.ok ? 200 : 400, { ok: sync.ok, result: sync, after }) };
    }

    const resource = head;
    const ModelClass = models[resource];
    if (!ModelClass) {
      return { type: "next" };
    }

    if (segments.length === 2 && segments[1] === "meta") {
      if (m !== "GET") {
        return { type: "respond", status: 405, headers: { Allow: "GET" }, body: formatter.wrap(405, { error: "Method not allowed" }) };
      }
      return {
        type: "respond",
        status: 200,
        body: formatter.wrap(200, buildResourceMeta(resource, ModelClass, models, catalogByKey[resource], catalogByKey)),
      };
    }

    const idSeg = segments[1];

    try {
      let serializeOpts = valuesOptsFromQuery(query);

      if (m === "GET" && !idSeg) {
        const pageQ = query.page;
        const pageSizeQ = query.pageSize;
        const usePaging = pageQ != null || pageSizeQ != null;
        const where = listFiltersFromQuery(query, ModelClass);
        validateFilterWhere(ModelClass, where);

        if (usePaging && !query.expand) {
          const fks = fkFieldNames(ModelClass);
          if (fks.length) serializeOpts = { fkDepth: 0, expand: fks };
        }

        /** @type {unknown} */
        let defaultBody;

        if (
          usePaging &&
          typeof ModelClass.db.count === "function" &&
          typeof ModelClass.db.select === "function"
        ) {
          const pageNum = Math.max(1, parseInt(String(pageQ ?? 1), 10) || 1);
          const pageSize = Math.min(100, Math.max(1, parseInt(String(pageSizeQ ?? 20), 10) || 20));
          const total = await ModelClass.db.count(ModelClass.table, where);
          const offset = (pageNum - 1) * pageSize;
          const rows = await ModelClass.db.select(ModelClass.table, where, { limit: pageSize, offset });
          const instances = rows.map((r) => new ModelClass(r));
          const items = await Promise.all(
            instances.map((inst) => ModelClass.serialize(inst, serializeOpts))
          );
          defaultBody = { items, total, page: pageNum, pageSize };
        } else if (Object.keys(where).length > 0) {
          defaultBody = await ModelClass.objects.filter(where).values(serializeOpts);
        } else {
          defaultBody = await ModelClass.objects.all().values(serializeOpts);
        }

        const listEv = await runRestEvent(resource, "onGetList", defaultBody);
        return {
          type: "respond",
          status: 200,
          body: formatter.wrap(200, listEv.overridden ? listEv.body : defaultBody),
        };
      }

      if (m === "GET" && idSeg) {
        const id = Number(idSeg);
        if (!Number.isFinite(id)) {
          return { type: "respond", status: 400, body: formatter.wrap(400, { error: "Invalid id" }) };
        }
        const obj = await ModelClass.objects.get({ id });
        const getEv = await runRestEvent(resource, "onGetItem", obj);
        return {
          type: "respond",
          status: 200,
          body: formatter.wrap(200, getEv.overridden ? getEv.body : await ModelClass.serialize(obj, serializeOpts)),
        };
      }

      if (m === "POST" && !idSeg) {
        const body = await readJsonBody();
        const attrs = pickWritableAttrs(ModelClass, body);
        validateWriteAttrs(ModelClass, attrs);
        const row = await ModelClass.objects.create(attrs);
        const obj = await ModelClass.objects.get({ id: row.id });
        const postEv = await runRestEvent(resource, "onPost", obj);
        return {
          type: "respond",
          status: 201,
          headers: { Location: `${backendPath}/${resource}/${row.id}` },
          body: formatter.wrap(201, postEv.overridden ? postEv.body : await ModelClass.serialize(obj, serializeOpts)),
        };
      }

      if ((m === "PATCH" || m === "PUT") && idSeg) {
        const id = Number(idSeg);
        if (!Number.isFinite(id)) {
          return { type: "respond", status: 400, body: formatter.wrap(400, { error: "Invalid id" }) };
        }
        const body = await readJsonBody();
        const attrs = pickWritableAttrs(ModelClass, body);
        if (Object.keys(attrs).length > 0) {
          validateWriteAttrs(ModelClass, attrs);
          const changes = await ModelClass.db.update(ModelClass.table, { id }, attrs);
          if (changes === 0) {
            return { type: "respond", status: 404, body: formatter.wrap(404, { error: "Not found" }) };
          }
        }
        const obj = await ModelClass.objects.get({ id });
        const patchEv = await runRestEvent(resource, "onPatch", obj);
        return {
          type: "respond",
          status: 200,
          body: formatter.wrap(200, patchEv.overridden ? patchEv.body : await ModelClass.serialize(obj, serializeOpts)),
        };
      }

      if (m === "DELETE" && idSeg) {
        const id = Number(idSeg);
        if (!Number.isFinite(id)) {
          return { type: "respond", status: 400, body: formatter.wrap(400, { error: "Invalid id" }) };
        }
        let obj = null;
        try {
          obj = await ModelClass.objects.get({ id });
        } catch (e) {
          if (e?.message !== "DoesNotExist") throw e;
        }
        if (!obj) {
          return { type: "respond", status: 404, body: formatter.wrap(404, { error: "Not found" }) };
        }
        const deleteEv = await runRestEvent(resource, "onDelete", obj);
        const changes = await ModelClass.db.delete(ModelClass.table, { id });
        if (changes === 0) {
          return { type: "respond", status: 404, body: formatter.wrap(404, { error: "Not found" }) };
        }
        if (deleteEv.overridden) {
          return { type: "respond", status: 200, body: formatter.wrap(200, deleteEv.body) };
        }
        return { type: "respond", status: 204 };
      }

      return {
        type: "respond",
        status: 405,
        headers: { Allow: "GET, POST, PATCH, PUT, DELETE" },
        body: formatter.wrap(405, { error: "Method not allowed" }),
      };
    } catch (e) {
      if (e instanceof FieldValidationError) {
        return {
          type: "respond",
          status: 400,
          body: formatter.wrap(400, { error: "validation_failed", details: e.details }),
        };
      }
      if (e.message === "DoesNotExist") {
        return { type: "respond", status: 404, body: formatter.wrap(404, { error: "Not found" }) };
      }
      if (e.status === 400) {
        return { type: "respond", status: 400, body: formatter.wrap(400, { error: e.message }) };
      }
      throw e;
    }
  };
}
