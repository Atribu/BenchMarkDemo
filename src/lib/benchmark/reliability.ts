import type {
  BenchmarkCell,
  BenchmarkErrorCode,
  BenchmarkScopeResult,
  CollectionAttempt,
  HotelReliabilitySummary,
  ProviderDescriptor,
  ProviderReliabilityLevel,
  ProviderReliabilitySummary,
  ReliabilityMetrics,
} from "./types";

const TECHNICAL_FAILURE_CODES = new Set<BenchmarkErrorCode>([
  "access_blocked",
  "rate_limited",
  "timeout",
  "invalid_response",
  "configuration_missing",
]);

function reliabilityLevel(
  attemptedCount: number,
  reliabilityPct: number,
): ProviderReliabilityLevel {
  if (attemptedCount === 0 || reliabilityPct < 50) return "weak";
  if (reliabilityPct < 80) return "partial";
  return "strong";
}

function summarizeReliabilityCells(
  cells: BenchmarkCell[],
  attempts: CollectionAttempt[] = [],
): ReliabilityMetrics {
  const attemptedCount = cells.length;
  const verifiedPriceCount = cells.filter(
    (cell) =>
      cell.status === "available" &&
      cell.scrapedPrice !== null &&
      cell.captureMethod !== "manual-browser",
  ).length;
  const manualPriceCount = cells.filter(
    (cell) =>
      cell.status === "available" &&
      cell.scrapedPrice !== null &&
      cell.captureMethod === "manual-browser",
  ).length;
  const noInventoryCount = cells.filter(
    (cell) =>
      cell.status === "sold_out" || cell.errorCode === "no_inventory",
  ).length;
  const resolvedCount =
    verifiedPriceCount + manualPriceCount + noInventoryCount;
  const technicalFailureCount = cells.filter(
    (cell) =>
      cell.status !== "available" &&
      cell.errorCode !== undefined &&
      cell.errorCode !== null &&
      TECHNICAL_FAILURE_CODES.has(cell.errorCode),
  ).length;
  const reviewCount = Math.max(
    0,
    attemptedCount - resolvedCount - technicalFailureCount,
  );
  const reliabilityPct =
    attemptedCount === 0
      ? 0
      : Math.round((resolvedCount / attemptedCount) * 100);
  const errorCounts: Partial<Record<BenchmarkErrorCode, number>> = {};

  for (const cell of cells) {
    if (!cell.errorCode || cell.errorCode === "no_inventory") continue;
    errorCounts[cell.errorCode] = (errorCounts[cell.errorCode] ?? 0) + 1;
  }

  const queryAttemptCount = attempts.filter(
    (attempt) => attempt.status !== "not_run",
  ).length;
  const queryCompletedCount = attempts.filter(
    (attempt) => attempt.status === "completed",
  ).length;
  const queryPartialCount = attempts.filter(
    (attempt) => attempt.status === "partial",
  ).length;
  const queryFailureCount = attempts.filter(
    (attempt) => attempt.status === "failed",
  ).length;
  const queryNotRunCount = attempts.filter(
    (attempt) => attempt.status === "not_run",
  ).length;
  const queryResponseCount = queryCompletedCount + queryPartialCount;
  const queryReliabilityPct =
    queryAttemptCount === 0
      ? 0
      : Math.round((queryResponseCount / queryAttemptCount) * 100);

  return {
    attemptedCount,
    resolvedCount,
    verifiedPriceCount,
    manualPriceCount,
    noInventoryCount,
    reviewCount,
    technicalFailureCount,
    reliabilityPct,
    level: reliabilityLevel(attemptedCount, reliabilityPct),
    errorCounts,
    queryAttemptCount,
    queryResponseCount,
    queryCompletedCount,
    queryPartialCount,
    queryFailureCount,
    queryNotRunCount,
    queryReliabilityPct,
    queryLevel: reliabilityLevel(queryAttemptCount, queryReliabilityPct),
  };
}

export function summarizeProviderReliability(
  provider: Pick<ProviderDescriptor, "key" | "name">,
  cells: BenchmarkCell[],
  attempts: CollectionAttempt[] = [],
): ProviderReliabilitySummary {
  return {
    providerKey: provider.key,
    providerName: provider.name,
    ...summarizeReliabilityCells(cells, attempts),
  };
}

export function buildReliabilitySummaries(
  providers: ProviderDescriptor[],
  scopes: BenchmarkScopeResult[],
  attempts: CollectionAttempt[] = [],
): ProviderReliabilitySummary[] {
  const cells = scopes.flatMap((scope) =>
    scope.windows.flatMap((window) =>
      window.rows.flatMap((row) => row.entries),
    ),
  );

  return providers
    .map((provider) =>
      summarizeProviderReliability(
        provider,
        cells.filter((cell) => cell.providerKey === provider.key),
        attempts.filter((attempt) => attempt.providerKey === provider.key),
      ),
    )
    .filter((summary) => summary.attemptedCount > 0);
}

export function buildHotelReliabilitySummaries(
  scopes: BenchmarkScopeResult[],
  attempts: CollectionAttempt[] = [],
): HotelReliabilitySummary[] {
  const hotels = new Map<
    BenchmarkScopeResult["hotelKey"],
    { hotelName: string; cells: BenchmarkCell[] }
  >();

  for (const scope of scopes) {
    const hotel = hotels.get(scope.hotelKey) ?? {
      hotelName: scope.hotelName,
      cells: [],
    };
    hotel.cells.push(
      ...scope.windows.flatMap((window) =>
        window.rows.flatMap((row) => row.entries),
      ),
    );
    hotels.set(scope.hotelKey, hotel);
  }

  return [...hotels.entries()].map(([hotelKey, hotel]) => ({
    hotelKey,
    hotelName: hotel.hotelName,
    ...summarizeReliabilityCells(
      hotel.cells,
      attempts.filter((attempt) => attempt.hotelKey === hotelKey),
    ),
  }));
}
