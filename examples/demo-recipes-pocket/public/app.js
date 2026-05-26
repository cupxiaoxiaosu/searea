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

const grid = document.getElementById("recipe-grid");
const sheet = document.getElementById("sheet");

let cuisineFilter = "";

document.querySelector(".js-close-sheet").addEventListener("click", () => sheet.close());

sheet.addEventListener("click", (e) => {
  if (e.target === sheet) sheet.close();
});

document.getElementById("cuisine-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  cuisineFilter = chip.getAttribute("data-cuisine") ?? "";
  for (const c of document.querySelectorAll(".chip")) {
    c.classList.toggle("chip--active", c === chip);
  }
  loadRecipes();
});

function normList(dataRaw) {
  return Array.isArray(dataRaw) ? dataRaw : dataRaw?.items ?? [];
}

async function loadRecipes() {
  const dataRaw = await fetchJSON(`${API}/recipes?expand=chef`);
  let list = normList(dataRaw);
  if (cuisineFilter) {
    list = list.filter((r) => (r.cuisine || "").toLowerCase() === cuisineFilter);
  }
  list.sort((a, b) => (b.created_ms ?? 0) - (a.created_ms ?? 0));

  grid.innerHTML = "";
  for (const r of list) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "recipe-card cursor-pointer";
    const from = r.accent_from || "#047857";
    const to = r.accent_to || "#34d399";
    card.style.setProperty("--from", from);
    card.style.setProperty("--to", to);
    const dur = r.duration_min != null ? `${r.duration_min} min` : "—";
    const srv = r.servings != null ? `${r.servings} 人份` : "—";
    card.innerHTML = `
      <div class="recipe-card__visual" aria-hidden="true"></div>
      <div class="recipe-card__body">
        <p class="recipe-card__eyebrow">${esc(r.cuisine || "kitchen")}</p>
        <h3 class="recipe-card__title">${esc(r.title)}</h3>
        <p class="recipe-card__sub">${esc((r.subtitle || "").slice(0, 140))}${(r.subtitle || "").length > 140 ? "…" : ""}</p>
        <div class="recipe-card__meta">
          <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(dur)}</span>
          <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10h10M7 14h10M10 18h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>${esc(srv)}</span>
        </div>
      </div>`;
    card.addEventListener("click", () => openSheet(r.id));
    grid.append(card);
  }
}

async function openSheet(id) {
  const detail = await fetchJSON(`${API}/recipes/${id}?expand=chef`);
  const linesRaw = await fetchJSON(`${API}/recipe_lines?recipe=${id}`);
  const lines = normList(linesRaw).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

  document.getElementById("sheet-title").textContent = detail.title || "";
  document.getElementById("sheet-sub").textContent = detail.subtitle || "";
  document.getElementById("sheet-cuisine").textContent = (detail.cuisine || "recipe").toUpperCase();
  document.getElementById("sheet-duration").textContent =
    detail.duration_min != null ? `${detail.duration_min} 分钟` : "—";
  document.getElementById("sheet-servings").textContent =
    detail.servings != null ? `${detail.servings} 人份` : "—";

  const hero = document.getElementById("sheet-hero");
  const af = detail.accent_from || "#047857";
  const at = detail.accent_to || "#34d399";
  hero.style.background = `linear-gradient(120deg, ${af}, ${at})`;

  document.getElementById("sheet-story").innerHTML = renderBody(detail.story_md || "");

  const ing = document.getElementById("sheet-ingredients");
  const stp = document.getElementById("sheet-steps");
  ing.innerHTML = "";
  stp.innerHTML = "";
  for (const ln of lines) {
    const li = document.createElement("li");
    li.textContent = ln.text || "";
    if (ln.kind === "step") stp.append(li);
    else ing.append(li);
  }
  if (!ing.children.length) {
    const li = document.createElement("li");
    li.textContent = "暂无记录";
    ing.append(li);
  }
  if (!stp.children.length) {
    const li = document.createElement("li");
    li.textContent = "暂无步骤";
    stp.append(li);
  }

  sheet.showModal();
}

await loadRecipes();
