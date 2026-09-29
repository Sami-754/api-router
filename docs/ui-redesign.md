# UI Redesign — brief

Status: **planned, not started.** The current dashboard (`public/`, static, no
build step) works but looks generic. This doc states what the remake must
achieve. No code changes until this brief is agreed.

## Why remake

- Current UI reads as a default dark-admin template: gray cards, gray pills,
  no visual identity. Screenshots confirmed: Overview and Resources look
  "normal" — interchangeable with any CRUD admin.
- Information architecture is now settled (6 pages + Settings modal, see
  STATE.md "Dashboard rebuild"). The remake keeps that IA and replaces the
  visual world + adds genuinely useful operator options.
- Constraints (locked): static files served by the router itself
  (`public/index.html + styles.css + app.js`), **no build step, no CDN/runtime
  dependency** (dashboard must work on offline/LAN setups). Vanilla JS,
  hash routing, token in localStorage, batched `/api/routes/counts`
  (never N+1 `/api/routes`), one-shot 429 retry, 401 → token modal.

## Design goal

A router dashboard should feel like **mission control for quota**, not a
database viewer. Every page answers one operator question at a glance:

| Page | Operator question |
|---|---|
| Overview | Is anything on fire right now? |
| Playground | Does this route actually work? |
| Resources | Where can this model be served from, and which route wins? |
| Providers & Keys | Which keys are alive, and what's their track record? |
| Quotas & Usage | What expires soon, what's exhausted, what's the burn rate? |
| Requests | What happened, and why did it route that way? |

Visual direction (to be picked before coding): a real identity — e.g.
terminal/ops-room aesthetic with tabular numerals and dense signal-first
layout, or a warm paper-and-ink light theme. Not another slate-cards +
accent-pill template. Typography and quota/health semaphores carry the
identity, not gradients.

## Useful options to add (proposed)

Only options an operator of *this* router would use weekly. Nothing decorative.

### Global
- [ ] `Cmd/Ctrl+K` quick jump: fuzzy-search resources, providers, credentials,
      recent requests by ID — deep-links to the right page.
- [ ] Copy-as-curl on every test/playground run and on request detail
      (replay the exact request against the router).
- [ ] Relative-time + auto-refresh toggle on Overview/Requests
      (poll `/api/overview`, `/api/requests?limit=` every N seconds).

### Overview
- [ ] Alert feed: invalid keys, quotas <10% remaining, error-rate spikes in
      the last hour — each linking to the relevant page.
- [ ] Top canonical models by 24h traffic + success rate.

### Playground
- [ ] Saved presets: named `{model, provider pin, policy}` combos in
      localStorage, one click to load.
- [ ] Side-by-side compare: same prompt → two providers, latency + output +
      route shown next to each other.
- [ ] Tool tabs keep last-used inputs (localStorage) so retests are one click.

### Resources
- [ ] Provider-coverage matrix: rows = canonical resources, columns =
      providers, cell = route count / health dot. Fastest way to see gaps.
- [ ] Bulk mapping actions per provider (enable/disable all mappings).
- [ ] Inline simulate stays (it works), plus "explain this ranking" —
      surface score breakdown already returned by `/api/routing/simulate`.

### Providers & Keys
- [ ] Per-key track record: 24h requests, success rate, avg latency
      (derivable from `/api/requests` + `/api/usage` — no backend change).
- [ ] Per-key usage sparkline (hourly buckets, same technique as Overview
      histogram).
- [ ] Bulk validate + "disable invalid" after a validation job.
- [ ] Key notes/label editing inline (label PATCH already exists).

### Quotas & Usage
- [ ] "Burning soon" spotlight: windows sorted by expiry pressure
      (high remaining + near reset first) — mirrors the `burn` policy.
- [ ] Projected exhaustion: `remaining / recent burn rate` per window.
- [ ] Inline edit of used/limit (DELETE + POST exists; PATCH would need a
      tiny backend addition — optional).

### Requests
- [ ] Replay button: sends the logged request back through Playground
      pre-filled (model, provider pin, policy, messages where stored).
- [ ] Fallback-chain view: render `attempts` as a step list
      (route tried → error class → next route), not a raw count.
- [ ] Cost/token column + filter by model substring (client-side).

## Verification plan (when built)

1. `node --check public/app.js`.
2. Every `/api/*` path used exists in `src/server/routes/management.ts`.
3. Screenshot all 6 pages + mobile width in headless Chromium against the
   live server (admin token via localStorage injection) — one batched pass,
   fix, one confirmation pass. Then run the Impeccable detector:
   `scripts/impeccable detect --json <changed targets>`.
4. No backend test changes expected (UI-only); `pnpm test` untouched.
5. Update STATE.md + this file (flip status to shipped).

## Open questions for the owner

1. Visual world: terminal/ops-room dark, warm light "paper", or a third
   identity? (Pick one — no middle-ground polish of the current look.)
2. Which 3 options from the list above are must-have for v1 of the remake?
3. Keep Settings as a modal, or does it deserve a page once validation
   scheduling grows?
