# UI redesign — shipped

Status: **shipped 2026-11-17.** Replaces the old dependency-free
`public/index.html + styles.css + app.js` dashboard with a React + Vite +
TypeScript app in `web/`.

The previous brief locked "no build step" and a six-page IA. Both constraints
were deliberately dropped: the single-file UI was the maintainability problem,
and the six pages duplicated each other. This document is the new spec.

## Operator model

Nav = six pages plus a Settings drawer. Each page answers one question.

| Nav | Route | Question | Sections |
|---|---|---|---|
| Dashboard | `/` | Is anything on fire? | Attention feed, metric strip, 24h activity, quota watch, provider health, recent requests |
| Models | `/models` | What can a client call, and where does it route? | Models/Tools tabs, filters, canonical table, sync models |
| Model detail | `/models/:id` | Which routes serve this, with which key/quota? | Summary band, capability switch, provider mapping groups, route table |
| Providers | `/providers` | Which providers/accounts/keys are alive? | Provider table (adapter/keys/models/24h), direct Add key |
| Provider detail | `/providers/:id` | What quota is left, and which keys work? | Config, accounts (accordion), key table, per-key quotas + usage, add key/quota, validate |
| Requests | `/requests` | What happened, and why? | Grouped request table, filters, auto-refresh, attempt-chain drawer |
| Playground | `/playground` | Does this route actually work? | Chat conversation, web-tool tabs, route metadata, copy-as-curl |
| Add | `/add` | How do I add a key or a missing model route? | Key-first form (provider → key → label), model-route tab, setup checklists |
| Settings | gear → drawer | Defaults and maintenance | Policy, client endpoints, validate stale keys, sync models |

Dropped: standalone Quotas page, routing simulator UI. Quotas now appear where
they act: model routes, provider keys, and the dashboard quota watch.

**Providers and tools are backend-only.** The dashboard never creates new
adapters or tool integrations. The Add page is key-first: pick a provider,
paste the key, label it. For known tool adapters (Exa/Tavily/Firecrawl) the
backend materializes the provider row, main account, capability mappings and
live adapter from the key. The Add page's Model route tab covers models missing
from a provider catalog. The rest of the UI is for accounts/keys, quotas, route
inspection/toggles and traffic observation.

## Visual system

Refined dark ops console. The identity comes from typography, hairlines and
quota/health signal, not gradients or card shadows.

```text
Ink:      #08090b / #0b0c10 / #101116 / #15171d / #1b1e25
Lines:    rgba(255,255,255,.07) and .12
Text:     #ececef / #a2a5ad / #6c6f78
Accent:   #6062ef (single accent; no lime, no gradient)
Status:   #4cc38a ok / #d6a548 warn / #e06a6a bad
Type:     Geist Sans variable + Geist Mono variable (bundled locally)
```

- 232px sidebar (64px rail, off-canvas under 900px), 56px topbar, 1440px
  content, 12-column grid.
- 22/600 page titles, 14/600 section titles, 13px body, 12.5px tables,
  tabular numerals everywhere.
- Tables use a sticky header, 36–40px rows and hairline dividers; no
  border + shadow + card stack.
- Native `<dialog>` for modals and the settings/request drawers (focus trap,
  Escape, backdrop). Skeleton loaders, tailored empty states, inline errors,
  focus-visible rings, skip link and reduced-motion support.
- No charts dependency: the 24h activity chart is CSS bars.

## Architecture

```text
web/
  index.html, vite.config.ts, tsconfig.json
  src/main.tsx, App.tsx
  src/styles/{tokens,base,shell,components,pages}.css
  src/lib/{api,types,format,hooks,group,constants,refresh}.ts(x)
  src/components/   shell primitives, tables, pills, quota bars, dialogs
  src/pages/        Dashboard, Models, ModelDetail, Providers, ProviderDetail,
                     Requests, Playground, Add, NotFound
  src/features/     keys/, models/, providers/, requests/, playground/, settings/
```

- HashRouter; no server rewrite needed.
- One typed fetch client with envelope parsing and one 429 retry.
- `useApi` does abortable fetch + visibility-aware polling; manual refresh
  bumps a shared nonce.
- Request logs are per attempt (`<requestId>:attemptN`). The Requests page
  groups them client-side so one row = one logical request, and the drawer
  shows the fallback chain.
- Alias resources (`auto:free`) can have →1,800 routes. The detail page shows
  provider coverage first and paginates/collapses mapping groups.
- No N+1 API calls: list pages use `/api/routes/counts`, never per-row
  `/api/routes`.

## Backend additions

| Endpoint | Purpose |
|---|---|
| `GET /api/adapters` | runtime + installable tool adapters with kind/base URL/capabilities |
| `POST /api/keys` | key-first provisioning: provider/account/credential + tool mappings |
| `POST /api/maintenance/sync` | single-flight model catalog sync; returns `{mapped, pruned, skipped, autoFreeMappings}` |
| `PATCH /api/credentials/:id` `label` | inline key label editing |

`src/server/app.ts` now serves `web/dist` at `/dashboard` and `/dashboard/*`
with traversal guards and immutable caching for hashed assets. The server
still boots and tests pass when `web/dist` is absent (dashboard returns 404
with "run pnpm web:build").

## Commands

```sh
pnpm dev        # API :4500
pnpm dev:web    # Vite :5173, proxies /api /v1 /healthz
pnpm build      # web build + server tsc
pnpm typecheck  # server + web
pnpm lint
pnpm test
```

Deploy: `pnpm build && systemctl --user restart api-router.service`.

## Deliberately not included

New provider adapters/tool integrations, command palette, provider coverage matrix,
bulk mapping actions, saved playground presets, side-by-side compare,
sparklines, projected exhaustion, bulk key-import UI, and the routing
simulator. Add them only if they earn their space.
