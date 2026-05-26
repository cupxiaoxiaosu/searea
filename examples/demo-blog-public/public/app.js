const API = "/api";

async function fetchJSON(url, opts = {}) {
  const headers = {
    ...(opts.body && typeof opts.body === "string"
      ? { "Content-Type": "application/json" }
      : {}),
    ...opts.headers,
  };

  const r = await fetch(url, { ...opts, headers });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) {
    const err = new Error((data && data.error) || r.statusText);
    err.details = data;
    err.status = r.status;
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBody(md) {
  const blocks = String(md || "").split(/\n\n+/);
  return blocks
    .map((b) => {
      const t = b.trim();
      if (!t) return "";
      if (t.startsWith("## ")) return `<h3>${esc(t.slice(3))}</h3>`;
      if (t.startsWith("> ")) {
        const lines = t.split("\n").map((l) => l.replace(/^>\s?/, "").trim());
        return `<blockquote>${lines.map((l) => esc(l)).join("<br/>")}</blockquote>`;
      }
      const lines = t.split("\n");
      if (lines.length > 1 && lines.every((l) => l.startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>`;
      }
      const withBold = esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      return `<p>${withBold.replaceAll("\n", "<br/>")}</p>`;
    })
    .join("");
}

const grid = document.getElementById("post-grid");
const reader = document.getElementById("reader");

document.querySelector(".js-close-reader")?.addEventListener("click", () => reader.close());

reader.addEventListener("click", (e) => {
  if (e.target === reader) reader.close();
});

async function loadPosts() {
  const dataRaw = await fetchJSON(`${API}/posts?expand=writer`);
  const data = Array.isArray(dataRaw) ? dataRaw : dataRaw?.items ?? [];
  grid.innerHTML = "";
  for (const p of data) {
    const el = document.createElement("article");
    el.className = "card post-card";
    el.style.setProperty("--tint", p.hero_tint || "var(--accent)");
    el.innerHTML = `
      <p class="eyebrow">${esc(p.slug)}</p>
      <h3>${esc(p.title)}</h3>
      <p>${esc((p.excerpt || "").slice(0, 120))}${(p.excerpt || "").length > 120 ? "…" : ""}</p>`;
    el.addEventListener("click", async () => {
      await openReader(p.id);
    });
    grid.append(el);
  }
}

async function openReader(id) {
  const detail = await fetchJSON(`${API}/posts/${id}?expand=writer`);
  const commentsRaw = await fetchJSON(`${API}/comments?post=${id}`);
  const comments = Array.isArray(commentsRaw) ? commentsRaw : commentsRaw?.items ?? [];

  document.querySelector(".js-d-label").textContent = detail.slug || "";
  document.querySelector(".js-d-title").textContent = detail.title || "";
  const author = detail.writer?.display_name || detail.writer?.username || "unknown";
  document.querySelector(".js-d-meta").textContent =
    `${author} · ${new Date(detail.published_at_ms ?? Date.now()).toLocaleDateString()}`;
  document.querySelector(".js-d-body").innerHTML = renderBody(detail.body_md || "");

  const ul = document.querySelector(".js-d-comments");
  ul.innerHTML = "";
  for (const c of comments) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${esc(c.nickname || "anon")}</strong> · ${esc(c.body || "")}`;
    ul.append(li);
  }
  reader.showModal();
}

await loadPosts();
