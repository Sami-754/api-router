import type { Store } from "../core/store.js";
import type { ProviderRegistry } from "../provider-sdk/registry.js";
import { encryptSecret, newId, redactCredentialId } from "../shared/crypto.js";
import type { Credential } from "../shared/types.js";
import {
  TOOL_PROVIDERS,
  createToolAdapter,
  ensureToolMappings,
} from "./tool-catalog.js";

export interface ProvisionKeyInput {
  providerId: string;
  secret: string;
  label?: string | null;
  accountId?: string;
}

export interface ProvisionKeyResult {
  provider: {
    id: string;
    displayName: string;
    created: boolean;
  };
  account: {
    id: string;
    created: boolean;
  };
  credential: Pick<
    Credential,
    "id" | "accountId" | "providerId" | "label" | "status"
  > & { redacted: string };
  adapterRegistered: boolean;
  toolRoutes: string[];
}

export class ProvisionError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

/**
 * Adds a provider key without making the operator create provider/account rows.
 * Known tool providers are materialized on demand; their capability mappings
 * are created idempotently so the key routes as soon as it is stored.
 */
export function provisionKey(
  store: Store,
  registry: ProviderRegistry,
  input: ProvisionKeyInput,
): ProvisionKeyResult {
  const providerId = input.providerId.toLowerCase();
  const tool = TOOL_PROVIDERS[providerId];
  let provider = store.getProvider(providerId);
  const adapter = registry.get(providerId);

  if (!provider && !tool && !adapter) {
    throw new ProvisionError(`unknown provider adapter: ${providerId}`, 404);
  }
  if (!adapter && !tool) {
    throw new ProvisionError(
      `provider ${providerId} has no registered adapter; add one in backend first`,
      409,
    );
  }

  let providerCreated = false;
  if (!provider) {
    provider = store.upsertProvider({
      id: providerId,
      displayName: tool?.displayName ?? adapter!.displayName,
      baseUrl: tool?.baseUrl ?? null,
      enabled: true,
      priority: 100,
    });
    providerCreated = true;
  }

  let adapterRegistered = false;
  if (!registry.get(providerId)) {
    const created = createToolAdapter(
      providerId,
      provider.baseUrl ?? tool?.baseUrl ?? "",
    );
    if (created) {
      registry.register(created);
      adapterRegistered = true;
    }
  }

  const accountId = input.accountId?.trim() || `${providerId}-main`;
  let account = store.getAccount(accountId);
  if (account && account.providerId !== providerId) {
    throw new ProvisionError(
      `account ${accountId} belongs to ${account.providerId}`,
      409,
    );
  }
  let accountCreated = false;
  if (!account) {
    account = store.upsertAccount({
      id: accountId,
      providerId,
      displayName: `${provider.displayName} main`,
      enabled: true,
    });
    accountCreated = true;
  }

  const credential = store.createCredential({
    id: newId("cred"),
    accountId,
    label: input.label?.trim() || null,
    secretEncrypted: encryptSecret(input.secret),
    status: "active",
  });

  return {
    provider: {
      id: provider.id,
      displayName: provider.displayName,
      created: providerCreated,
    },
    account: { id: account.id, created: accountCreated },
    credential: {
      id: credential.id,
      accountId: credential.accountId,
      providerId: credential.providerId,
      label: credential.label,
      status: credential.status,
      redacted: redactCredentialId(credential.id),
    },
    adapterRegistered,
    toolRoutes: ensureToolMappings(store, providerId),
  };
}
