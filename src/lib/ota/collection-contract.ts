import { withBenchmarkErrorCode } from "../benchmark/status";
import type {
  BenchmarkErrorCode,
  CollectionAttempt,
  ProviderCollectionDiagnostics,
  ProviderCollectionResult,
  ProviderDescriptor,
  ReportScopeDefinition,
} from "../benchmark/types";
import { buildCollectionAttempts } from "./collection-attempts";

function countByStatus<T extends string>(
  values: T[],
  statuses: readonly T[],
): Record<T, number> {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      values.filter((value) => value === status).length,
    ]),
  ) as Record<T, number>;
}

function validCollectorAttempt(
  attempt: CollectionAttempt,
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): boolean {
  return (
    attempt.providerKey === provider.key &&
    attempt.scopeKey === scope.id &&
    attempt.hotelKey === scope.hotelKey &&
    scope.windows.some((window) => window.id === attempt.windowId)
  );
}

export function normalizeProviderCollectionResult(input: {
  provider: ProviderDescriptor;
  scope: ReportScopeDefinition;
  result: ProviderCollectionResult;
  executed: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}): ProviderCollectionResult {
  const validRoomIds = new Set(input.scope.rooms.map((room) => room.id));
  const validWindowIds = new Set(
    input.scope.windows.map((window) => window.id),
  );
  const contractIssues: string[] = [];
  const quotes = input.result.quotes
    .filter((quote) => {
      const valid =
        quote.providerKey === input.provider.key &&
        quote.scopeKey === input.scope.id &&
        validRoomIds.has(quote.roomId) &&
        validWindowIds.has(quote.windowId);
      if (!valid) contractIssues.push("Geçersiz quote sahipliği elendi.");
      return valid;
    })
    .map(withBenchmarkErrorCode);
  const offers = (input.result.offers ?? []).filter((offer) => {
    const valid =
      offer.providerKey === input.provider.key &&
      offer.scopeKey === input.scope.id &&
      validWindowIds.has(offer.windowId);
    if (!valid) contractIssues.push("Geçersiz teklif sahipliği elendi.");
    return valid;
  });
  const normalizedBase: ProviderCollectionResult = {
    ...input.result,
    quotes,
    offers,
  };
  const derivedAttempts = buildCollectionAttempts({
    provider: input.provider,
    scope: input.scope,
    result: normalizedBase,
    executed: input.executed,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.durationMs,
  });
  const collectorAttempts = (input.result.attempts ?? []).filter((attempt) => {
    const valid = validCollectorAttempt(
      attempt,
      input.provider,
      input.scope,
    );
    if (!valid) contractIssues.push("Geçersiz sorgu telemetrisi elendi.");
    return valid;
  });
  const collectorAttemptsByWindow = new Map(
    collectorAttempts.map((attempt) => [attempt.windowId, attempt]),
  );
  const attempts = derivedAttempts.map((derived) => {
    const collector = collectorAttemptsByWindow.get(derived.windowId);
    if (!collector) return derived;
    const validationChecks = new Map(
      (derived.validationChecks ?? []).map((check) => [check.stage, check]),
    );
    for (const check of collector.validationChecks ?? []) {
      validationChecks.set(check.stage, check);
    }
    return {
      ...derived,
      startedAt: collector.startedAt,
      completedAt: collector.completedAt,
      durationMs: collector.durationMs ?? derived.durationMs,
      validationChecks: [...validationChecks.values()],
    };
  });

  if (new Set(contractIssues).size > 0) {
    contractIssues.splice(0, contractIssues.length, ...new Set(contractIssues));
  }

  const errorCounts: Partial<Record<BenchmarkErrorCode, number>> = {};
  for (const quote of quotes) {
    if (!quote.errorCode) continue;
    errorCounts[quote.errorCode] = (errorCounts[quote.errorCode] ?? 0) + 1;
  }
  const validationChecks = attempts.flatMap(
    (attempt) => attempt.validationChecks ?? [],
  );
  const diagnostics: ProviderCollectionDiagnostics = {
    schemaVersion: 1,
    providerKey: input.provider.key,
    scopeKey: input.scope.id,
    quoteCount: quotes.length,
    rawOfferCount: offers.length,
    acceptedOfferCount: attempts.reduce(
      (total, attempt) => total + attempt.acceptedOfferCount,
      0,
    ),
    attemptCount: attempts.length,
    quoteStatusCounts: countByStatus(
      quotes.map((quote) => quote.status),
      ["available", "missing", "sold_out", "manual-review"] as const,
    ),
    attemptStatusCounts: countByStatus(
      attempts.map((attempt) => attempt.status),
      ["completed", "partial", "failed", "not_run"] as const,
    ),
    errorCounts,
    validationEvidenceCounts: {
      collector: validationChecks.filter(
        (check) => check.evidence === "collector",
      ).length,
      derived: validationChecks.filter((check) => check.evidence === "derived")
        .length,
    },
    contractIssues,
  };
  const contractWarnings = contractIssues.map(
    (issue) => `${input.provider.name} / ${input.scope.hotelName}: ${issue}`,
  );

  return {
    ...normalizedBase,
    attempts,
    diagnostics,
    warnings: [...input.result.warnings, ...contractWarnings],
  };
}
