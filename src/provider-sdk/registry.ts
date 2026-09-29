import type { ProviderAdapter } from "./types.js";

// Provider registry: adapters own auth, URLs, translation, quota parsing,
// error classification. The core owns selection, retry, accounting.
// Adding a provider = register one adapter + mappings; no core edits.

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    const id = adapter.id.toLowerCase();
    if (this.adapters.has(id)) throw new Error(`adapter already registered: ${id}`);
    this.adapters.set(id, adapter);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id.toLowerCase());
  }

  require(id: string): ProviderAdapter {
    const a = this.get(id);
    if (!a) throw new Error(`unknown provider: ${id}`);
    return a;
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }

  ids(): string[] {
    return [...this.adapters.keys()];
  }
}
