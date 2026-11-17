import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./lib/api";
import { useApi, useLocalState } from "./lib/hooks";
import { useRefresh } from "./lib/refresh";
import type { HealthResponse, Settings } from "./lib/types";
import { Icon, type IconName } from "./components/Icon";
import { IconButton } from "./components/ui";
import { SettingsDrawer } from "./features/settings/SettingsDrawer";
import { DashboardPage } from "./pages/DashboardPage";
import { ModelsPage } from "./pages/ModelsPage";
import { ModelDetailPage } from "./pages/ModelDetailPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { ProviderDetailPage } from "./pages/ProviderDetailPage";
import { RequestsPage } from "./pages/RequestsPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { AddPage } from "./pages/AddPage";
import { NotFoundPage } from "./pages/NotFoundPage";

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> =
  [
    { to: "/", label: "Dashboard", icon: "gauge", end: true },
    { to: "/models", label: "Models", icon: "cube" },
    { to: "/providers", label: "Providers", icon: "plug" },
    { to: "/requests", label: "Requests", icon: "list" },
    { to: "/playground", label: "Playground", icon: "terminal" },
    { to: "/add", label: "Add", icon: "plus" },
  ];

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/models")) return "Models";
  if (pathname.startsWith("/providers")) return "Providers";
  if (pathname.startsWith("/requests")) return "Requests";
  if (pathname.startsWith("/playground")) return "Playground";
  if (pathname.startsWith("/add")) return "Add";
  return "Dashboard";
}

function useHealth() {
  const { nonce } = useRefresh();
  const [health, setHealth] = useState<HealthResponse | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const result = await api.get<HealthResponse>("/healthz");
        if (alive) setHealth(result);
      } catch {
        if (alive) setHealth(null);
      }
    };
    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [nonce]);

  return health;
}

export function App() {
  const location = useLocation();
  const { bump } = useRefresh();
  const settings = useApi<Settings>("/api/settings");
  const health = useHealth();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useLocalState<boolean>(
    "router:sidebar-collapsed",
    false,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const title = pageTitle(location.pathname);
  const online = health !== undefined && health !== null;
  const statusText =
    health === undefined ? "connecting" : online ? "online" : "offline";
  const policy = settings.data?.defaultPolicy ?? "auto";

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.title = `${title} · API Router`;
  }, [title]);

  const nav = useMemo(
    () =>
      NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `nav-link${isActive ? " nav-link--active" : ""}`
          }
          title={collapsed ? item.label : undefined}
        >
          <span className="nav-link__icon">
            <Icon name={item.icon} size={17} />
          </span>
          <span className="nav-link__label">{item.label}</span>
        </NavLink>
      )),
    [collapsed],
  );

  return (
    <div
      className={`app${collapsed ? " app--collapsed" : ""}${navOpen ? " app--nav-open" : ""}`}
    >
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <div
        className="scrim"
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <rect width="32" height="32" rx="7" fill="var(--accent)" />
              <path
                d="M9 21 L16 7 L23 21 M12 16 H20"
                stroke="#fff"
                strokeWidth="2.4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="brand__text">
            <span className="brand__name">API Router</span>
            <span className="brand__meta">{statusText}</span>
          </span>
        </div>

        <nav className="nav" aria-label="Primary">
          {nav}
        </nav>

        <div className="sidebar__foot">
          <div className="sidebar__status">
            <span className={`status-dot${online ? "" : " status-dot--bad"}`} />
            <span className="sidebar__status-text">
              {health === undefined
                ? "connecting"
                : online
                  ? "router online"
                  : "router offline"}
            </span>
          </div>
          <div className="sidebar__actions">
            <button
              type="button"
              className="sidebar__settings"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
            >
              <Icon name="settings" size={16} />
              <span>Settings</span>
            </button>
            <button
              type="button"
              className="collapse-btn"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Icon
                name={collapsed ? "chevron-right" : "chevron-left"}
                size={15}
              />
            </button>
          </div>
        </div>
      </aside>

      <div className="app__main">
        <header className="topbar">
          <div className="topbar__left">
            <IconButton
              label="Toggle navigation"
              icon="menu"
              className="topbar__menu"
              onClick={() => setNavOpen(!navOpen)}
            />
            <span className="topbar__title">{title}</span>
          </div>
          <div className="topbar__right">
            <button
              type="button"
              className="policy-chip"
              onClick={() => setSettingsOpen(true)}
              title="Default routing policy"
            >
              <Icon name="bolt" size={13} />
              {policy}
            </button>
            <span className="topbar__health" title={statusText}>
              <span
                className={`status-dot${online ? "" : " status-dot--bad"}`}
              />
              <span>{statusText}</span>
            </span>
            <IconButton label="Refresh" icon="refresh" onClick={bump} />
          </div>
        </header>

        <main className="content" id="content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/models/:id" element={<ModelDetailPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/providers/:id" element={<ProviderDetailPage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="/add" element={<AddPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings.data}
        reloadSettings={settings.reload}
        health={health}
      />
    </div>
  );
}
