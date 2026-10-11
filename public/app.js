/**
 * API Router Dashboard — rebuilt UI.
 * Vanilla JS, zero dependencies, no build step (works offline / on LAN).
 * Pages: Overview, Playground, Resources, Providers & Keys, Quotas & Usage,
 * Requests. Settings lives in a modal.
 */

"use strict";

/* ============================================================
   Config
   ============================================================ */

const CFG = {
  CAPS: [
    "llm.chat",
    "llm.responses",
    "llm.tools",
    "llm.vision",
    "llm.embeddings",
    "web.search",
    "web.extract",
    "web.scrape",
    "web.crawl",
    "web.map",
  ],
  POLICIES: ["auto", "burn", "preserve", "fast", "reliable", "cheap", "priority"],
  TOOLS: ["search", "scrape", "extract", "crawl", "map"],
  TITLES: {
    "/overview": "Overview",
    "/playground": "Playground",
    "/resources": "Resources",
    "/providers": "Providers & Keys",
    "/quotas": "Quotas & Usage",
    "/requests": "Requests",
  },
};

/* ============================================================
   DOM refs + session state
   ============================================================ */

const D = {
  pc: document.getElementById("pageContent"),
  pt: document.getElementById("pageTitle"),
  sd: document.getElementById("sidebarStatusDot"),
  st: document.getElementById("sidebarStatusText"),
  td: document.getElementById("topbarStatusDot"),
  tt: document.getElementById("topbarStatusText"),
  pb: document.getElementById("policyBadge"),
  sm: document.getElementById("settingsModal"),
  sb: document.getElementById("settingsBody"),
  sc: document.getElementById("closeSettingsModal"),
  sbn: document.getElementById("sidebar"),
  ms: document.getElementById("mobileScrim"),
  mt: document.getElementById("menuToggle"),
  rb: document.getElementById("refreshBtn"),
  os: document.getElementById("openSettingsBtn"),
  toast: document.getElementById("toast"),
};

const S = {
  policy: "",
};

/* ============================================================
   Utilities (all user content goes through esc)
   ============================================================ */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c];
  });
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toISOString().slice(5, 19).replace("T", " ");
}

function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return esc(iso);
  if (ms < 0) return fmtTime(iso);
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

function fmtCountdown(iso) {
  if (!iso) return '<span class="text-muted">no reset</span>';
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return esc(iso);
  if (ms <= 0) return '<span class="text-muted">resetting…</span>';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return esc(d + "d " + h + "h");
  if (h > 0) return esc(h + "h " + m + "m");
  return esc(m + "m");
}

function shortResource(id) {
  return String(id ?? "").replace(/^llm:model:/, "");
}

function isFreeId(id) {
  return /free/i.test(String(id || ""));
}

function quotaPct(q) {
  if (!q || !(q.limitValue > 0)) return null;
  const remaining =
    q.remainingValue ?? Math.max(0, q.limitValue - (q.usedValue || 0));
  return Math.max(0, Math.min(100, Math.round((100 * remaining) / q.limitValue)));
}

function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

/* ============================================================
   Toast + modal + API client
   ============================================================ */

const Toast = {
  timer: 0,
  show(msg, kind, ms) {
    D.toast.textContent = msg;
    D.toast.className = "toast" + (kind ? " " + kind : "");
    D.toast.classList.remove("hidden");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => D.toast.classList.add("hidden"), ms || 3500);
  },
  ok(msg, ms) {
    this.show(msg, "success", ms);
  },
  err(msg, ms) {
    this.show(msg, "error", ms || 5000);
  },
};

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  document.body.style.overflow = "";
}

const Api = {
  async req(method, path, body, retried) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && !retried) {
      const waitMs = Math.min(
        15000,
        (Number(res.headers.get("retry-after")) || 5) * 1000,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      return this.req(method, path, body, true);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || "HTTP " + res.status);
    return data.data;
  },
  get(p) {
    return this.req("GET", p);
  },
  post(p, b) {
    return this.req("POST", p, b);
  },
  patch(p, b) {
    return this.req("PATCH", p, b);
  },
  del(p) {
    return this.req("DELETE", p);
  },
};

/* ============================================================
   Health pill
   ============================================================ */

const Health = {
  async check() {
    try {
      await fetch("/healthz");
      let policy = "";
      try {
        const s = await Api.get("/api/settings");
        policy = s.defaultPolicy || "";
        S.policy = policy;
      } catch {
        /* settings fetch may fail; health itself is still fine */
      }
      this.set(true, "online" + (policy ? " · " + policy : ""));
      return true;
    } catch {
      this.set(false, "offline");
      return false;
    }
  },
  set(ok, text) {
    const cls = ok ? "" : "down";
    if (D.sd) D.sd.className = "status-dot " + cls;
    if (D.st) D.st.textContent = text;
    if (D.td) D.td.className = "status-dot " + cls;
    if (D.tt) D.tt.textContent = text;
    if (D.pb && S.policy) {
      D.pb.textContent = "Policy: " + S.policy;
      D.pb.className = "badge badge-primary";
    }
  },
};

/* ============================================================
   Shared components (return HTML strings; callers esc inputs)
   ============================================================ */

function pill(text, kind) {
  const map = {
    success: "ok",
    active: "ok",
    enabled: "ok",
    healthy: "ok",
    on: "ok",
    valid: "ok",
    invalid: "bad",
    error: "bad",
    failed: "bad",
    disabled: "warn",
    off: "warn",
    cooldown: "warn",
    degraded: "warn",
  };
  const cls = map[kind || ""] || kind || "dim";
  return '<span class="status-pill ' + cls + '">' + esc(text) + "</span>";
}

function badge(text, kind) {
  return (
    '<span class="badge badge-' +
    (kind || "secondary") +
    '">' +
    esc(text) +
    "</span>"
  );
}

function quotaBar(q) {
  if (!q) return '<span class="text-muted">unknown</span>';
  const p = quotaPct(q);
  if (p === null) return '<span class="text-muted">—</span>';
  const cls = p < 10 ? "crit" : p < 25 ? "low" : "ok";
  return (
    '<span class="quota-bar"><span class="bar ' +
    cls +
    '" title="' +
    esc(q.usedValue) +
    "/" +
    esc(q.limitValue) +
    " " +
    esc(q.metric) +
    '"><i style="width:' +
    p +
    '%"></i></span> <span class="text-muted">' +
    p +
    "%</span></span>"
  );
}

function healthBadge(h) {
  if (!h) return '<span class="text-muted">—</span>';
  if (h.cooldownUntil && Date.parse(h.cooldownUntil) > Date.now()) {
    return pill(
      "cooldown" + (h.lastErrorClass ? " · " + h.lastErrorClass : ""),
      "bad",
    );
  }
  if (h.consecutiveFailures) return pill(h.consecutiveFailures + " fails", "warn");
  return pill("healthy", "ok");
}

function emptyState(msg) {
  return '<div class="empty-state"><p>' + esc(msg) + "</p></div>";
}

function skeleton() {
  return (
    "<h1>&nbsp;</h1>" +
    '<div class="skeleton skeleton-title"></div>' +
    '<div class="skeleton skeleton-text" style="width:80%"></div>' +
    '<div class="skeleton skeleton-text" style="width:60%"></div>' +
    '<div class="skeleton skeleton-text" style="width:70%"></div>'
  );
}

function copyBtn(value, label) {
  return (
    '<button class="copy-btn" data-copy="' +
    esc(value) +
    '" title="Copy">' +
    esc(label || "copy") +
    "</button>"
  );
}

function policyOptions(selected) {
  return CFG.POLICIES.map((p) => {
    return (
      '<option value="' + p + '"' + (p === selected ? " selected" : "") + ">" + p + "</option>"
    );
  }).join("");
}

function requestRows(logs) {
  return logs
    .map((x) => {
      const name = esc(shortResource(x.requestedResourceId) || x.capability || "");
      const route = x.selectedProviderId
        ? esc(x.selectedProviderId + "/" + (x.selectedUpstreamId || ""))
        : "—";
      return (
        "<tr>" +
        '<td class="cell-muted">' +
        esc(fmtAgo(x.createdAt)) +
        "</td>" +
        '<td><a class="mono" href="#/requests?id=' +
        encodeURIComponent(x.id) +
        '">' +
        name +
        "</a></td>" +
        '<td class="cell-mono cell-muted">' +
        route +
        "</td>" +
        '<td class="cell-mono" title="' +
        esc(x.selectedCredentialId || "") +
        '">' +
        (x.selectedCredentialId ? esc(x.selectedCredentialId) : "—") +
        "</td>" +
        "<td>" +
        esc(x.policy || "") +
        "</td>" +
        "<td>" +
        pill(x.status, x.status) +
        "</td>" +
        '<td class="cell-numeric">' +
        (x.attempts ?? "—") +
        "</td>" +
        '<td class="cell-numeric">' +
        (x.totalTokens ?? "—") +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

function requestTable(logs, emptyMsg) {
  if (!logs.length) return emptyState(emptyMsg || "No requests yet.");
  return (
    '<div class="table-container"><table class="table"><thead><tr>' +
    "<th>Time</th><th>Resource</th><th>Route</th><th>API key</th><th>Policy</th>" +
    "<th>Status</th><th>Attempts</th><th>Tokens</th>" +
    "</tr></thead><tbody>" +
    requestRows(logs) +
    "</tbody></table></div>"
  );
}

/* ============================================================
   Pages (defined before the router — no TDZ)
   ============================================================ */

async function renderOverview() {
  const [o, recent, providers, accounts, creds, mappings] = await Promise.all([
    Api.get("/api/overview"),
    Api.get("/api/requests?limit=120"),
    Api.get("/api/providers"),
    Api.get("/api/accounts"),
    Api.get("/api/credentials"),
    Api.get("/api/provider-resources"),
  ]);
  const buckets = new Array(24).fill(0);
  const errors = new Array(24).fill(0);
  const now = Date.now();
  recent.forEach((l) => {
    const h = Math.floor((now - Date.parse(l.createdAt)) / 3600000);
    if (h >= 0 && h < 24) {
      buckets[23 - h] += 1;
      if (l.status !== "success") errors[23 - h] += 1;
    }
  });
  const max = Math.max(1, ...buckets);
  const st = o.credentialsByStatus || { active: 0, disabled: 0, invalid: 0 };
  const okRate =
    o.successRate24h != null ? Math.round(o.successRate24h * 100) + "% ok" : "—";

  const cards = [
    {
      href: "#/providers",
      value: esc(o.providers),
      label: "Providers",
      trend: esc(o.providersEnabled) + " enabled",
    },
    { href: "#/providers", value: esc(o.accounts), label: "Accounts", trend: "" },
    {
      href: "#/providers",
      value: esc(o.credentials),
      label: "Credentials",
      trend:
        '<span class="status-pill ok">● ' +
        st.active +
        '</span> <span class="status-pill warn">● ' +
        st.disabled +
        '</span> <span class="status-pill bad">● ' +
        st.invalid +
        "</span>",
      raw: true,
    },
    {
      href: "#/resources",
      value: esc(o.resources),
      label: "Canonical Resources",
      trend: "",
    },
    {
      href: "#/resources",
      value: esc(o.mappings),
      label: "Provider Mappings",
      trend: "",
    },
    {
      href: "#/requests",
      value: esc(o.requests24h),
      label: "Requests / 24h",
      trend: esc(okRate),
    },
    {
      href: "#/quotas",
      value: esc(fmtNum(o.tokens24h)),
      label: "Tokens / 24h",
      trend: "",
      small: true,
    },
  ];

  const bars = buckets
    .map((b, i) => {
      const h = Math.max(3, Math.round((100 * b) / max));
      const cls = errors[i] && b ? "danger" : "success";
      return (
        '<div class="histogram-bar ' +
        cls +
        '" style="height:' +
        h +
        '%" title="' +
        b +
        " requests, " +
        errors[i] +
        ' failed"></div>'
      );
    })
    .join("");

  const provRows = providers
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => {
      const nAcct = accounts.filter((a) => a.providerId === p.id).length;
      const nCred = creds.filter((c) => c.providerId === p.id).length;
      const nModel = mappings.filter((m) => m.providerId === p.id).length;
      return (
        "<tr><td><a href=\"#/providers?id=" +
        esc(p.id) +
        '"><strong>' +
        esc(p.id) +
        "</strong></a><br>" +
        '<span class="text-muted">' +
        esc(p.displayName || "") +
        "</span></td>" +
        '<td class="cell-mono cell-muted">' +
        esc(p.baseUrl || "—") +
        "</td>" +
        '<td class="cell-numeric">' +
        nModel +
        '</td><td class="cell-numeric">' +
        nAcct +
        '</td><td class="cell-numeric">' +
        nCred +
        "</td><td>" +
        pill(p.enabled ? "enabled" : "disabled", p.enabled ? "ok" : "warn") +
        "</td></tr>"
      );
    })
    .join("");

  D.pc.innerHTML =
    '<div class="section"><h1>Overview</h1>' +
    '<p class="subtitle">Live state of the router.</p>' +
    '<div class="cards">' +
    cards
      .map((c) => {
        return (
          '<a class="card card-link" href="' +
          c.href +
          '"><div class="card-value' +
          (c.small ? " small" : "") +
          '">' +
          c.value +
          '</div><div class="card-label">' +
          c.label +
          "</div>" +
          (c.trend ? '<div class="card-trend">' + c.trend + "</div>" : "") +
          "</a>"
        );
      })
      .join("") +
    "</div></div>" +
    '<div class="section"><h2 class="section-title">Requests — last 24h</h2>' +
    '<div class="histogram">' +
    bars +
    "</div></div>" +
    '<div class="section"><h2 class="section-title">Recent requests</h2>' +
    requestTable(recent.slice(0, 12)) +
    "</div>" +
    '<div class="section"><h2 class="section-title">Providers</h2>' +
    '<div class="table-container"><table class="table"><thead><tr>' +
    "<th>Provider</th><th>Base URL</th><th>Models</th>" +
    "<th>Accounts</th><th>Keys</th><th>State</th>" +
    "</tr></thead><tbody>" +
    provRows +
    "</tbody></table></div></div>";
}

/* ---------- Playground ---------- */

async function renderPlayground(q) {
  const settings = await Api.get("/api/settings").catch(() => ({
    defaultPolicy: "auto",
  }));
  const tab = CFG.TOOLS.includes(q.get("tab")) ? q.get("tab") : "chat";
  const tabs = ["chat"].concat(CFG.TOOLS).map((c) => {
    return (
      '<button data-tab="' +
      c +
      '" class="tab' +
      (tab === c ? " active" : "") +
      '">' +
      c +
      "</button>"
    );
  });
  D.pc.innerHTML =
    '<div class="section"><h1>Playground</h1>' +
    '<p class="subtitle">Send real requests through the routing core.</p>' +
    '<div class="tabs">' +
    tabs.join("") +
    '</div><div id="tabBody"></div></div>';
  D.pc.querySelectorAll("[data-tab]").forEach((b) => {
    b.addEventListener("click", () => {
      const name = b.getAttribute("data-tab");
      location.hash =
        name === "chat" ? "#/playground" : "#/playground?tab=" + name;
    });
  });
  if (tab === "chat") renderChatTab(settings.defaultPolicy);
  else renderToolTab(tab);
}

function renderChatTab(defaultPolicy) {
  const el = document.getElementById("tabBody");
  el.innerHTML =
    '<form id="chatForm" class="panel">' +
    '<div class="field-group"><label for="chatModel">Model</label>' +
    '<input id="chatModel" name="model" required value="deepseek-r1-distill-qwen-32b:free"></div>' +
    '<div class="grid grid-2 chat-opts">' +
    '<div class="field-group"><label for="chatProvider">Provider pin</label>' +
    '<input id="chatProvider" name="provider" placeholder="groq"></div>' +
    '<div class="field-group"><label for="chatPolicy">Policy</label>' +
    '<select id="chatPolicy" name="policy"><option value="">(default)</option>' +
    policyOptions("") +
    "</select></div></div>" +
    '<div class="field-group check-row"><label><input type="checkbox" name="stream"> Stream (SSE)</label></div>' +
    '<div class="field-group"><label for="chatMsg">Message</label>' +
    '<textarea id="chatMsg" name="message" rows="3">Reply with exactly: router alive</textarea></div>' +
    '<div class="form-actions"><button type="submit" class="btn btn-primary">Send</button></div>' +
    '<p class="text-muted">default policy: ' +
    esc(defaultPolicy || "auto") +
    "</p></form>" +
    '<div id="chatOut" class="playout"></div>';
  document
    .getElementById("chatForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const out = document.getElementById("chatOut");
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
      if (f.get("stream")) {
        streamChat(payload, out, t0);
        return;
      }
      out.innerHTML = "<p class='text-muted'>Sending…</p>";
      try {
        const res = await fetch("/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok)
          throw new Error(json?.error?.message || "HTTP " + res.status);
        const content =
          json.choices?.[0]?.message?.content ?? JSON.stringify(json, null, 2);
        out.innerHTML =
          "<p>" +
          badge("via " + res.headers.get("x-router-via"), "success") +
          " " +
          badge(
            "policy " + res.headers.get("x-router-policy"),
            "secondary",
          ) +
          " " +
          badge(
            res.headers.get("x-router-attempts") + " attempt(s)",
            "secondary",
          ) +
          " " +
          badge(Date.now() - t0 + "ms", "secondary") +
          "</p>" +
          '<pre class="dump">' +
          esc(content) +
          "</pre>" +
          '<p class="text-muted mono">usage: ' +
          esc(JSON.stringify(json.usage || {})) +
          "</p>";
      } catch (err) {
        out.innerHTML =
          "<p>" + pill("failed", "bad") + " " + esc(err.message) + "</p>";
      }
    });
}

async function streamChat(payload, out, t0) {
  payload.stream = true;
  out.innerHTML =
    '<div class="stream-output" id="live"></div><p class="text-muted" id="liveMeta">connecting…</p>';
  const live = document.getElementById("live");
  const meta = document.getElementById("liveMeta");
  try {
    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message || "HTTP " + res.status);
    }
    const via = res.headers.get("x-router-via");
    const attempts = res.headers.get("x-router-attempts");
    meta.textContent =
      "via " + via + " · " + attempts + " attempt(s) · streaming…";
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buf += dec.decode(part.value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() || "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const chunk = t.slice(5).trim();
          if (chunk === "[DONE]") continue;
          try {
            const j = JSON.parse(chunk);
            const d = j.choices?.[0]?.delta?.content || "";
            if (d) {
              text += d;
              live.textContent = text;
            }
          } catch {
            /* partial frame */
          }
        }
      }
    }
    meta.textContent =
      "via " + via + " · " + attempts + " attempt(s) · done in " + (Date.now() - t0) + "ms";
  } catch (err) {
    meta.textContent = "failed: " + err.message;
  }
}

function toolFields(cap) {
  if (cap === "search") {
    return (
      '<div class="grid grid-2 chat-opts"><div class="field-group"><label>Query</label>' +
      '<input name="query" required placeholder="latest news"></div>' +
      '<div class="field-group"><label>Max results</label>' +
      '<input name="maxResults" type="number" value="5" class="narrow"></div></div>'
    );
  }
  if (cap === "scrape") {
    return (
      '<div class="field-group"><label>URL</label>' +
      '<input name="url" required size="50" placeholder="https://example.com"></div>' +
      '<div class="field-group"><label>Max chars</label>' +
      '<input name="maxChars" type="number" value="8000" class="narrow"></div>'
    );
  }
  if (cap === "extract") {
    return (
      '<div class="field-group"><label>URLs (one per line)</label>' +
      '<textarea name="urls" rows="3" placeholder="https://example.com"></textarea></div>' +
      '<div class="field-group"><label>Query</label>' +
      '<input name="query" placeholder="what is this about?"></div>'
    );
  }
  if (cap === "crawl") {
    return (
      '<div class="field-group"><label>URL</label>' +
      '<input name="url" required size="50" placeholder="https://example.com"></div>' +
      '<div class="field-group"><label>Page limit</label>' +
      '<input name="limit" type="number" value="10" class="narrow"></div>'
    );
  }
  return (
    '<div class="field-group"><label>URL</label>' +
    '<input name="url" required size="50" placeholder="https://example.com"></div>' +
    '<div class="field-group"><label>Link limit</label>' +
    '<input name="limit" type="number" value="50" class="narrow"></div>'
  );
}

function renderToolTab(cap) {
  const el = document.getElementById("tabBody");
  el.innerHTML =
    '<form id="toolForm" class="panel">' +
    toolFields(cap) +
    '<div class="grid grid-2 chat-opts"><div class="field-group"><label>Provider pin</label>' +
    '<input name="provider" placeholder="(none)"></div>' +
    '<div class="field-group"><label>Policy</label>' +
    '<select name="policy"><option value="">(default)</option>' +
    policyOptions("") +
    "</select></div></div>" +
    '<div class="form-actions"><button type="submit" class="btn btn-primary">Run ' +
    esc(cap) +
    "</button></div></form>" +
    '<div id="toolOut" class="playout"></div>';
  document
    .getElementById("toolForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const out = document.getElementById("toolOut");
      const payload = {};
      if (cap === "search") {
        payload.query = String(f.get("query"));
        payload.maxResults = Number(f.get("maxResults") || 5);
      } else if (cap === "scrape") {
        payload.url = String(f.get("url"));
        if (f.get("maxChars")) payload.maxChars = Number(f.get("maxChars"));
      } else if (cap === "extract") {
        payload.urls = String(f.get("urls"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20);
        if (f.get("query")) payload.query = String(f.get("query"));
      } else {
        payload.url = String(f.get("url"));
        if (f.get("limit")) payload.limit = Number(f.get("limit"));
      }
      const routing = {};
      if (f.get("provider")) routing.provider = String(f.get("provider"));
      if (f.get("policy")) routing.policy = String(f.get("policy"));
      if (Object.keys(routing).length) payload.routing = routing;
      out.innerHTML = "<p class='text-muted'>Running…</p>";
      try {
        const res = await fetch("/v1/tools/" + cap, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok)
          throw new Error(json?.error?.message || "HTTP " + res.status);
        out.innerHTML =
          "<p>" +
          badge("via " + res.headers.get("x-router-via"), "success") +
          " " +
          badge(
            res.headers.get("x-router-attempts") + " attempt(s)",
            "secondary",
          ) +
          "</p>" +
          toolResultHtml(cap, json);
      } catch (err) {
        out.innerHTML =
          "<p>" + pill("failed", "bad") + " " + esc(err.message) + "</p>";
      }
    });
}

function toolResultHtml(cap, json) {
  if (cap === "search") {
    if (!json.results || !json.results.length)
      return '<pre class="dump">' + esc(JSON.stringify(json, null, 2)) + "</pre>";
    return json.results
      .map((r) => {
        return (
          '<div class="search-result"><div class="search-result-title">' +
          esc(r.title || r.url) +
          '</div><div class="search-result-url">' +
          esc(r.url) +
          '</div><div class="search-result-snippet">' +
          esc((r.snippet || r.markdown || "").slice(0, 400)) +
          "</div></div>"
        );
      })
      .join("");
  }
  if (cap === "scrape") {
    return (
      '<pre class="dump">' +
      esc(json.markdown || JSON.stringify(json, null, 2)) +
      "</pre>"
    );
  }
  if (cap === "extract") {
    return (json.results || [])
      .map((r) => {
        const body = r.error
          ? "<div>" + pill("error: " + r.error, "bad") + "</div>"
          : '<div class="search-result-snippet">' +
            esc((r.content || "").slice(0, 500)) +
            "</div>";
        return (
          '<div class="search-result"><div class="search-result-title">' +
          esc(r.title || r.url) +
          '</div><div class="search-result-url">' +
          esc(r.url) +
          "</div>" +
          body +
          "</div>"
        );
      })
      .join("");
  }
  if (cap === "crawl") {
    if (!json.pages || !json.pages.length)
      return '<pre class="dump">' + esc(JSON.stringify(json, null, 2)) + "</pre>";
    return json.pages
      .map((p) => {
        return (
          '<div class="search-result"><div class="search-result-title">' +
          esc(p.title || p.url) +
          '</div><div class="search-result-url">' +
          esc(p.url) +
          '</div><div class="search-result-snippet">' +
          esc((p.markdown || "").slice(0, 300)) +
          "</div></div>"
        );
      })
      .join("");
  }
  const links = json.links || [];
  return (
    '<div class="panel"><h3>' +
    links.length +
    " links</h3>" +
    links
      .map((l) => {
        return (
          '<div class="mono link-row">' + esc(l.url || l) + "</div>"
        );
      })
      .join("") +
    "</div>"
  );
}

/* ---------- Resources ---------- */

async function renderResourcesByProvider(q) {
  const [providers, mappings] = await Promise.all([
    Api.get("/api/providers"),
    Api.get("/api/provider-resources"),
  ]);
  const needle = (q.get("q") || "").toLowerCase();
  const capFilter = q.get("cap") || "";
  const freeOnly = q.get("free") === "1";
  const byProv = {};
  mappings.forEach((m) => {
    if (capFilter && !(m.capabilities || []).includes(capFilter)) return;
    if (freeOnly && !isFreeId(m.upstreamId)) return;
    if (needle) {
      const hay = (
        m.upstreamId +
        " " +
        m.resourceId +
        " " +
        m.providerId
      ).toLowerCase();
      if (!hay.includes(needle)) return;
    }
    (byProv[m.providerId] = byProv[m.providerId] || []).push(m);
  });
  const capOpts = CFG.CAPS.map((c) => {
    return (
      '<option value="' +
      c +
      '"' +
      (c === capFilter ? " selected" : "") +
      ">" +
      c +
      "</option>"
    );
  }).join("");
  const groups = providers
    .filter((p) => byProv[p.id] && byProv[p.id].length)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => {
      const ms = byProv[p.id]
        .slice()
        .sort((a, b) => a.upstreamId.localeCompare(b.upstreamId));
      const freeN = ms.filter((m) => isFreeId(m.upstreamId)).length;
      const rows = ms
        .slice(0, 200)
        .map((m) => {
          const pin = m.providerId + "::" + m.upstreamId;
          return (
            "<tr><td class=\"cell-mono\">" +
            esc(m.upstreamId) +
            (isFreeId(m.upstreamId) ? " " + pill("free", "ok") : "") +
            "</td><td><a class=\"mono\" href=\"#/resources?id=" +
            encodeURIComponent(m.resourceId) +
            '">' +
            esc(shortResource(m.resourceId)) +
            "</a></td>" +
            '<td class="cell-mono cell-muted">' +
            esc(pin) +
            copyBtn(pin, "Copy") +
            "</td><td>" +
            (m.enabled ? pill("enabled", "ok") : pill("disabled", "warn")) +
            "</td></tr>"
          );
        })
        .join("");
      return (
        '<div class="panel"><div class="panel-header"><h3 class="panel-title">' +
        esc(p.id) +
        ' <span class="text-muted">' +
        esc(p.displayName || "") +
        "</span></h3><div>" +
        badge(ms.length + " models", "secondary") +
        " " +
        badge(freeN + " free", "success") +
        "</div></div>" +
        '<div class="table-container"><table class="table"><thead><tr>' +
        "<th>Provider model</th><th>Canonical</th><th>Use as</th><th>State</th>" +
        "</tr></thead><tbody>" +
        rows +
        "</tbody></table></div>" +
        (ms.length > 200
          ? '<p class="text-muted">showing 200 of ' + ms.length + "</p>"
          : "") +
        "</div>"
      );
    })
    .join("");
  D.pc.innerHTML =
    '<div class="section"><h1>Resources ' +
    '<span class="text-muted">(' +
    mappings.length +
    " mappings)</span></h1>" +
    '<p class="subtitle">Provider models — what each provider serves.</p>' +
    '<div class="tabs"><button class="tab active" data-view="provider">By provider</button>' +
    '<button class="tab" data-view="canonical">Canonical</button></div>' +
    '<form class="inline-form" id="resFilter"><label>Search' +
    '<input id="resQ" value="' +
    esc(q.get("q") || "") +
    '" placeholder="nemotron…"></label>' +
    '<label>Capability<select id="resCap"><option value="">all</option>' +
    capOpts +
    '</select></label><label class="check-row"><input type="checkbox" id="resFree"' +
    (q.get("free") === "1" ? " checked" : "") +
    "> free only</label>" +
    '<button type="submit" class="btn btn-secondary">Filter</button></form>' +
    (groups || emptyState("No provider models match.")) +
    "</div>";
  document.getElementById("resFilter").addEventListener("submit", (e) => {
    e.preventDefault();
    const qq = document.getElementById("resQ").value;
    const cc = document.getElementById("resCap").value;
    const ff = document.getElementById("resFree").checked;
    location.hash =
      "#/resources?view=provider&q=" +
      encodeURIComponent(qq) +
      (cc ? "&cap=" + encodeURIComponent(cc) : "") +
      (ff ? "&free=1" : "");
  });
  D.pc.querySelectorAll("[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      const v = b.getAttribute("data-view");
      const params = new URLSearchParams(location.hash.split("?")[1] || "");
      params.set("view", v);
      location.hash = "#/resources?" + params.toString();
    });
  });
}

async function renderResources(q) {
  const id = q.get("id");
  if (id) {
    renderResourceDetail(id, q.get("cap") || "llm.chat");
    return;
  }
  const view = q.get("view") || "provider";
  if (view === "provider") {
    renderResourcesByProvider(q);
    return;
  }
  const all = await Api.get("/api/resources");
  const needle = (q.get("q") || "").toLowerCase();
  const capFilter = q.get("cap") || "";
  const freeOnly = q.get("free") === "1";
  const list = all.filter((x) => {
    const hit =
      !needle ||
      x.id.toLowerCase().includes(needle) ||
      (x.displayName || "").toLowerCase().includes(needle);
    return (
      hit &&
      (!capFilter || (x.capabilities || []).includes(capFilter)) &&
      (!freeOnly || isFreeId(x.id))
    );
  });
  let counts = {};
  try {
    counts = await Api.get(
      "/api/routes/counts" +
        (capFilter ? "?capability=" + encodeURIComponent(capFilter) : ""),
    );
  } catch {
    counts = {};
  }
  const rows = list
    .slice(0, 300)
    .map((x) => {
      const n = counts[x.id];
      return (
        "<tr><td><a class=\"mono\" href=\"#/resources?id=" +
        encodeURIComponent(x.id) +
        '">' +
        esc(shortResource(x.id)) +
        "</a>" +
        (isFreeId(x.id) ? " " + pill("free", "ok") : "") +
        "</td><td>" +
        esc(x.kind) +
        '</td><td class="cell-mono cell-muted">' +
        esc((x.capabilities || []).join(" · ")) +
        '</td><td class="cell-numeric">' +
        (n ?? '<span class="text-muted">—</span>') +
        "</td></tr>"
      );
    })
    .join("");
  const capOpts = CFG.CAPS.map((c) => {
    return (
      '<option value="' +
      c +
      '"' +
      (c === capFilter ? " selected" : "") +
      ">" +
      c +
      "</option>"
    );
  }).join("");
  D.pc.innerHTML =
    '<div class="section"><h1>Resources ' +
    '<span class="text-muted">(' +
    all.length +
    ")</span></h1>" +
    '<p class="subtitle">Canonical resources — what clients ask for.</p>' +
    '<div class="tabs"><button class="tab" data-view="provider">By provider</button>' +
    '<button class="tab active" data-view="canonical">Canonical</button></div>' +
    '<form class="inline-form" id="resFilter"><label>Search' +
    '<input id="resQ" value="' +
    esc(q.get("q") || "") +
    '" placeholder="nemotron…"></label>' +
    '<label>Capability<select id="resCap"><option value="">all</option>' +
    capOpts +
    '</select></label><label class="check-row"><input type="checkbox" id="resFree"' +
    (q.get("free") === "1" ? " checked" : "") +
    "> free only</label>" +
    '<button type="submit" class="btn btn-secondary">Filter</button></form>' +
    (rows
      ? '<div class="table-container"><table class="table"><thead><tr>' +
        "<th>Canonical ID</th><th>Kind</th><th>Capabilities</th><th>Routes</th>" +
        "</tr></thead><tbody>" +
        rows +
        "</tbody></table></div>"
      : emptyState("No resources match.")) +
    (list.length > 300
      ? '<p class="text-muted">showing 300 of ' + list.length + "</p>"
      : "") +
    '<div class="section"><h2 class="section-title">Add canonical resource</h2>' +
    '<form class="inline-form" id="addRes"><label>ID' +
    '<input name="id" required placeholder="llm:model:my-model" size="30"></label>' +
    "<label>Display name<input name=\"displayName\" required></label>" +
    '<label>Kind<select name="kind"><option value="llm_model">llm_model</option>' +
    '<option value="capability">capability</option></select></label>' +
    '<button type="submit" class="btn btn-primary">Add</button></form></div></div>';
  document.getElementById("resFilter").addEventListener("submit", (e) => {
    e.preventDefault();
    const qq = document.getElementById("resQ").value;
    const cc = document.getElementById("resCap").value;
    const ff = document.getElementById("resFree").checked;
    location.hash =
      "#/resources?view=canonical&q=" +
      encodeURIComponent(qq) +
      (cc ? "&cap=" + encodeURIComponent(cc) : "") +
      (ff ? "&free=1" : "");
  });
  D.pc.querySelectorAll("[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      const v = b.getAttribute("data-view");
      const params = new URLSearchParams(location.hash.split("?")[1] || "");
      params.set("view", v);
      location.hash = "#/resources?" + params.toString();
    });
  });
  document.getElementById("addRes").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await Api.post("/api/resources", {
      id: String(f.get("id")),
      displayName: String(f.get("displayName")),
      kind: String(f.get("kind")),
      capabilities: ["llm.chat"],
    });
    Toast.ok("Resource added");
    Router.navigate();
  });
}

async function renderResourceDetail(id, cap) {
  const [mappings, providers] = await Promise.all([
    Api.get("/api/provider-resources?resource=" + encodeURIComponent(id)),
    Api.get("/api/providers"),
  ]);
  const caps = [...new Set(mappings.flatMap((x) => x.capabilities || []))];
  if (!caps.includes(cap)) cap = caps[0] || "llm.chat";
  const routes = await Api.get(
    "/api/routes?resource=" +
      encodeURIComponent(id) +
      "&capability=" +
      encodeURIComponent(cap),
  );
  const byMapping = {};
  routes.forEach((r) => {
    (byMapping[r.providerResourceId] =
      byMapping[r.providerResourceId] || []).push(r);
  });
  const capOpts = caps
    .map((c) => {
      return (
        '<option value="' +
        esc(c) +
        '"' +
        (c === cap ? " selected" : "") +
        ">" +
        esc(c) +
        "</option>"
      );
    })
    .join("");
  const provOpts = providers
    .map((p) => "<option>" + esc(p.id) + "</option>")
    .join("");
  const blocks = mappings
    .map((m) => {
      const rs = (byMapping[m.id] || []).filter((r) => r.credentialId);
      const rows = rs
        .map((r) => {
          const qq = (r.quotas || [])[0];
          return (
            "<tr>" +
            '<td class="cell-mono">' +
            esc(r.accountId) +
            "</td>" +
            '<td class="cell-mono">' +
            esc(r.credentialId) +
            "</td>" +
            "<td>" +
            quotaBar(qq) +
            '<div class="text-muted mono tiny">' +
            (qq ? esc(qq.metric) : "") +
            "</div></td>" +
            "<td>" +
            (qq ? fmtCountdown(qq.resetAt) : "—") +
            "</td>" +
            "<td>" +
            healthBadge(r.health) +
            "</td>" +
            '<td class="cell-numeric">' +
            (r.health?.latencyEmaMs != null
              ? Math.round(r.health.latencyEmaMs) + "ms"
              : "—") +
            "</td></tr>"
          );
        })
        .join("");
      return (
        '<div class="panel"><div class="panel-header"><h3 class="panel-title">' +
        esc(m.providerId) +
        ' → <span class="mono">' +
        esc(m.upstreamId) +
        "</span> " +
        (isFreeId(m.upstreamId) ? pill("free", "ok") + " " : "") +
        (m.enabled ? pill("enabled", "ok") : pill("disabled", "warn")) +
        " " +
        copyBtn(m.providerId + "::" + m.upstreamId, "Copy pin") +
        '</h3><div class="row tight">' +
        '<button class="toggle-btn ' +
        (m.enabled ? "disable" : "enable") +
        '" data-mapping="' +
        esc(m.id) +
        '" data-to="' +
        (m.enabled ? "false" : "true") +
        '">' +
        (m.enabled ? "Disable" : "Enable") +
        "</button>" +
        '<button class="btn btn-danger btn-small" data-delmapping="' +
        esc(m.id) +
        '">Delete mapping</button></div></div>' +
        (rows
          ? '<div class="table-container"><table class="table"><thead><tr>' +
            "<th>Account</th><th>Credential</th><th>Quota</th>" +
            "<th>Reset in</th><th>Health</th><th>Latency</th>" +
            "</tr></thead><tbody>" +
            rows +
            "</tbody></table></div>"
          : "<p class='text-muted'>No credentials — add keys to create routes.</p>") +
        "</div>"
      );
    })
    .join("");

  D.pc.innerHTML =
    '<div class="section"><h1 class="mono">' +
    esc(shortResource(id)) +
    (isFreeId(id) ? " " + pill("free", "ok") : "") +
    "</h1>" +
    '<p class="subtitle">' +
    esc(id) +
    " · " +
    routes.length +
    ' executable routes · <span class="mono">' +
    esc(cap) +
    "</span></p>" +
    '<div class="row gap"><button class="btn btn-ghost btn-small" id="backRes">← all resources</button>' +
    '<select id="detailCap" class="btn btn-secondary btn-small">' +
    capOpts +
    "</select>" +
    '<button class="btn btn-danger btn-small" id="delRes">Delete</button></div>' +
    blocks +
    '<div class="section"><h2 class="section-title">Add provider mapping</h2>' +
    '<form class="inline-form" id="addMap"><label>Provider<select name="providerId">' +
    provOpts +
    '</select></label><label>Upstream ID' +
    '<input name="upstreamId" required size="28" placeholder="vendor/model-id"></label>' +
    '<button type="submit" class="btn btn-primary">Map</button></form></div>' +
    '<div class="section"><h2 class="section-title">Simulate routing</h2>' +
    '<form class="inline-form" id="simForm"><label>Policy<select name="policy">' +
    policyOptions("burn") +
    '</select></label><label>Provider pin<input name="provider" size="12" placeholder="(none)"></label>' +
    '<button type="submit" class="btn btn-secondary">Rank</button></form>' +
    '<div id="simOut"></div></div></div>';

  document.getElementById("backRes").addEventListener("click", () => {
    location.hash = "#/resources";
  });
  document.getElementById("detailCap").addEventListener("change", (e) => {
    location.hash =
      "#/resources?id=" +
      encodeURIComponent(id) +
      "&cap=" +
      encodeURIComponent(e.target.value);
  });
  document.getElementById("delRes").addEventListener("click", async () => {
    if (!window.confirm("Delete " + id + "?")) return;
    await Api.del("/api/resources/" + encodeURIComponent(id));
    Toast.ok("Deleted");
    location.hash = "#/resources";
  });
  D.pc.querySelectorAll("[data-mapping]").forEach((b) => {
    b.addEventListener("click", async () => {
      await Api.patch(
        "/api/provider-resources/" + encodeURIComponent(b.getAttribute("data-mapping")),
        { enabled: b.getAttribute("data-to") === "true" },
      );
      Toast.ok(
        "Mapping " + (b.getAttribute("data-to") === "true" ? "enabled" : "disabled"),
      );
      Router.navigate();
    });
  });
  D.pc.querySelectorAll("[data-delmapping]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!window.confirm("Delete mapping?")) return;
      await Api.del(
        "/api/provider-resources/" + encodeURIComponent(b.getAttribute("data-delmapping")),
      );
      Toast.ok("Deleted");
      Router.navigate();
    });
  });
  document.getElementById("addMap").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await Api.post("/api/provider-resources", {
      resourceId: id,
      providerId: String(f.get("providerId")),
      upstreamId: String(f.get("upstreamId")),
      capabilities: [cap],
    });
    Toast.ok("Mapping added");
    Router.navigate();
  });
  document.getElementById("simForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = document.getElementById("simOut");
    out.innerHTML = "<p class='text-muted'>Ranking…</p>";
    const d = await Api.post("/api/routing/simulate", {
      resource: id,
      capability: cap,
      policy: String(f.get("policy")),
      provider: String(f.get("provider")) || undefined,
    });
    const elig = d.eligible
      .slice(0, 25)
      .map((r, i) => {
        return (
          "<tr>" +
          '<td class="cell-numeric">' +
          (i + 1) +
          "</td>" +
          '<td class="cell-mono">' +
          esc(r.provider) +
          " / " +
          esc(r.account) +
          '<br><span class="text-muted">' +
          esc(r.upstream) +
          "</span></td>" +
          '<td class="cell-numeric">' +
          Number(r.score).toFixed(3) +
          "</td>" +
          "<td>" +
          esc(r.reason) +
          "</td></tr>"
        );
      })
      .join("");
    const filt = d.filtered
      .slice(0, 25)
      .map((r) => {
        return (
          "<tr>" +
          '<td class="cell-mono">' +
          esc(r.provider) +
          " / " +
          esc(r.account) +
          "</td>" +
          "<td>" +
          esc(r.reason) +
          "</td></tr>"
        );
      })
      .join("");
    out.innerHTML =
      '<h2 class="section-title">Eligible (' +
      d.eligible.length +
      ')</h2><div class="table-container"><table class="table"><thead><tr>' +
      "<th>#</th><th>Route</th><th>Score</th><th>Reason</th>" +
      "</tr></thead><tbody>" +
      elig +
      "</tbody></table></div>" +
      (d.filtered.length
        ? '<h2 class="section-title">Filtered out (' +
          d.filtered.length +
          ')</h2><div class="table-container"><table class="table"><thead><tr>' +
          "<th>Route</th><th>Reason</th>" +
          "</tr></thead><tbody>" +
          filt +
          "</tbody></table></div>"
        : "");
  });
}

/* ---------- Providers & Keys ---------- */

async function renderProviders(q) {
  const id = q.get("id");
  if (id) {
    renderProviderDetail(id);
    return;
  }
  const providers = await Api.get("/api/providers");
  const needle = (q.get("q") || "").toLowerCase();
  const list = providers.filter(
    (x) =>
      !needle ||
      x.id.includes(needle) ||
      (x.displayName || "").toLowerCase().includes(needle),
  );
  const origin = location.origin;
  const rows = list
    .map((x) => {
      return (
        "<tr><td><a href=\"#/providers?id=" +
        esc(x.id) +
        '"><strong>' +
        esc(x.id) +
        "</strong></a><br>" +
        '<span class="text-muted">' +
        esc(x.displayName) +
        "</span></td>" +
        '<td class="cell-mono cell-muted">' +
        esc(x.baseUrl || "—") +
        "</td><td>" +
        pill(x.enabled ? "enabled" : "disabled", x.enabled ? "ok" : "warn") +
        '</td><td class="cell-numeric">' +
        x.priority +
        "</td><td>" +
        '<button class="toggle-btn ' +
        (x.enabled ? "disable" : "enable") +
        '" data-provider="' +
        esc(x.id) +
        '" data-to="' +
        (x.enabled ? "false" : "true") +
        '">' +
        (x.enabled ? "Disable" : "Enable") +
        "</button></td></tr>"
      );
    })
    .join("");
  D.pc.innerHTML =
    '<div class="section"><h1>Providers & Keys ' +
    '<span class="text-muted">(' +
    providers.length +
    ")</span></h1>" +
    '<p class="subtitle">Each upstream provider owns accounts and API keys.</p>' +
    '<div class="connect-banner"><h3>Client connection guide</h3>' +
    "<p>Point any OpenAI-compatible client at this router:</p>" +
    '<div class="connect-grid">' +
    '<div class="connect-box"><span class="connect-label">OpenAI base URL</span>' +
    '<div class="connect-val"><span class="mono">' +
    esc(origin + "/v1") +
    "</span>" +
    copyBtn(origin + "/v1", "Copy") +
    "</div></div>" +
    '<div class="connect-box"><span class="connect-label">Chat endpoint</span>' +
    '<div class="connect-val"><span class="mono">' +
    esc(origin + "/v1/chat/completions") +
    "</span>" +
    copyBtn(origin + "/v1/chat/completions", "Copy") +
    "</div></div></div></div>" +
    '<form class="inline-form" id="provFilter"><label>Search' +
    '<input id="provQ" value="' +
    esc(q.get("q") || "") +
    '" placeholder="groq…"></label>' +
    '<button type="submit" class="btn btn-secondary">Filter</button></form>' +
    '<div class="table-container"><table class="table"><thead><tr>' +
    "<th>Provider</th><th>Base URL</th><th>State</th><th>Priority</th><th></th>" +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table></div>" +
    (list.length ? "" : emptyState("No providers match.")) +
    "</div>";
  document.getElementById("provFilter").addEventListener("submit", (e) => {
    e.preventDefault();
    location.hash =
      "#/providers?q=" + encodeURIComponent(document.getElementById("provQ").value);
  });
  D.pc.querySelectorAll("[data-provider]").forEach((b) => {
    b.addEventListener("click", async () => {
      await Api.patch(
        "/api/providers/" + encodeURIComponent(b.getAttribute("data-provider")),
        { enabled: b.getAttribute("data-to") === "true" },
      );
      Toast.ok(
        "Provider " + (b.getAttribute("data-to") === "true" ? "enabled" : "disabled"),
      );
      Router.navigate();
    });
  });
}

function credentialRows(creds) {
  return creds
    .map((c) => {
      return (
        "<tr>" +
        '<td class="cell-mono">' +
        esc(c.id) +
        copyBtn(c.id, "Copy") +
        "</td>" +
        "<td>" +
        esc(c.label || "") +
        "</td>" +
        "<td>" +
        pill(c.status, c.status) +
        "</td>" +
        '<td class="cell-muted">' +
        (c.lastValidatedAt ? esc(fmtTime(c.lastValidatedAt)) : "—") +
        "</td>" +
        '<td><div class="row tight">' +
        '<button class="btn btn-secondary btn-small" data-validate-cred="' +
        esc(c.id) +
        '">Validate</button>' +
        '<button class="toggle-btn ' +
        (c.status === "active" ? "disable" : "enable") +
        '" data-cred-status="' +
        esc(c.id) +
        '" data-to="' +
        (c.status === "active" ? "disabled" : "active") +
        '">' +
        (c.status === "active" ? "Disable" : "Enable") +
        "</button>" +
        '<button class="btn btn-danger btn-small" data-del-cred="' +
        esc(c.id) +
        '">Delete</button></div></td></tr>"'
      );
    })
    .join("");
}

async function renderProviderDetail(id) {
  const [providers, accounts, creds] = await Promise.all([
    Api.get("/api/providers"),
    Api.get("/api/accounts?provider=" + encodeURIComponent(id)),
    Api.get("/api/credentials"),
  ]);
  const p = providers.find((x) => x.id === id);
  if (!p) {
    D.pc.innerHTML = "<h1>Unknown provider</h1>" + emptyState("No such provider: " + id);
    return;
  }
  const mine = creds.filter((c) => c.providerId === id);
  const byAccount = {};
  mine.forEach((c) => {
    (byAccount[c.accountId] = byAccount[c.accountId] || []).push(c);
  });
  const acctBlocks = accounts
    .map((a) => {
      const keys = byAccount[a.id] || [];
      return (
        '<div class="tree-node"><div class="tree-head">' +
        '<span class="name mono">' +
        esc(a.id) +
        "</span> " +
        pill(a.enabled ? "on" : "off", a.enabled ? "ok" : "warn") +
        ' <span class="text-muted">' +
        esc(a.displayName || "") +
        '</span><span class="grow"></span>' +
        '<span class="text-muted">' +
        keys.length +
        ' keys</span><button class="btn btn-danger btn-small" data-delaccount="' +
        esc(a.id) +
        '">Delete</button></div><div class="tree-children">' +
        (keys.length
          ? '<div class="table-container"><table class="table"><thead><tr>' +
            "<th>Credential</th><th>Label</th><th>Status</th><th>Validated</th><th></th>" +
            "</tr></thead><tbody>" +
            credentialRows(keys) +
            "</tbody></table></div>"
          : "<p class='text-muted'>No keys.</p>") +
        "</div></div>"
      );
    })
    .join("");
  const acctOpts = accounts.map((a) => "<option>" + esc(a.id) + "</option>").join("");
  D.pc.innerHTML =
    '<div class="section"><h1>' +
    esc(p.id) +
    "</h1>" +
    '<p class="subtitle">' +
    esc(p.displayName) +
    " · " +
    accounts.length +
    " accounts · " +
    mine.length +
    " keys</p>" +
    '<div class="row gap"><button class="btn btn-ghost btn-small" id="backProv">← all providers</button>' +
    '<button class="btn btn-danger btn-small" id="delProv">Delete provider</button></div>' +
    '<div class="section"><h2 class="section-title">Config</h2>' +
    '<form class="inline-form" id="saveProv"><label>Display name' +
    '<input name="displayName" value="' +
    esc(p.displayName) +
    '"></label><label>Base URL' +
    '<input name="baseUrl" size="42" value="' +
    esc(p.baseUrl || "") +
    '"></label><label>Priority' +
    '<input name="priority" type="number" value="' +
    p.priority +
    '" class="narrow"></label><label>Enabled' +
    '<select name="enabled"><option value="true"' +
    (p.enabled ? " selected" : "") +
    '>on</option><option value="false"' +
    (!p.enabled ? " selected" : "") +
    ">off</option></select></label>" +
    '<button type="submit" class="btn btn-primary">Save</button></form></div>' +
    '<div class="section"><h2 class="section-title">Accounts & Keys (' +
    accounts.length +
    ')</h2><div class="row"><button class="btn btn-secondary btn-small" id="valAll">Validate all stale</button></div>' +
    '<div id="jobOut"></div><div class="tree">' +
    (acctBlocks || emptyState("No accounts.")) +
    "</div></div>" +
    '<div class="section"><h2 class="section-title">Add account</h2>' +
    '<form class="inline-form" id="addAcct"><label>Account ID' +
    '<input name="id" required placeholder="' +
    esc(id) +
    '-main"></label><label>Display<input name="displayName"></label>' +
    '<button type="submit" class="btn btn-primary">Add</button></form></div>' +
    '<div class="section"><h2 class="section-title">Add key</h2>' +
    '<form class="inline-form" id="addCred"><label>Account<select name="accountId">' +
    acctOpts +
    '</select></label><label>Label<input name="label" placeholder="main"></label>' +
    '<label>Secret<input name="secret" required type="password" size="34" autocomplete="off"></label>' +
    '<button type="submit" class="btn btn-primary">Add</button></form>' +
    '<p class="text-muted">Secrets are encrypted at rest.</p></div></div>';

  document.getElementById("backProv").addEventListener("click", () => {
    location.hash = "#/providers";
  });
  document.getElementById("delProv").addEventListener("click", async () => {
    if (!window.confirm("Delete " + id + " + ALL accounts/keys?")) return;
    await Api.del("/api/providers/" + encodeURIComponent(id));
    Toast.ok("Provider deleted");
    location.hash = "#/providers";
  });
  document.getElementById("saveProv").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await Api.patch("/api/providers/" + encodeURIComponent(id), {
      displayName: String(f.get("displayName")),
      baseUrl: String(f.get("baseUrl")) || null,
      priority: Number(f.get("priority")),
      enabled: String(f.get("enabled")) === "true",
    });
    Toast.ok("Provider saved");
    Router.navigate();
  });
  D.pc.querySelectorAll("[data-delaccount]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!window.confirm("Delete " + b.getAttribute("data-delaccount") + "?")) return;
      await Api.del("/api/accounts/" + encodeURIComponent(b.getAttribute("data-delaccount")));
      Toast.ok("Account deleted");
      Router.navigate();
    });
  });
  document.getElementById("valAll").addEventListener("click", async () => {
    const out = document.getElementById("jobOut");
    out.innerHTML = "<p class='text-muted'>Validating…</p>";
    try {
      const s = await Api.post("/api/maintenance/validate", {
        provider: id,
        limit: 50,
      });
      out.innerHTML =
        "<p>" +
        badge(s.ok + "/" + s.checked + " valid", s.invalid ? "warning" : "success") +
        " " +
        badge(s.skippedFresh + " fresh-skipped", "secondary") +
        "</p>";
      Toast.ok("Validation: " + s.ok + " ok, " + s.invalid + " invalid");
    } catch (err) {
      out.innerHTML = "<p>" + pill("job failed", "bad") + " " + esc(err.message) + "</p>";
    }
  });
  document.getElementById("addAcct").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await Api.post("/api/accounts", {
      id: String(f.get("id")),
      providerId: id,
      displayName: String(f.get("displayName")) || null,
    });
    Toast.ok("Account added");
    Router.navigate();
  });
  document.getElementById("addCred").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await Api.post("/api/credentials", {
      accountId: String(f.get("accountId")),
      label: String(f.get("label")) || null,
      secret: String(f.get("secret")),
    });
    Toast.ok("Key stored");
    Router.navigate();
  });
}

/* ---------- Quotas & Usage ---------- */

async function renderQuotas(q) {
  const [windows, creds] = await Promise.all([
    Api.get("/api/quotas"),
    Api.get("/api/credentials"),
  ]);
  const needle = (q.get("q") || "").toLowerCase();
  const list = windows.filter(
    (w) =>
      !needle ||
      w.credentialId.toLowerCase().includes(needle) ||
      w.metric.toLowerCase().includes(needle),
  );
  const credOpts = creds
    .filter((c) => c.status === "active")
    .map((c) => '<option value="' + esc(c.id) + '">' + esc(c.id) + "</option>")
    .join("");
  const rows = list
    .slice(0, 300)
    .map((w) => {
      return (
        "<tr>" +
        '<td class="cell-mono">' +
        esc(w.credentialId) +
        "</td><td>" +
        esc(w.metric) +
        '</td><td class="cell-mono cell-numeric">' +
        esc(w.usedValue) +
        "/" +
        esc(w.limitValue) +
        "</td><td>" +
        quotaBar(w) +
        "</td><td>" +
        esc(w.windowKind) +
        "</td><td>" +
        fmtCountdown(w.resetAt) +
        "</td><td>" +
        (w.hard ? "yes" : "no") +
        '</td><td class="cell-muted">' +
        esc(w.source) +
        '</td><td><button class="btn btn-danger btn-small" data-delquota="' +
        esc(w.id) +
        '">Delete</button></td></tr>'
      );
    })
    .join("");
  D.pc.innerHTML =
    '<div class="section"><h1>Quotas & Usage ' +
    '<span class="text-muted">(' +
    windows.length +
    " windows)</span></h1>" +
    '<p class="subtitle">Static windows are provider-reported; rolling windows reset live.</p>' +
    '<form class="inline-form" id="quotausage"><label>Live usage' +
    '<input name="credentialId" required size="28" placeholder="cred-…" value="' +
    esc(q.get("credential") || "") +
    '"></label><button type="submit" class="btn btn-secondary">Look up</button></form>' +
    '<div id="usageOut"></div>' +
    '<form class="inline-form" id="quotafilter"><label>Filter' +
    '<input id="quotaQ" value="' +
    esc(q.get("q") || "") +
    '" placeholder="credential / metric"></label>' +
    '<button type="submit" class="btn btn-secondary">Filter</button></form>' +
    '<div class="table-container"><table class="table"><thead><tr>' +
    "<th>Credential</th><th>Metric</th><th>Used / Limit</th><th>Left</th>" +
    "<th>Window</th><th>Reset in</th><th>Hard</th><th>Source</th><th></th>" +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table></div>" +
    (list.length > 300
      ? '<p class="text-muted">showing 300 of ' + list.length + "</p>"
      : "") +
    '<div class="section"><h2 class="section-title">Add quota window</h2>' +
    '<form class="inline-form" id="addQuota"><label>Credential<select name="credentialId">' +
    credOpts +
    '</select></label><label>Metric<select name="metric">' +
    ["requests", "total_tokens", "input_tokens", "output_tokens", "credits", "usd", "searches", "pages", "crawl_units"]
      .map((m) => "<option>" + m + "</option>")
      .join("") +
    '</select></label><label>Limit<input name="limitValue" type="number" value="1000" class="narrow"></label>' +
    '<label>Used<input name="usedValue" type="number" value="0" class="narrow"></label>' +
    '<label>Window<select name="windowKind">' +
    ["calendar_day", "calendar_month", "calendar_week", "calendar_hour", "rolling_seconds", "fixed"]
      .map((m) => "<option>" + m + "</option>")
      .join("") +
    '</select></label><label>Reset at<input name="resetAt" placeholder="2026-10-01T00:00:00Z" size="22"></label>' +
    '<label>Hard<select name="hard"><option value="true">yes</option><option value="false">no</option></select></label>' +
    '<button type="submit" class="btn btn-primary">Add</button></form></div></div>';

  document.getElementById("quotausage").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cid = String(new FormData(e.target).get("credentialId"));
    const out = document.getElementById("usageOut");
    try {
      const u = await Api.get("/api/usage?credential=" + encodeURIComponent(cid));
      out.innerHTML =
        '<div class="panel"><h3 class="mono panel-title">' +
        esc(cid) +
        "</h3><p>" +
        badge("requests/24h: " + u.requests, "primary") +
        " " +
        badge("tokens/24h: " + fmtNum(u.total_tokens), "primary") +
        " " +
        badge("searches: " + u.searches, "info") +
        '</p><p class="text-muted mono">in ' +
        esc(u.input_tokens) +
        " / out " +
        esc(u.output_tokens) +
        " · since " +
        esc(u.since) +
        "</p></div>";
    } catch (err) {
      out.innerHTML = "<p>" + pill("lookup failed", "bad") + " " + esc(err.message) + "</p>";
    }
  });
  document.getElementById("quotafilter").addEventListener("submit", (e) => {
    e.preventDefault();
    location.hash =
      "#/quotas?q=" + encodeURIComponent(document.getElementById("quotaQ").value);
  });
  D.pc.querySelectorAll("[data-delquota]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!window.confirm("Delete quota window?")) return;
      await Api.del("/api/quotas/" + encodeURIComponent(b.getAttribute("data-delquota")));
      Toast.ok("Quota deleted");
      Router.navigate();
    });
  });
  document.getElementById("addQuota").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await Api.post("/api/quotas", {
      credentialId: String(f.get("credentialId")),
      metric: String(f.get("metric")),
      limitValue: Number(f.get("limitValue")),
      usedValue: Number(f.get("usedValue") || 0),
      windowKind: String(f.get("windowKind")),
      resetAt: String(f.get("resetAt")) || null,
      hard: String(f.get("hard")) === "true",
      source: "configured",
    });
    Toast.ok("Quota added");
    Router.navigate();
  });
}

/* ---------- Requests ---------- */

async function renderRequests(q) {
  const id = q.get("id");
  if (id) {
    const log = await Api.get("/api/requests/" + encodeURIComponent(id));
    const rows = Object.entries(log)
      .map((pair) => {
        const v = pair[1];
        return (
          "<dt>" +
          esc(pair[0]) +
          "</dt><dd>" +
          esc(typeof v === "object" ? JSON.stringify(v, null, 2) : (v ?? "—")) +
          "</dd>"
        );
      })
      .join("");
    D.pc.innerHTML =
      '<div class="section"><h1>Request</h1>' +
      '<p><button class="btn btn-ghost btn-small" id="backReq">← all requests</button></p>' +
      '<div class="panel"><dl class="kv-display">' +
      rows +
      "</dl></div></div>";
    document.getElementById("backReq").addEventListener("click", () => {
      location.hash = "#/requests";
    });
    return;
  }
  const logs = await Api.get("/api/requests?limit=200");
  const st = q.get("status") || "";
  const pf = (q.get("provider") || "").toLowerCase();
  const list = logs.filter(
    (l) =>
      (!st || l.status === st) &&
      (!pf || (l.selectedProviderId || "").toLowerCase().includes(pf)),
  );
  D.pc.innerHTML =
    '<div class="section"><h1>Requests ' +
    '<span class="text-muted">(latest ' +
    logs.length +
    ")</span></h1>" +
    '<form class="inline-form" id="reqFilter"><label>Status<select id="reqStatus">' +
    '<option value="">all</option>' +
    '<option value="success"' +
    (st === "success" ? " selected" : "") +
    ">success</option>" +
    '<option value="error"' +
    (st === "error" ? " selected" : "") +
    ">error</option></select></label>" +
    '<label>Provider<input id="reqProv" value="' +
    esc(q.get("provider") || "") +
    '" placeholder="groq…" size="14"></label>' +
    '<button type="submit" class="btn btn-secondary">Filter</button></form>' +
    requestTable(list, "No requests match.") +
    "</div>";
  document.getElementById("reqFilter").addEventListener("submit", (e) => {
    e.preventDefault();
    const s = document.getElementById("reqStatus").value;
    const p = document.getElementById("reqProv").value;
    location.hash =
      "#/requests?status=" +
      encodeURIComponent(s) +
      "&provider=" +
      encodeURIComponent(p);
  });
}

/* ============================================================
   Router (after Pages — avoids TDZ crash)
   ============================================================ */

const ROUTES = {
  "/overview": renderOverview,
  "/playground": renderPlayground,
  "/resources": renderResources,
  "/providers": renderProviders,
  "/quotas": renderQuotas,
  "/requests": renderRequests,
};

const Router = {
  async navigate() {
    const hash = location.hash || "#/overview";
    const path = hash.slice(1).split("?")[0];
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const fn = ROUTES[path] || renderOverview;
    if (D.pt) D.pt.textContent = CFG.TITLES[path] || "Overview";
    document.querySelectorAll(".nav-item").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("data-page") === path.slice(1));
    });
    D.sbn.classList.remove("open");
    D.ms.classList.add("hidden");
    if (D.pc) D.pc.innerHTML = skeleton();
    try {
      await fn(new URLSearchParams(query || ""));
    } catch (err) {
      if (D.pc) {
        D.pc.innerHTML =
          "<h1>Something went wrong</h1>" +
          '<div class="empty-state"><p>' +
          esc(err.message) +
          '</p><p><button class="btn btn-secondary" id="retryBtn">Retry</button></p></div>';
        const rb = document.getElementById("retryBtn");
        if (rb) rb.addEventListener("click", () => Router.navigate());
      }
    }
    if (D.pc) D.pc.scrollTop = 0;
    window.scrollTo(0, 0);
  },
  init() {
    window.addEventListener("hashchange", () => this.navigate());
    document.querySelectorAll(".nav-item").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        location.hash = a.getAttribute("href");
      });
    });
    this.navigate();
  },
};

/* ============================================================
   Settings modal
   ============================================================ */

const SettingsModal = {
  async open() {
    const s = await Api.get("/api/settings").catch(() => ({
      defaultPolicy: "auto",
    }));
    D.sb.innerHTML =
      '<div class="section flush"><h2 class="section-title">Routing</h2>' +
      '<form class="inline-form" id="saveSettings"><label>Default policy<select name="defaultPolicy">' +
      policyOptions(s.defaultPolicy) +
      "</select></label>" +
      '<button type="submit" class="btn btn-primary">Save</button></form>' +
      '<p class="text-muted">Runtime setting — a restart resets it to DEFAULT_POLICY.</p></div>' +
      '<div class="section"><h2 class="section-title">Validation job</h2>' +
      '<form class="inline-form" id="runValidate"><label>Provider' +
      '<input name="provider" size="14" placeholder="(all)"></label>' +
      '<label>Limit<input name="limit" type="number" value="25" class="narrow"></label>' +
      '<button type="submit" class="btn btn-secondary">Run</button></form><div id="valOut"></div></div>';
    openModal("settingsModal");
    document.getElementById("saveSettings").addEventListener("submit", async (e) => {
      e.preventDefault();
      const next = await Api.patch("/api/settings", {
        defaultPolicy: String(new FormData(e.target).get("defaultPolicy")),
      });
      Toast.ok("Default policy → " + next.defaultPolicy);
      Health.check();
    });
    document.getElementById("runValidate").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const out = document.getElementById("valOut");
      out.innerHTML = "<p class='text-muted'>Validating…</p>";
      try {
        const r = await Api.post("/api/maintenance/validate", {
          provider: String(f.get("provider")) || undefined,
          limit: Number(f.get("limit") || 25),
        });
        out.innerHTML =
          "<p>" +
          badge(r.ok + "/" + r.checked + " valid", r.invalid ? "warning" : "success") +
          " " +
          badge(r.skippedFresh + " fresh-skipped", "secondary") +
          "</p>";
      } catch (err) {
        out.innerHTML = "<p>" + pill("job failed", "bad") + " " + esc(err.message) + "</p>";
      }
    });
  },
};

/* ============================================================
   Global events
   ============================================================ */

function initEvents() {
  D.os.addEventListener("click", () => SettingsModal.open());
  D.sc.addEventListener("click", () => closeModal("settingsModal"));
  D.sm.addEventListener("click", (e) => {
    if (e.target.id === "settingsModal") closeModal("settingsModal");
  });
  D.mt.addEventListener("click", () => {
    D.sbn.classList.toggle("open");
    D.ms.classList.toggle("hidden");
  });
  D.ms.addEventListener("click", () => {
    D.sbn.classList.remove("open");
    D.ms.classList.add("hidden");
  });
  D.rb.addEventListener("click", () => {
    Health.check();
    Router.navigate();
    Toast.ok("Refreshed");
  });
  document.addEventListener("click", (e) => {
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      const v = cp.getAttribute("data-copy");
      if (navigator.clipboard) {
        navigator.clipboard.writeText(v).then(
          () => Toast.ok("Copied"),
          () => Toast.err("Copy failed"),
        );
      }
      return;
    }
    const vs = e.target.closest("[data-validate-cred]");
    if (vs) {
      const credId = vs.getAttribute("data-validate-cred");
      Toast.show("Probing…");
      Api.post("/api/credentials/" + encodeURIComponent(credId) + "/validate")
        .then((r) =>
          Toast.show(
            r.ok
              ? "Valid — " + (r.message || "accepted")
              : "Invalid — " + (r.message || "rejected"),
            r.ok ? "success" : "error",
          ),
        )
        .catch((err) => Toast.err("Validation failed: " + err.message))
        .finally(() => Router.navigate());
      return;
    }
    const cs = e.target.closest("[data-cred-status]");
    if (cs) {
      const credId = cs.getAttribute("data-cred-status");
      const to = cs.getAttribute("data-to");
      Api.patch("/api/credentials/" + encodeURIComponent(credId), { status: to })
        .then(() => {
          Toast.ok("Credential " + to);
          Router.navigate();
        })
        .catch((err) => Toast.err("Failed: " + err.message));
      return;
    }
    const dc = e.target.closest("[data-del-cred]");
    if (dc) {
      const credId = dc.getAttribute("data-del-cred");
      if (!window.confirm("Delete key " + credId + "? Quotas and health go with it.")) return;
      Api.del("/api/credentials/" + encodeURIComponent(credId))
        .then(() => {
          Toast.ok("Key deleted");
          Router.navigate();
        })
        .catch((err) => Toast.err("Failed: " + err.message));
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("settingsModal");
    }
  });
  setInterval(() => Health.check(), 30000);
}

/* ============================================================
   Boot
   ============================================================ */

async function boot() {
  await Health.check();
  initEvents();
  Router.init();
}

boot();
