import type {
  ProviderDescriptor,
  ReportScopeDefinition,
  ScopeProviderSelection,
} from "./types";

export interface CollectionTask {
  scope: ReportScopeDefinition;
  provider: ProviderDescriptor;
  supported: boolean;
  reason?: string;
}

// Market selection is a preference, not permission to silently drop an OTA.
// A fallback must stay on the same hotel and retain its source currency.
export function buildCollectionPlan(
  requested: ReportScopeDefinition[],
  providers: ProviderDescriptor[],
  catalog: ReportScopeDefinition[],
) {
  const tasks: CollectionTask[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const scopes = new Map<string, ReportScopeDefinition>();
  const providersByScope: ScopeProviderSelection = {};
  for (const requestedScope of requested) {
    for (const provider of providers) {
      const direct = provider.supportedScopes.includes(requestedScope.id);
      const alternate = direct
        ? undefined
        : catalog.find(
            (scope) =>
              scope.hotelKey === requestedScope.hotelKey &&
              provider.supportedScopes.includes(scope.id),
          );
      const scope = alternate
        ? { ...alternate, windows: requestedScope.windows }
        : requestedScope;
      const key = `${scope.id}:${provider.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const supported = direct || !!alternate;
      const reason = supported
        ? undefined
        : `${provider.name}: ${scope.hotelName} için otel/pazar eşleştirmesi eksik. Bu kanala sorgu gönderilmedi.`;
      if (alternate)
        warnings.push(
          `${provider.name} / ${scope.hotelName}: ${requestedScope.currency} yerine desteklenen ${scope.currency} pazarında sorgulanır. Para birimleri birbirine çevrilmez.`,
        );
      if (reason) warnings.push(reason);
      tasks.push({ scope, provider, supported, reason });
      scopes.set(scope.id, scope);
      (providersByScope[scope.id] ??= []).push(provider.key);
    }
  }
  return { tasks, scopes: [...scopes.values()], providersByScope, warnings };
}
