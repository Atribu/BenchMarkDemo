import type {
  OtaKey,
  ProviderDescriptor,
  ReportScopeDefinition,
  ScopeKey,
  ScopeProviderSelection,
} from "./types";

export interface CollectionTask {
  scope: ReportScopeDefinition;
  provider: ProviderDescriptor;
  supported: boolean;
  reason?: string;
}

export function supportedProviderKeysForScopes(
  scopeIds: readonly ScopeKey[],
  providers: readonly ProviderDescriptor[],
): OtaKey[] {
  const requested = new Set(scopeIds);
  return providers
    .filter((provider) =>
      provider.supportedScopes.some((scopeId) => requested.has(scopeId)),
    )
    .map((provider) => provider.key);
}

// A selected hotel/market is an exact boundary. Unsupported channels are not
// redirected to another country or currency behind the user's selection.
export function buildCollectionPlan(
  requested: ReportScopeDefinition[],
  providers: ProviderDescriptor[],
  _catalog: ReportScopeDefinition[],
) {
  const tasks: CollectionTask[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const scopes = new Map<string, ReportScopeDefinition>();
  const providersByScope: ScopeProviderSelection = {};
  for (const requestedScope of requested) {
    for (const provider of providers) {
      const direct = provider.supportedScopes.includes(requestedScope.id);
      if (!direct) continue;
      const key = `${requestedScope.id}:${provider.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({ scope: requestedScope, provider, supported: true });
      scopes.set(requestedScope.id, requestedScope);
      (providersByScope[requestedScope.id] ??= []).push(provider.key);
    }
  }
  for (const provider of providers) {
    if (!tasks.some((task) => task.provider.key === provider.key))
      warnings.push(
        `${provider.name}: seçilen otel ve pazarları desteklemediği için seçime dahil edilmedi.`,
      );
  }
  return { tasks, scopes: [...scopes.values()], providersByScope, warnings };
}
