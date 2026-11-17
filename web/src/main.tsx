import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/components.css";
import "./styles/pages.css";
import { App } from "./App";
import { ToastProvider } from "./components/ToastProvider";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { RefreshProvider } from "./lib/refresh";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <RefreshProvider>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </RefreshProvider>
    </HashRouter>
  </StrictMode>,
);
