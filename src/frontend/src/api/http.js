import axios from "axios";
import { apiUrl } from "../config.js";

const http = axios.create({
  baseURL: "",
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

http.interceptors.response.use(
  (res) => {
    if (typeof window !== "undefined" && window.__searea_formatResponse) {
      const payload = res.data;
      if (payload && typeof payload === "object" && !Array.isArray(payload) && "data" in payload) {
        res.data = payload.data;
      }
    }
    return res;
  },
  (err) => {
    let data = err.response?.data;
    if (typeof window !== "undefined" && window.__searea_formatResponse) {
      if (data && typeof data === "object" && !Array.isArray(data) && "data" in data) {
        data = data.data || data;
      }
    }
    const msg = data?.error || err.message || "请求失败";
    return Promise.reject(new Error(msg));
  }
);

export function getJson(path) {
  return http.get(apiUrl(path)).then((r) => r.data);
}

export function postJson(path, body) {
  return http.post(apiUrl(path), body).then((r) => r.data);
}

export function patchJson(path, body) {
  return http.patch(apiUrl(path), body).then((r) => r.data);
}

export function deleteJson(path) {
  return http.delete(apiUrl(path)).then((r) => r.data);
}
