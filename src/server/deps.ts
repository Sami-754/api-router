import type { Store } from "../core/store.js";
import type { Router } from "../core/router.js";
import type { ProviderRegistry } from "../provider-sdk/registry.js";

export interface RuntimeSettings {
  defaultPolicy: string;
}

export interface AppDeps {
  store: Store;
  registry: ProviderRegistry;
  router: Router;
  settings: RuntimeSettings;
  fetchImpl?: typeof fetch;
}
