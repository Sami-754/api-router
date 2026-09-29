"use strict";
/* API Router dashboard — vanilla JS, no build step. All state via /api/*. */

const main = document.getElementById("main");
const toastEl = document.getElementById("toast");
const pageTitle = document.getElementById("pagetitle");

const CAPABILITIES = [
  "llm.chat", "llm.responses", "llm.tools", "llm.vision", "llm.embeddings",
  "web.search", "web.extract", "web.scrape", "web.crawl", "web.map",
];
const POLICIES = ["auto", "burn", "preserve", "fast", "reliable", "cheap", "priority"];
const TOOL_CAPS = ["search", "scrape", "extract", "crawl", "map"];

/* ---------------- utils ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function showToast(msg, ms = 3500) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add("hidden"), ms);
}
const getToken = () => localStorage.getItem("router-admin-token") || "";
const setToken = (t) => localStorage.setItem("router-admin-token", t);

function openOverlay(id) { document.getElementById(id).classList.remove("hidden"); }
function closeOverlay(id) { document.getElementById(id).classList.add("hidden"); }

/** Management API client: Bearer token, token modal on 401, one 429 backoff retry. */
async function api(method, path, body, retry = true) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const t = getToken();
  if (t) headers["Authorization"] = "Bearer " + t;
  const res = await fetch(path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    openOverlay("tokenbar");
    throw new Error("unauthorized — set the admin token");
  }
  if (res.status === 429 && retry) {
    const waitMs = Math.min(15000, (Number(res.headers.get("retry-after")) || 5) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));
    return api(method, path, body, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data.data;
}

/* ---------------- shared components ---------------- */
function pill(text, kind) {
  return `<span class="pill ${kind || "dim"}">${esc(text)}</span>`;
}
function statusPill(s) {
  if (s === "success" || s === "active" || s === "enabled" || s === "healthy") return pill(s, "ok");
  if (s === "invalid" || s === "error" || s === "failed") return pill(s, "bad");
  if (s === "disabled" || s === "cooldown" || s === "degraded") return pill(s, "warn");
  return pill(s ?? "—", "dim");
}
function shortRes(id) { return String(id || "").replace(/^llm:model:/, ""); }
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toISOString().slice(5, 19).replace("T", " ");
}
function countdown(iso) {
  if (!iso) return "<span class='muted'>no reset</span>";
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return esc(iso);
  if (ms <= 0) return "<span class='muted'>resetting…</span>";
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
  return esc(d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`);
}
function quotaFrac(q) {
  if (!q || q.limitValue <= 0) return null;
  const rem = q.remainingValue ?? Math.max(0, q.limitValue - q.usedValue);
  return Math.max(0, Math.min(100, Math.round((100 * rem) / q.limitValue)));
}
function quotaBar(q) {
  if (!q) return "<span class='muted'>unknown</span>";
  const p = quotaFrac(q);
  if (p === null) return "<span class='muted'>—</span>";
  const cls = p < 10 ? "crit" : p < 25 ? "low" : "";
  return `<span class="bar ${cls}" title="${esc(q.usedValue)}/${esc(q.limitValue)} ${esc(q.metric)}"><i style="width:${p}%"></i></span> <span class="muted">${p}%</span>`;
}
function healthCell(h) {
  if (!h) return "<span class='muted'>—</span>";
  const cd = h.cooldownUntil && Date.parse(h.cooldownUntil) > Date.now();
  if (cd) return pill("cooldown" + (h.lastErrorClass ? " · " + h.lastErrorClass : ""), "bad");
  if (h.consecutiveFailures) return pill(h.consecutiveFailures + " fails", "warn");
  return pill("healthy", "ok");
}
function table(headers, rows, emptyMsg = "Nothing here yet.") {
  if (!rows.length) return `<div class="empty">${esc(emptyMsg)}</div>`;
  return `<div class="table-scroll"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function reqRows(logs) {
  return logs.map((l) => `<tr>
    <td class="mono">${esc(fmtTime(l.createdAt))}</td>
    <td><a class="mono" href="#/requests?id=${encodeURIComponent(l.id)}">${esc(shortRes(l.requestedResourceId) || l.capability || "")}</a></td>
    <td class="mono">${l.selectedProviderId ? esc(l.selectedProviderId + "/" + (l.selectedUpstreamId || "")) : "<span class='muted'>—</span>"}</td>
    <td>${esc(l.policy || "")}</td><td>${statusPill(l.status)}</td>
    <td class="num">${l.attempts ?? "—"}</td>
    <td class="num">${l.totalTokens ?? "—"}</td></tr>`).join("");
}
function reqTable(logs, emptyMsg) {
  if (!logs.length) return `<div class="empty">${esc(emptyMsg || "No requests yet — send one from the Playground.")}</div>`;
  return table(["time", "resource", "route", "policy", "status", "att", "tokens"], [reqRows(logs)]);
}
function keyRows(creds) {
  return creds.map((c) => `<tr>
    <td class="mono">${esc(c.id)}<button class="copybtn" data-copy="${esc(c.id)}" title="Copy credential ID">copy</button></td>
    <td>${esc(c.label || "")}</td>
    <td>${statusPill(c.status)}</td>
    <td class="mono">${c.lastValidatedAt ? esc(fmtTime(c.lastValidatedAt)) : "—"}</td>
    <td><div class="row" style="margin:0">
      <button class="small ghost" data-validate-cred="${esc(c.id)}">Validate</button>
      ${c.status === "active"
        ? `<button class="small ghost" data-cred-status="${esc(c.id)}" data-to="disabled">Disable</button>`
        : `<button class="small ghost" data-cred-status="${esc(c.id)}" data-to="active">Enable</button>`}
    </div></td></tr>`).join("");
}
function policyOptions(sel) {
  return POLICIES.map((p) => `<option value="${p}"${p === sel ? " selected" : ""}>${p}</option>`).join("");
}

/* ---------------- shell ---------------- */
function setHealth(online, text) {
  for (const id of ["healthdot", "healthdot2"]) {
    const d = document.getElementById(id);
    if (d) d.classList.toggle("down", !online);
  }
  for (const id of ["healthtext", "healthtext2"]) {
    const t = document.getElementById(id);
    if (t) t.textContent = text;
  }
}
async function loadStatus() {
  try {
    await fetch("/healthz");
    let pol = "";
    try {
      const s = await api("GET", "/api/settings");
      pol = s.defaultPolicy || "";
      const chip = document.getElementById("policychip");
      if (chip) chip.textContent = pol ? "policy: " + pol : "";
    } catch { /* token not set yet */ }
    setHealth(true, "online" + (pol ? " · " + pol : ""));
  } catch {
    setHealth(false, "offline");
  }
}

document.getElementById("tokensave").onclick = () => {
  setToken(document.getElementById("tokeninput").value.trim());
  closeOverlay("tokenbar");
  showToast("Token saved. Reloading…");
  setTimeout(() => location.reload(), 400);
};
document.getElementById("tokenbtn").onclick = () => {
  openOverlay("tokenbar");
  document.getElementById("tokeninput").value = getToken();
};
document.getElementById("tokenbar").addEventListener("click", (e) => {
  if (e.target.id === "tokenbar") closeOverlay("tokenbar");
});
document.getElementById("settingsbtn").onclick = () => { openSettings(); };
document.getElementById("settingsclose").onclick = () => closeOverlay("settingswrap");
document.getElementById("settingswrap").addEventListener("click", (e) => {
  if (e.target.id === "settingswrap") closeOverlay("settingswrap");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeOverlay("tokenbar"); closeOverlay("settingswrap"); }
});
document.getElementById("menubtn").onclick = () => {
  const open = document.body.classList.toggle("nav-open");
  document.getElementById("scrim").classList.toggle("hidden", !open);
};
document.getElementById("scrim").onclick = () => {
  document.body.classList.remove("nav-open");
  document.getElementById("scrim").classList.add("hidden");
};
document.addEventListener("click", (e) => {
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    navigator.clipboard?.writeText(cp.getAttribute("data-copy")).then(
      () => showToast("Copied to clipboard"),
      () => showToast("Copy failed"),
    );
    return;
  }
  const vs = e.target.closest("[data-cred-status]");
  if (vs) {
    api("PATCH", `/api/credentials/${encodeURIComponent(vs.getAttribute("data-cred-status"))}`, { status: vs.getAttribute("data-to") })
      .then(() => { showToast("Credential " + vs.getAttribute("data-to")); router(); })
      .catch((err) => showToast("Failed: " + err.message));
    return;
  }
  const ot = e.target.closest("[data-open-token]");
  if (ot) {
    openOverlay("tokenbar");
    const inp = document.getElementById("tokeninput");
    if (inp) {
      inp.value = getToken();
      inp.focus();
    }
    return;
  }
  const vv = e.target.closest("[data-validate-cred]");
  if (vv) {
    const id = vv.getAttribute("data-validate-cred");
    showToast("Probing upstream…");
    api("POST", `/api/credentials/${encodeURIComponent(id)}/validate`)
      .then((r) => showToast(r.ok ? `Valid — ${r.message || "upstream accepted the key"}` : `Invalid — ${r.message || "upstream rejected the key"}`))
      .catch((err) => showToast("Validate failed: " + err.message))
      .finally(() => router());
  }
});

/* ---------------- router ---------------- */
const TITLES = {
  "/overview": "Overview",
  "/playground": "Playground",
  "/resources": "Resources",
  "/providers": "Providers & Keys",
  "/quotas": "Quotas & Usage",
  "/requests": "Requests",
};
const ROUTES = {
  "/overview": renderOverview,
  "/playground": renderPlayground,
  "/resources": renderResources,
  "/providers": renderProviders,
  "/quotas": renderQuotas,
  "/requests": renderRequests,
};
const SKELETON = `<h1>&nbsp;</h1><div class="skel">
  <div class="skel-line" style="width:42%"></div>
  <div class="skel-line" style="width:88%"></div>
  <div class="skel-line" style="width:67%"></div>
  <div class="skel-line" style="width:78%"></div></div>`;
function router() {
  const hash = location.hash || "#/overview";
  const [path, query] = hash.slice(1).split("?");
  const fn = ROUTES[path] || renderOverview;
  pageTitle.textContent = TITLES[path] || "Overview";
  document.querySelectorAll(".side a").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === "#" + path));
  document.body.classList.remove("nav-open");
  document.getElementById("scrim").classList.add("hidden");
  main.innerHTML = SKELETON;
  fn(new URLSearchParams(query || "")).catch((e) => {
    main.innerHTML = `<h1>Something went wrong</h1><div class="empty"><p>${esc(e.message)}</p><p><button class="ghost small" onclick="location.reload()">Retry</button></p></div>`;
  });
}
window.addEventListener("hashchange", router);

const refreshBtn = document.getElementById("refreshbtn");
if (refreshBtn) {
  refreshBtn.onclick = () => {
    loadStatus();
    router();
    showToast("Refreshed");
  };
}
setInterval(loadStatus, 30000);

/* ---------------- overview ---------------- */
async function renderOverview() {
  const o = await api("GET", "/api/overview");
  const recent = await api("GET", "/api/requests?limit=12");
  const hist = await api("GET", "/api/requests?limit=500").catch(() => []);
  const buckets = new Array(24).fill(0);
  const errs = new Array(24).fill(0);
  const now = Date.now();
  hist.forEach((l) => {
    const h = Math.floor((now - Date.parse(l.createdAt)) / 3600000);
    if (h >= 0 && h < 24) {
      buckets[23 - h]++;
      if (l.status !== "success") errs[23 - h]++;
    }
  });
  const max = Math.max(1, ...buckets);
  const st = o.credentialsByStatus;
  main.innerHTML = `<h1>Overview</h1>
    <p class="sub">Live state of the router — everything below is read from the API, nothing is mocked.</p>
    <div class="cards">
      <a class="card" href="#/providers"><div class="n">${o.providers}</div><div class="l">${o.providersEnabled} enabled providers</div></a>
      <a class="card" href="#/providers"><div class="n">${o.accounts}</div><div class="l">accounts</div></a>
      <a class="card" href="#/providers"><div class="n">${o.credentials}</div><div class="l"><span class="ok">● ${st.active}</span> · <span class="warn">● ${st.disabled}</span> · <span class="bad">● ${st.invalid}</span></div></a>
      <a class="card" href="#/resources"><div class="n">${o.resources}</div><div class="l">canonical resources</div></a>
      <a class="card" href="#/resources"><div class="n">${o.mappings}</div><div class="l">provider mappings</div></a>
      <a class="card" href="#/requests"><div class="n">${o.requests24h}</div><div class="l">requests / 24h${o.successRate24h == null ? "" : ` · ${Math.round(o.successRate24h * 100)}% ok`}</div></a>
      <a class="card" href="#/quotas"><div class="n small">${Number(o.tokens24h).toLocaleString()}</div><div class="l">tokens / 24h</div></a>
    </div>
    <h2>Requests — last 24h <span class="count">hourly, oldest → newest</span></h2>
    <div class="hist">${buckets.map((b, i) => `<i style="height:${Math.max(3, Math.round((100 * b) / max))}%;${errs[i] && b ? "background:var(--warn)" : ""}" title="${b} requests, ${errs[i]} failed"></i>`).join("")}</div>
    <h2>Recent requests</h2>
    ${reqTable(recent)}`;
}

/* ---------------- playground ---------------- */
async function renderPlayground(q) {
  const settings = await api("GET", "/api/settings").catch(() => ({ defaultPolicy: "auto" }));
  const tab = TOOL_CAPS.includes(q.get("tab")) ? q.get("tab") : "chat";
  main.innerHTML = `<h1>Playground</h1>
    <p class="sub">Send real requests through the routing core. Every run shows the actual route, policy and attempts.</p>
    <div class="tabs" role="tablist">
      <button data-tab="chat" class="${tab === "chat" ? "on" : ""}">Chat</button>
      ${TOOL_CAPS.map((c) => `<button data-tab="${c}" class="${tab === c ? "on" : ""}">${c}</button>`).join("")}
    </div>
    <div id="tabbody"></div>`;
  main.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      const t = b.getAttribute("data-tab");
      location.hash = t === "chat" ? "#/playground" : `#/playground?tab=${t}`;
    };
  });
  if (tab === "chat") renderChatTab(settings.defaultPolicy);
  else renderToolTab(tab);
}
function routingFields() {
  return `<div class="formgrid">
    <div><label>Provider pin (optional)</label><input name="provider" size="14" placeholder="groq"></div>
    <div><label>Policy</label><select name="policy"><option value="">(router default)</option>${policyOptions("")}</select></div>
  </div>`;
}
function renderChatTab(defaultPolicy) {
  const body = document.getElementById("tabbody");
  body.innerHTML = `<form id="chatform">
      <div class="formgrid">
        <div style="grid-column:1/-1"><label>Model (canonical or provider::model)</label><input name="model" required value="nvidia/nemotron-3-super-120b-a12b"></div>
      </div>
      ${routingFields()}
      <div><label style="margin-bottom:8px"><input type="checkbox" name="stream"> stream (SSE)</label></div>
      <div style="margin:10px 0"><label class="muted" style="display:block;margin-bottom:6px">User message</label>
      <textarea name="message" rows="3">Reply with exactly: router alive</textarea></div>
      <button class="primary">Send</button>
      <span class="muted">default policy: ${esc(defaultPolicy)}</span>
    </form>
    <div id="chatout" style="margin-top:14px"></div>`;
  document.getElementById("chatform").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = document.getElementById("chatout");
    const t0 = Date.now();
    const payload = {
      model: String(f.get("model")),
      messages: [{ role: "user", content: String(f.get("message")) }],
      max_tokens: 300,
    };
    const routing = {};
    if (f.get("provider")) routing.provider = String(f.get("provider"));
    if (f.get("policy")) routing.policy = String(f.get("policy"));
    if (Object.keys(routing).length) payload.routing = routing;
    if (f.get("stream")) return runChatStream(payload, out, t0);
    out.innerHTML = "<p class='muted'>Sending…</p>";
    try {
      const res = await fetch("/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
      out.innerHTML = `<p>${pill("via " + res.headers.get("x-router-via"), "ok")} ${pill("policy " + res.headers.get("x-router-policy"), "dim")} ${pill(res.headers.get("x-router-attempts") + " attempt(s)", "dim")} ${pill(Date.now() - t0 + "ms", "dim")}</p>
        <pre class="dump">${esc(j.choices?.[0]?.message?.content ?? JSON.stringify(j, null, 2))}</pre>
        <p class="muted mono">usage: ${esc(JSON.stringify(j.usage || {}))}</p>`;
    } catch (err) {
      out.innerHTML = `<p>${pill("failed", "bad")} ${esc(err.message)}</p>`;
    }
  };
}
async function runChatStream(payload, out, t0) {
  payload.stream = true;
  out.innerHTML = `<div class="streamout" id="live"></div><p class="muted" id="livemeta">connecting…</p>`;
  const live = document.getElementById("live"), meta = document.getElementById("livemeta");
  try {
    const res = await fetch("/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message || `HTTP ${res.status}`);
    }
    const via = res.headers.get("x-router-via"), att = res.headers.get("x-router-attempts");
    meta.textContent = `via ${via} · ${att} attempt(s) · streaming…`;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const chunk = t.slice(5).trim();
          if (chunk === "[DONE]") continue;
          try {
            const j = JSON.parse(chunk);
            const delta = j.choices?.[0]?.delta?.content || "";
            if (delta) { text += delta; live.textContent = text; }
          } catch { /* keep-alive */ }
        }
      }
    }
    meta.textContent = `via ${via} · ${att} attempt(s) · done in ${Date.now() - t0}ms`;
  } catch (err) {
    meta.textContent = "failed: " + err.message;
  }
}
function renderToolTab(cap) {
  const body = document.getElementById("tabbody");
  const fields = {
    search: `<div><label>Query</label><input name="query" required placeholder="latest nemotron news"></div>
             <div><label>Max results</label><input name="maxResults" type="number" value="5" style="width:90px"></div>`,
    scrape: `<div style="grid-column:1/-1"><label>URL</label><input name="url" required size="50" placeholder="https://example.com"></div>
             <div><label>Max chars</label><input name="maxChars" type="number" value="8000" style="width:100px"></div>`,
    extract: `<div style="grid-column:1/-1"><label>URLs (one per line, up to 20)</label><textarea name="urls" rows="3" placeholder="https://example.com"></textarea></div>
              <div style="grid-column:1/-1"><label>Query (optional)</label><input name="query" placeholder="what is this page about?"></div>`,
    crawl: `<div style="grid-column:1/-1"><label>URL</label><input name="url" required size="50" placeholder="https://example.com"></div>
            <div><label>Page limit</label><input name="limit" type="number" value="10" style="width:90px"></div>`,
    map: `<div style="grid-column:1/-1"><label>URL</label><input name="url" required size="50" placeholder="https://example.com"></div>
          <div><label>Link limit</label><input name="limit" type="number" value="50" style="width:90px"></div>`,
  }[cap];
  body.innerHTML = `<form id="toolform"><div class="formgrid">${fields}</div>${routingFields()}
    <button class="primary">Run ${esc(cap)}</button></form><div id="toolout" style="margin-top:14px"></div>`;
  document.getElementById("toolform").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = document.getElementById("toolout");
    const payload = {};
    if (cap === "search") { payload.query = String(f.get("query")); payload.maxResults = Number(f.get("maxResults") || 5); }
    if (cap === "scrape") { payload.url = String(f.get("url")); if (f.get("maxChars")) payload.maxChars = Number(f.get("maxChars")); }
    if (cap === "extract") {
      payload.urls = String(f.get("urls")).split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 20);
      if (f.get("query")) payload.query = String(f.get("query"));
    }
    if (cap === "crawl" || cap === "map") { payload.url = String(f.get("url")); if (f.get("limit")) payload.limit = Number(f.get("limit")); }
    const routing = {};
    if (f.get("provider")) routing.provider = String(f.get("provider"));
    if (f.get("policy")) routing.policy = String(f.get("policy"));
    if (Object.keys(routing).length) payload.routing = routing;
    out.innerHTML = "<p class='muted'>Running…</p>";
    try {
      const res = await fetch(`/v1/tools/${cap}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
      out.innerHTML = `<p>${pill("via " + res.headers.get("x-router-via"), "ok")} ${pill(res.headers.get("x-router-attempts") + " attempt(s)", "dim")}</p>` + toolResultHtml(cap, j);
    } catch (err) {
      out.innerHTML = `<p>${pill("failed", "bad")} ${esc(err.message)}</p>`;
    }
  };
}
function toolResultHtml(cap, j) {
  if (cap === "search") {
    return (j.results || []).map((r) => `<div class="searchres"><div class="t">${esc(r.title || r.url)}</div><div class="u">${esc(r.url)}</div><div class="s">${esc((r.snippet || r.markdown || "").slice(0, 400))}</div></div>`).join("")
      || `<pre class="dump">${esc(JSON.stringify(j, null, 2))}</pre>`;
  }
  if (cap === "scrape") return `<pre class="dump">${esc(j.markdown || JSON.stringify(j, null, 2))}</pre>`;
  if (cap === "extract") {
    return (j.results || []).map((r) => `<div class="searchres"><div class="t">${esc(r.title || r.url)}</div><div class="u">${esc(r.url)}</div>${r.error ? `<div>${pill("error: " + r.error, "bad")}</div>` : `<div class="s">${esc((r.content || "").slice(0, 500))}</div>`}</div>`).join("");
  }
  if (cap === "crawl") {
    return (j.pages || []).map((p) => `<div class="searchres"><div class="t">${esc(p.title || p.url)}</div><div class="u">${esc(p.url)}</div><div class="s">${esc((p.markdown || "").slice(0, 300))}</div></div>`).join("")
      || `<pre class="dump">${esc(JSON.stringify(j, null, 2))}</pre>`;
  }
  return `<div class="panel"><h3>${(j.links || []).length} links</h3>${(j.links || []).map((l) => `<div class="mono" style="padding:2px 0">${esc(l.url || l)}</div>`).join("")}</div>`;
}

/* ---------------- resources ---------------- */
async function renderResources(q) {
  const id = q.get("id");
  if (id) return renderResourceDetail(id, q.get("cap") || "llm.chat");
  const resources = await api("GET", "/api/resources");
  const filter = (q.get("q") || "").toLowerCase();
  const capFilter = q.get("cap") || "";
  const rows = resources.filter((r) =>
    (!filter || r.id.toLowerCase().includes(filter) || (r.displayName || "").toLowerCase().includes(filter)) &&
    (!capFilter || (r.capabilities || []).includes(capFilter)));
  // One batched count request — never one /api/routes call per row.
  let counts = {};
  try {
    counts = await api("GET", `/api/routes/counts${capFilter ? `?capability=${encodeURIComponent(capFilter)}` : ""}`);
  } catch { /* list still renders without counts */ }
  main.innerHTML = `<h1>Resources <span class="muted">(${resources.length})</span></h1>
    <p class="sub">Canonical resources — what clients ask for. Routes decide where they are served from.</p>
    <form class="inline" id="resfilter">
      <label>Search<input id="resq" value="${esc(q.get("q") || "")}" placeholder="nemotron…"></label>
      <label>Capability<select id="rescap"><option value="">all</option>${CAPABILITIES.map((c) => `<option value="${c}"${c === capFilter ? " selected" : ""}>${c}</option>`).join("")}</select></label>
      <button>Filter</button>
    </form>
    ${table(["canonical id", "kind", "capabilities", "routes"],
      rows.slice(0, 300).map((r) => `<tr>
        <td><a class="mono" href="#/resources?id=${encodeURIComponent(r.id)}">${esc(shortRes(r.id))}</a></td>
        <td>${esc(r.kind)}</td><td class="mono muted">${esc((r.capabilities || []).join(" · "))}</td>
        <td class="num">${counts[r.id] ?? "<span class='muted'>—</span>"}</td></tr>`),
      "No resources match this filter.")}
    ${rows.length > 300 ? `<p class="muted">showing 300 of ${rows.length} — refine the search.</p>` : ""}
    <h2>Add canonical resource</h2>
    <form class="inline" id="addres">
      <label>ID<input name="id" required placeholder="llm:model:my-model" size="30"></label>
      <label>Display name<input name="displayName" required></label>
      <label>Kind<select name="kind"><option value="llm_model">llm_model</option><option value="capability">capability</option></select></label>
      <button>Add</button>
    </form>`;
  document.getElementById("resfilter").onsubmit = (e) => {
    e.preventDefault();
    const qq = document.getElementById("resq").value;
    const cc = document.getElementById("rescap").value;
    location.hash = `#/resources?q=${encodeURIComponent(qq)}${cc ? `&cap=${encodeURIComponent(cc)}` : ""}`;
  };
  document.getElementById("addres").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("POST", "/api/resources", {
      id: String(f.get("id")), displayName: String(f.get("displayName")), kind: String(f.get("kind")), capabilities: ["llm.chat"],
    });
    showToast("Resource added"); router();
  };
}
async function renderResourceDetail(id, cap) {
  const [mappings, providers] = await Promise.all([
    api("GET", `/api/provider-resources?resource=${encodeURIComponent(id)}`),
    api("GET", "/api/providers"),
  ]);
  const caps = [...new Set(mappings.flatMap((m) => m.capabilities || []))];
  if (!caps.includes(cap)) cap = caps[0] || "llm.chat";
  const expanded = await api("GET", `/api/routes?resource=${encodeURIComponent(id)}&capability=${encodeURIComponent(cap)}`);
  const byPr = {};
  expanded.forEach((r) => { (byPr[r.providerResourceId] = byPr[r.providerResourceId] || []).push(r); });
  main.innerHTML = `<h1 class="mono">${esc(shortRes(id))}</h1>
    <p class="sub">${esc(id)} · ${expanded.length} executable routes · <span class="mono">${esc(cap)}</span></p>
    <div class="row">
      <button class="ghost small" id="backres">← all resources</button>
      <select id="detailcap" title="Capability">${caps.map((c) => `<option value="${esc(c)}"${c === cap ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <button class="danger small" id="delres">Delete resource</button>
    </div>
    ${mappings.map((m) => {
      const routes = (byPr[m.id] || []).filter((r) => (r.credentialId));
      return `<div class="panel"><h3>${esc(m.providerId)} → <span class="mono">${esc(m.upstreamId)}</span>
        ${m.enabled ? pill("enabled", "ok") : pill("disabled", "warn")}</h3>
        <div class="row">
          <button class="small ghost" data-mapping="${esc(m.id)}" data-to="${m.enabled ? "false" : "true"}">${m.enabled ? "Disable" : "Enable"}</button>
          <button class="small danger" data-delmapping="${esc(m.id)}">Delete mapping</button>
        </div>
        ${routes.length ? table(["account", "credential", "quota", "reset in", "health", "latency"],
          routes.map((r) => {
            const qq = (r.quotas || [])[0];
            return `<tr><td class="mono">${esc(r.accountId)}</td><td class="mono">${esc(r.credentialId)}</td>
              <td>${quotaBar(qq)}<div class="muted mono" style="font-size:11px">${qq ? esc(qq.metric) : ""}</div></td>
              <td>${qq ? countdown(qq.resetAt) : "—"}</td>
              <td>${healthCell(r.health)}</td>
              <td class="num">${r.health?.latencyEmaMs != null ? Math.round(r.health.latencyEmaMs) + "ms" : "—"}</td></tr>`;
          })) : "<p class='muted'>No credentials under this provider — add keys to create routes.</p>"}</div>`;
    }).join("")}
    <h2>Add provider mapping</h2>
    <form class="inline" id="addmap">
      <label>Provider<select name="providerId">${providers.map((p) => `<option>${esc(p.id)}</option>`).join("")}</select></label>
      <label>Upstream ID<input name="upstreamId" required size="28" placeholder="vendor/model-id"></label>
      <button>Map</button>
    </form>
    <h2>Simulate routing <span class="count">ranked candidates for this resource</span></h2>
    <form class="inline" id="simform">
      <label>Policy<select name="policy">${policyOptions("burn")}</select></label>
      <label>Provider pin<input name="provider" size="12" placeholder="(none)"></label>
      <button>Rank</button>
    </form>
    <div id="simout"></div>`;
  document.getElementById("backres").onclick = () => { location.hash = "#/resources"; };
  document.getElementById("detailcap").onchange = (e) => {
    location.hash = `#/resources?id=${encodeURIComponent(id)}&cap=${encodeURIComponent(e.target.value)}`;
  };
  document.getElementById("delres").onclick = async () => {
    if (!confirm(`Delete resource ${id} and all its mappings?`)) return;
    await api("DELETE", `/api/resources/${encodeURIComponent(id)}`);
    showToast("Resource deleted"); location.hash = "#/resources";
  };
  main.querySelectorAll("[data-mapping]").forEach((b) => {
    b.onclick = async () => {
      await api("PATCH", `/api/provider-resources/${encodeURIComponent(b.getAttribute("data-mapping"))}`, { enabled: b.getAttribute("data-to") === "true" });
      showToast(b.getAttribute("data-to") === "true" ? "Mapping enabled" : "Mapping disabled"); router();
    };
  });
  main.querySelectorAll("[data-delmapping]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Delete this provider mapping?")) return;
      await api("DELETE", `/api/provider-resources/${encodeURIComponent(b.getAttribute("data-delmapping"))}`);
      showToast("Mapping deleted"); router();
    };
  });
  document.getElementById("addmap").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("POST", "/api/provider-resources", {
      resourceId: id, providerId: String(f.get("providerId")), upstreamId: String(f.get("upstreamId")), capabilities: [cap],
    });
    showToast("Mapping added"); router();
  };
  document.getElementById("simform").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = document.getElementById("simout");
    out.innerHTML = "<p class='muted'>Ranking…</p>";
    const d = await api("POST", "/api/routing/simulate", {
      resource: id, capability: cap, policy: String(f.get("policy")),
      provider: String(f.get("provider")) || undefined,
    });
    out.innerHTML = `<h2>Eligible <span class="count">(${d.eligible.length}, policy ${esc(d.policy)})</span></h2>
      ${table(["#", "route", "score", "reason"],
        d.eligible.slice(0, 25).map((r, i) => `<tr><td class="num">${i + 1}</td>
          <td class="mono">${esc(r.provider)} / ${esc(r.account)}<br><span class="muted">${esc(r.upstream)}</span></td>
          <td class="num">${r.score.toFixed(3)}</td><td>${esc(r.reason)}</td></tr>`),
        "No eligible routes — see filtered list below.")}
      ${d.filtered.length ? `<h2>Filtered out <span class="count">(${d.filtered.length})</span></h2>
      ${table(["route", "reason"],
        d.filtered.slice(0, 25).map((r) => `<tr><td class="mono">${esc(r.provider)} / ${esc(r.account)}</td><td>${esc(r.reason)}</td></tr>`))}` : ""}`;
  };
}

/* ---------------- providers & keys ---------------- */
async function renderProviders(q) {
  const id = q.get("id");
  if (id) return renderProviderDetail(id);
  const providers = await api("GET", "/api/providers");
  const filter = (q.get("q") || "").toLowerCase();
  const rows = providers.filter((p) => !filter || p.id.includes(filter) || (p.displayName || "").toLowerCase().includes(filter));
  const clientBase = location.origin + "/v1";
  const clientChat = location.origin + "/v1/chat/completions";
  const token = getToken();

  main.innerHTML = `<h1>Providers &amp; Keys <span class="muted">(${providers.length})</span></h1>
    <p class="sub">Each upstream provider owns accounts and API keys. The router automatically rotates keys and handles fallback.</p>

    <div class="connect-banner">
      <h3><span>⚡</span> Client Connection Guide</h3>
      <p>Point any OpenAI-compatible client (Cursor, Continue, LibreChat, OpenAI SDK, LangChain, etc.) to this router:</p>
      <div class="connect-grid">
        <div class="connect-box">
          <span class="connect-label">OpenAI Base URL</span>
          <div class="connect-val">
            <span class="mono">${esc(clientBase)}</span>
            <button class="copybtn" data-copy="${esc(clientBase)}" title="Copy Base URL">copy</button>
          </div>
        </div>
        <div class="connect-box">
          <span class="connect-label">Chat Completions Endpoint</span>
          <div class="connect-val">
            <span class="mono">${esc(clientChat)}</span>
            <button class="copybtn" data-copy="${esc(clientChat)}" title="Copy Chat Endpoint">copy</button>
          </div>
        </div>
        <div class="connect-box">
          <span class="connect-label">API Key / Auth Header</span>
          <div class="connect-val">
            <span class="mono">${token ? esc(token.slice(0, 10)) + "•••••" : "Bearer (optional in local dev)"}</span>
            ${token ? `<button class="copybtn" data-copy="${esc(token)}" title="Copy Admin Token">copy</button>` : `<button class="copybtn" data-open-token title="Set Token">set</button>`}
          </div>
        </div>
      </div>
    </div>

    <form class="inline" id="provfilter">
      <label>Search<input value="${esc(q.get("q") || "")}" id="provq" placeholder="groq…"></label>
      <button>Filter</button>
    </form>
    ${table(["provider", "upstream base URL", "state", "priority", ""],
      rows.map((p) => `<tr>
        <td><a href="#/providers?id=${esc(p.id)}"><b>${esc(p.id)}</b></a><br><span class="muted">${esc(p.displayName)}</span></td>
        <td class="mono muted">${esc(p.baseUrl || "—")}</td>
        <td>${p.enabled ? pill("enabled", "ok") : pill("disabled", "warn")}</td>
        <td class="num">${p.priority}</td>
        <td><button class="small ghost" data-provider="${esc(p.id)}" data-to="${p.enabled ? "false" : "true"}">${p.enabled ? "Disable" : "Enable"}</button></td>
      </tr>`), "No providers match.")}`;
  document.getElementById("provfilter").onsubmit = (e) => {
    e.preventDefault();
    location.hash = "#/providers?q=" + encodeURIComponent(document.getElementById("provq").value);
  };
  main.querySelectorAll("[data-provider]").forEach((b) => {
    b.onclick = async () => {
      await api("PATCH", `/api/providers/${encodeURIComponent(b.getAttribute("data-provider"))}`, { enabled: b.getAttribute("data-to") === "true" });
      showToast(b.getAttribute("data-to") === "true" ? "Provider enabled" : "Provider disabled"); router();
    };
  });
}
async function renderProviderDetail(id) {
  const [providers, accounts, creds] = await Promise.all([
    api("GET", "/api/providers"),
    api("GET", `/api/accounts?provider=${encodeURIComponent(id)}`),
    api("GET", "/api/credentials"),
  ]);
  const p = providers.find((x) => x.id === id);
  if (!p) { main.innerHTML = "<h1>Unknown provider</h1>"; return; }
  const mine = creds.filter((c) => c.providerId === id);
  const byAccount = {};
  mine.forEach((c) => { (byAccount[c.accountId] = byAccount[c.accountId] || []).push(c); });
  main.innerHTML = `<h1>${esc(p.id)}</h1>
    <p class="sub">${esc(p.displayName)} · ${accounts.length} accounts · ${mine.length} keys</p>
    <div class="row">
      <button class="ghost small" id="backprov">← all providers</button>
      <button class="danger small" id="delprov">Delete provider</button>
    </div>
    <h2>Config</h2>
    <form class="inline" id="saveprov">
      <label>Display name<input name="displayName" value="${esc(p.displayName)}"></label>
      <label>Base URL<input name="baseUrl" size="42" value="${esc(p.baseUrl || "")}"></label>
      <label>Priority<input name="priority" type="number" value="${p.priority}" style="width:80px"></label>
      <label>Enabled<select name="enabled"><option value="true"${p.enabled ? " selected" : ""}>on</option><option value="false"${!p.enabled ? " selected" : ""}>off</option></select></label>
      <button>Save</button>
    </form>
    <h2>Accounts &amp; keys <span class="count">(${accounts.length} accounts)</span></h2>
    <div class="row"><button class="small ghost" id="valall">Validate all stale keys</button></div>
    <div id="jobout"></div>
    <div class="tree" style="margin-top:10px">
      ${accounts.map((a) => `<div class="tree-node">
        <div class="tree-head">
          <span class="name mono">${esc(a.id)}</span>
          ${a.enabled ? pill("on", "ok") : pill("off", "warn")}
          <span class="muted">${esc(a.displayName || "")}</span>
          <span class="grow"></span>
          <span class="muted">${(byAccount[a.id] || []).length} keys</span>
          <button class="small danger" data-delaccount="${esc(a.id)}">Delete</button>
        </div>
        <div class="tree-children">
          ${(byAccount[a.id] || []).length
            ? table(["credential", "label", "status", "validated", ""], [keyRows(byAccount[a.id] || [])])
            : "<p class='muted'>No keys on this account.</p>"}
        </div>
      </div>`).join("") || "<div class='empty'>No accounts yet.</div>"}
    </div>
    <h2>Add account</h2>
    <form class="inline" id="addacct">
      <label>Account ID<input name="id" required placeholder="${esc(id)}-main"></label>
      <label>Display<input name="displayName"></label>
      <button>Add account</button>
    </form>
    <h2>Add key</h2>
    <form class="inline" id="addcred">
      <label>Account<select name="accountId">${accounts.map((a) => `<option>${esc(a.id)}</option>`).join("")}</select></label>
      <label>Label<input name="label" placeholder="main"></label>
      <label>Secret<input name="secret" required type="password" size="34" autocomplete="off"></label>
      <button>Add key</button>
    </form>
    <p class="muted">Secrets are encrypted at rest and never returned by the API.</p>`;
  document.getElementById("backprov").onclick = () => { location.hash = "#/providers"; };
  document.getElementById("delprov").onclick = async () => {
    if (!confirm(`Delete provider ${id} + ALL its accounts, keys and mappings?`)) return;
    await api("DELETE", `/api/providers/${encodeURIComponent(id)}`);
    showToast("Provider deleted"); location.hash = "#/providers";
  };
  document.getElementById("saveprov").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("PATCH", `/api/providers/${encodeURIComponent(id)}`, {
      displayName: String(f.get("displayName")), baseUrl: String(f.get("baseUrl")) || null,
      priority: Number(f.get("priority")), enabled: String(f.get("enabled")) === "true",
    });
    showToast("Provider saved"); router();
  };
  main.querySelectorAll("[data-delaccount]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Delete account ${b.getAttribute("data-delaccount")} + its keys?`)) return;
      await api("DELETE", `/api/accounts/${encodeURIComponent(b.getAttribute("data-delaccount"))}`);
      showToast("Account deleted"); router();
    };
  });
  document.getElementById("valall").onclick = async () => {
    const out = document.getElementById("jobout");
    out.innerHTML = "<p class='muted'>Validating stale keys (staggered)…</p>";
    try {
      const s = await api("POST", "/api/maintenance/validate", { provider: id, limit: 50 });
      out.innerHTML = `<p>${pill(s.ok + "/" + s.checked + " valid", s.invalid ? "warn" : "ok")} ${pill(s.skippedFresh + " fresh-skipped", "dim")}` +
        (s.errors?.length ? ` — <span class="muted">${esc(s.errors.slice(0, 3).map((e) => e.credential).join(", "))}${s.errors.length > 3 ? "…" : ""}</span>` : "") + `</p>`;
      showToast(`Validation: ${s.ok} ok, ${s.invalid} invalid`);
    } catch (e2) { out.innerHTML = `<p>${pill("job failed", "bad")} ${esc(e2.message)}</p>`; }
  };
  const addAcct = document.getElementById("addacct");
  if (addAcct) addAcct.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("POST", "/api/accounts", { id: String(f.get("id")), providerId: id, displayName: String(f.get("displayName")) || null });
    showToast("Account added"); router();
  };
  const addCred = document.getElementById("addcred");
  if (addCred) addCred.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("POST", "/api/credentials", { accountId: String(f.get("accountId")), label: String(f.get("label")) || null, secret: String(f.get("secret")) });
    showToast("Key stored (encrypted)"); router();
  };
}

/* ---------------- quotas & usage ---------------- */
async function renderQuotas(q) {
  const [quotas, creds] = await Promise.all([api("GET", "/api/quotas"), api("GET", "/api/credentials")]);
  const filter = (q.get("q") || "").toLowerCase();
  const rows = quotas.filter((w) => !filter || w.credentialId.toLowerCase().includes(filter) || w.metric.toLowerCase().includes(filter));
  main.innerHTML = `<h1>Quotas &amp; Usage <span class="muted">(${quotas.length} windows)</span></h1>
    <p class="sub">Static windows are provider-reported; per-minute/hour and router-configured daily caps reset live from usage.</p>
    <form class="inline" id="quotausage">
      <label>Live usage — credential<input name="credentialId" required size="28" placeholder="cred-…" value="${esc(q.get("credential") || "")}"></label>
      <button>Look up</button>
    </form>
    <div id="usageout"></div>
    <form class="inline" id="quotafilter">
      <label>Filter<input id="quotaq" value="${esc(q.get("q") || "")}" placeholder="credential / metric"></label>
      <button>Filter</button>
    </form>
    ${table(["credential", "metric", "used / limit", "left", "window", "reset in", "hard", "source", ""],
      rows.slice(0, 300).map((w) => `<tr><td class="mono">${esc(w.credentialId)}</td><td>${esc(w.metric)}</td>
        <td class="mono num">${esc(w.usedValue)}/${esc(w.limitValue)}</td><td>${quotaBar(w)}</td>
        <td>${esc(w.windowKind)}</td><td>${countdown(w.resetAt)}</td>
        <td>${w.hard ? "yes" : "no"}</td><td>${esc(w.source)}</td>
        <td><button class="small danger" data-delquota="${esc(w.id)}">Delete</button></td></tr>`),
      "No quota windows configured.")}
    ${rows.length > 300 ? `<p class="muted">showing 300 of ${rows.length}</p>` : ""}
    <h2>Add quota window</h2>
    <form class="inline" id="addquota">
      <label>Credential<select name="credentialId">${creds.filter((c) => c.status === "active").map((c) => `<option value="${esc(c.id)}">${esc(c.id)}</option>`).join("")}</select></label>
      <label>Metric<select name="metric"><option>requests</option><option>total_tokens</option><option>input_tokens</option><option>output_tokens</option><option>credits</option><option>usd</option><option>searches</option><option>pages</option><option>crawl_units</option></select></label>
      <label>Limit<input name="limitValue" type="number" value="1000" style="width:90px"></label>
      <label>Used<input name="usedValue" type="number" value="0" style="width:90px"></label>
      <label>Window<select name="windowKind"><option>calendar_day</option><option>calendar_month</option><option>calendar_week</option><option>calendar_hour</option><option>rolling_seconds</option><option>fixed</option></select></label>
      <label>Reset at (ISO)<input name="resetAt" placeholder="2026-10-01T00:00:00Z" size="22"></label>
      <label>Hard<select name="hard"><option value="true">yes</option><option value="false">no</option></select></label>
      <button>Add</button>
    </form>`;
  document.getElementById("quotausage").onsubmit = async (e) => {
    e.preventDefault();
    const cid = String(new FormData(e.target).get("credentialId"));
    const out = document.getElementById("usageout");
    try {
      const u = await api("GET", `/api/usage?credential=${encodeURIComponent(cid)}`);
      out.innerHTML = `<div class="panel"><h3 class="mono">${esc(cid)}</h3>
        <p>${pill("requests/24h: " + u.requests, "acc")} ${pill("tokens/24h: " + Number(u.total_tokens).toLocaleString(), "acc")} ${pill("searches: " + u.searches, "info")}</p>
        <p class="muted mono">in ${u.input_tokens} / out ${u.output_tokens} · since ${esc(u.since)}</p></div>`;
    } catch (err) { out.innerHTML = `<p>${pill("lookup failed", "bad")} ${esc(err.message)}</p>`; }
  };
  document.getElementById("quotafilter").onsubmit = (e) => {
    e.preventDefault();
    location.hash = "#/quotas?q=" + encodeURIComponent(document.getElementById("quotaq").value);
  };
  main.querySelectorAll("[data-delquota]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Delete this quota window?")) return;
      await api("DELETE", `/api/quotas/${encodeURIComponent(b.getAttribute("data-delquota"))}`);
      showToast("Quota deleted"); router();
    };
  });
  document.getElementById("addquota").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("POST", "/api/quotas", {
      credentialId: String(f.get("credentialId")), metric: String(f.get("metric")),
      limitValue: Number(f.get("limitValue")), usedValue: Number(f.get("usedValue") || 0),
      windowKind: String(f.get("windowKind")), resetAt: String(f.get("resetAt")) || null,
      hard: String(f.get("hard")) === "true", source: "configured",
    });
    showToast("Quota added"); router();
  };
}

/* ---------------- requests ---------------- */
async function renderRequests(q) {
  const id = q.get("id");
  if (id) {
    const l = await api("GET", `/api/requests/${encodeURIComponent(id)}`);
    main.innerHTML = `<h1>Request</h1>
      <p><button class="ghost small" id="backreq">← all requests</button></p>
      <div class="panel"><dl class="kv">
      ${Object.entries(l).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v, null, 2) : (v ?? "—"))}</dd>`).join("")}
      </dl></div>`;
    document.getElementById("backreq").onclick = () => { location.hash = "#/requests"; };
    return;
  }
  const logs = await api("GET", "/api/requests?limit=200");
  const status = q.get("status") || "";
  const pf = (q.get("provider") || "").toLowerCase();
  const rows = logs.filter((l) =>
    (!status || l.status === status) &&
    (!pf || (l.selectedProviderId || "").toLowerCase().includes(pf)));
  main.innerHTML = `<h1>Requests <span class="muted">(latest ${logs.length})</span></h1>
    <form class="inline" id="reqfilter">
      <label>Status<select id="reqstatus"><option value="">all</option><option${status === "success" ? " selected" : ""}>success</option><option${status === "error" ? " selected" : ""}>error</option></select></label>
      <label>Provider<input id="reqprov" value="${esc(q.get("provider") || "")}" placeholder="groq…" size="14"></label>
      <button>Filter</button>
    </form>
    ${reqTable(rows, "No requests match this filter.")}`;
  document.getElementById("reqfilter").onsubmit = (e) => {
    e.preventDefault();
    const s = document.getElementById("reqstatus").value;
    const p = document.getElementById("reqprov").value;
    location.hash = `#/requests?status=${encodeURIComponent(s)}&provider=${encodeURIComponent(p)}`;
  };
}

/* ---------------- settings modal ---------------- */
async function openSettings() {
  const s = await api("GET", "/api/settings").catch(() => ({ defaultPolicy: "auto" }));
  const body = document.getElementById("settingsbody");
  body.innerHTML = `
    <h2 style="margin-top:0">Routing</h2>
    <form class="inline" id="savesettings">
      <label>Default policy<select name="defaultPolicy">${policyOptions(s.defaultPolicy)}</select></label>
      <button>Save</button>
    </form>
    <p class="muted">Runtime setting — a server restart resets it to DEFAULT_POLICY from .env.</p>
    <h2>Validation job</h2>
    <form class="inline" id="runvalidate">
      <label>Provider<input name="provider" size="14" placeholder="(all)"></label>
      <label>Limit<input name="limit" type="number" value="25" style="width:80px"></label>
      <button>Run</button>
    </form>
    <div id="valout"></div>
    <h2>Admin token</h2>
    <p class="muted">${getToken() ? "A token is stored in this browser (localStorage only)." : "No token stored."}</p>
    <div class="row">
      <button class="ghost" id="changetoken">Set / change token</button>
      <button class="ghost" id="forgettoken">Forget token</button>
    </div>`;
  openOverlay("settingswrap");
  document.getElementById("savesettings").onsubmit = async (e) => {
    e.preventDefault();
    const ns = await api("PATCH", "/api/settings", { defaultPolicy: String(new FormData(e.target).get("defaultPolicy")) });
    showToast("Default policy → " + ns.defaultPolicy);
    loadStatus();
  };
  document.getElementById("runvalidate").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = document.getElementById("valout");
    out.innerHTML = "<p class='muted'>Validating (staggered)…</p>";
    try {
      const r = await api("POST", "/api/maintenance/validate", {
        provider: String(f.get("provider")) || undefined, limit: Number(f.get("limit") || 25),
      });
      out.innerHTML = `<p>${pill(r.ok + "/" + r.checked + " valid", r.invalid ? "warn" : "ok")} ${pill(r.skippedFresh + " fresh-skipped", "dim")}</p>`;
    } catch (err) { out.innerHTML = `<p>${pill("job failed", "bad")} ${esc(err.message)}</p>`; }
  };
  document.getElementById("changetoken").onclick = () => {
    closeOverlay("settingswrap");
    openOverlay("tokenbar");
    document.getElementById("tokeninput").value = getToken();
    document.getElementById("tokeninput").focus();
  };
  document.getElementById("forgettoken").onclick = () => {
    localStorage.removeItem("router-admin-token");
    location.reload();
  };
}

loadStatus();
router();
