import type {
  BenchmarkCell,
  BenchmarkRunResult,
  BenchmarkRunSummary,
  BenchmarkScopeResult,
  BenchmarkWindowRow,
  CellTone,
  CollectedOffer,
  ProviderDescriptor,
  ProviderQuote,
  ProviderWin,
  ReportScopeDefinition,
  ScopeProviderSelection,
} from "@/src/lib/benchmark/types";

interface BuildBenchmarkResultArgs {
  mode: BenchmarkRunResult["mode"];
  warnings: string[];
  scopes: ReportScopeDefinition[];
  providers: ProviderDescriptor[];
  quotes: ProviderQuote[];
  providersByScope?: ScopeProviderSelection;
  offers?: CollectedOffer[];
}

function getQuoteKey(
  scopeId: string,
  roomId: string,
  windowId: string,
  providerKey: string,
): string {
  return [scopeId, roomId, windowId, providerKey].join("::");
}

function getCellTone(
  status: ProviderQuote["status"],
  differencePct: number | null,
): CellTone {
  if (
    status === "missing" ||
    status === "manual-review" ||
    status === "sold_out"
  ) {
    return "muted";
  }

  if (differencePct === null) {
    return "muted";
  }

  if (differencePct <= -0.03) {
    return "risk";
  }

  if (differencePct < 0) {
    return "soft-risk";
  }

  if (differencePct <= 0.03) {
    return "parity";
  }

  if (differencePct <= 0.12) {
    return "premium";
  }

  return "strong-premium";
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function buildBenchmarkResult({
  mode,
  warnings,
  scopes,
  providers,
  quotes,
  providersByScope,
  offers = [],
}: BuildBenchmarkResultArgs): BenchmarkRunResult {
  const quotesByKey = new Map<string, ProviderQuote>();

  for (const quote of quotes) {
    quotesByKey.set(
      getQuoteKey(
        quote.scopeKey,
        quote.roomId,
        quote.windowId,
        quote.providerKey,
      ),
      quote,
    );
  }

  const cheapestWinCounts = new Map<string, number>();
  const scopeResults: BenchmarkScopeResult[] = [];

  let availableRateCount = 0;
  let expectedRateCount = 0;
  let parityRiskCount = 0;
  let premiumCount = 0;
  let missingCount = 0;
  let alternativeOfferCount = 0;

  for (const scope of scopes) {
    const scopeProviders = providers.filter((provider) =>
      providersByScope
        ? providersByScope[scope.id]?.includes(provider.key)
        : provider.supportedScopes.includes(scope.id),
    );

    const scopeSpreadValues: number[] = [];
    let scopeParityRiskCount = 0;
    let scopePremiumCount = 0;
    let scopeMissingCount = 0;

    const windows = scope.windows.map((window) => {
      const rows: BenchmarkWindowRow[] = scope.rooms.map((room) => {
        const rawReferencePrice = room.referenceRates[window.id];
        const referencePrice =
          typeof rawReferencePrice === "number" ? rawReferencePrice : null;
        const entries: BenchmarkCell[] = scopeProviders.map((provider) => {
          expectedRateCount += 1;

          const fallbackQuote: ProviderQuote = {
            providerKey: provider.key,
            scopeKey: scope.id,
            roomId: room.id,
            windowId: window.id,
            price: null,
            currency: scope.currency,
            status: "missing",
            dataMode: mode,
            sourceHint: provider.searchTemplate ?? "",
          };

          const collectedQuote =
            quotesByKey.get(
              getQuoteKey(scope.id, room.id, window.id, provider.key),
            ) ?? fallbackQuote;
          const quote =
            collectedQuote.currency !== scope.currency ||
            (collectedQuote.price !== null &&
              (!Number.isFinite(collectedQuote.price) ||
                collectedQuote.price <= 0))
              ? {
                  ...collectedQuote,
                  price: null,
                  status: "manual-review" as const,
                }
              : collectedQuote;

          const differencePct =
            // Live references do not carry equivalent board/refund/tax terms yet.
            mode === "mock" &&
            quote.status === "available" &&
            quote.price !== null &&
            referencePrice !== null &&
            referencePrice > 0
              ? (quote.price - referencePrice) / referencePrice
              : null;
          const tone = getCellTone(quote.status, differencePct);

          if (quote.status === "available" && quote.price !== null) {
            availableRateCount += 1;

            if (differencePct !== null) {
              scopeSpreadValues.push(differencePct);

              if (differencePct <= -0.03) {
                parityRiskCount += 1;
                scopeParityRiskCount += 1;
              }

              if (differencePct >= 0.05) {
                premiumCount += 1;
                scopePremiumCount += 1;
              }
            }
          } else {
            missingCount += 1;
            scopeMissingCount += 1;
          }

          return {
            providerKey: provider.key,
            providerName: provider.name,
            providerShortName: provider.shortName,
            scrapedPrice: quote.price,
            referencePrice,
            differencePct,
            status: quote.status,
            tone,
            dataMode: quote.dataMode,
            sourceHint: quote.sourceHint,
            reason: quote.reason,
            offerDescription: quote.offerDescription,
            offerConditions: quote.offerConditions,
            captureMethod: quote.captureMethod,
            observedAt: quote.observedAt,
            roomFeatures: quote.roomFeatures,
            terms: quote.terms,
          };
        });

        const availableEntries = entries.filter(
          (entry) =>
            entry.status === "available" && entry.scrapedPrice !== null,
        );
        const cheapestEntry = availableEntries.reduce<BenchmarkCell | null>(
          (current, entry) => {
            if (!current) {
              return entry;
            }

            return (entry.scrapedPrice ?? Number.POSITIVE_INFINITY) <
              (current.scrapedPrice ?? Number.POSITIVE_INFINITY)
              ? entry
              : current;
          },
          null,
        );

        if (cheapestEntry && mode === "mock") {
          cheapestWinCounts.set(
            cheapestEntry.providerKey,
            (cheapestWinCounts.get(cheapestEntry.providerKey) ?? 0) + 1,
          );
        }

        return {
          roomId: room.id,
          roomName: room.name,
          occupancyLabel: room.occupancyLabel,
          referencePrice,
          entries,
        };
      });

      const selectedIds = new Set(
        scope.rooms.flatMap((room) =>
          scopeProviders.map(
            (provider) =>
              quotesByKey.get(
                getQuoteKey(scope.id, room.id, window.id, provider.key),
              )?.offerId,
          ),
        ),
      );
      const alternativeOffers = offers
        .filter(
          (offer) =>
            offer.scopeKey === scope.id &&
            offer.windowId === window.id &&
            scopeProviders.some(
              (provider) => provider.key === offer.providerKey,
            ) &&
            offer.checkIn === window.checkIn &&
            offer.checkOut === window.checkOut &&
            offer.nights === window.nights &&
            offer.rooms === 1 &&
            offer.adults === 2 &&
            offer.currency === scope.currency &&
            Number.isFinite(offer.price) &&
            offer.price > 0 &&
            !selectedIds.has(offer.id),
        )
        .map((offer) => ({
          ...offer,
          matchReason: offer.matchedRoomId
            ? "Aynı oda kategorisindeki diğer teklif; operatör veya tarife koşulları farklı olabilir."
            : offer.matchReason,
        }))
        .sort((a, b) => a.price - b.price);
      alternativeOfferCount += alternativeOffers.length;
      return {
        ...window,
        rows,
        alternativeOffers,
      };
    });

    scopeResults.push({
      id: scope.id,
      label: scope.label,
      hotelKey: scope.hotelKey,
      hotelName: scope.hotelName,
      marketLabel: scope.marketLabel,
      currency: scope.currency,
      notes: scope.notes,
      providers: scopeProviders,
      windows,
      stats: {
        parityRiskCount: scopeParityRiskCount,
        premiumCount: scopePremiumCount,
        missingCount: scopeMissingCount,
        averageSpreadPct: average(scopeSpreadValues),
      },
    });
  }

  const cheapestProviderWins: ProviderWin[] = providers
    .map((provider) => ({
      providerKey: provider.key,
      providerName: provider.name,
      wins: cheapestWinCounts.get(provider.key) ?? 0,
    }))
    .filter((provider) => provider.wins > 0)
    .sort((left, right) => right.wins - left.wins);

  const summary: BenchmarkRunSummary = {
    scopeCount: scopeResults.length,
    providerCount: providers.length,
    availableRateCount,
    expectedRateCount,
    coveragePct:
      expectedRateCount === 0
        ? 0
        : Math.round((availableRateCount / expectedRateCount) * 100),
    parityRiskCount,
    premiumCount,
    missingCount,
    cheapestProviderWins,
    alternativeOfferCount,
  };

  return {
    runId: `run_${Date.now().toString(36)}`,
    generatedAt: new Date().toISOString(),
    mode,
    warnings,
    providers,
    scopes: scopeResults,
    summary,
  };
}
