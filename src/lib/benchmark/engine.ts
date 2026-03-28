import type {
  BenchmarkCell,
  BenchmarkRunResult,
  BenchmarkRunSummary,
  BenchmarkScopeResult,
  BenchmarkWindowRow,
  CellTone,
  ProviderDescriptor,
  ProviderQuote,
  ProviderWin,
  ReportScopeDefinition
} from "@/src/lib/benchmark/types";

interface BuildBenchmarkResultArgs {
  mode: BenchmarkRunResult["mode"];
  warnings: string[];
  scopes: ReportScopeDefinition[];
  providers: ProviderDescriptor[];
  quotes: ProviderQuote[];
}

function getQuoteKey(
  scopeId: string,
  roomId: string,
  windowId: string,
  providerKey: string
): string {
  return [scopeId, roomId, windowId, providerKey].join("::");
}

function getCellTone(
  status: ProviderQuote["status"],
  differencePct: number | null
): CellTone {
  if (status === "missing" || status === "manual-review" || status === "sold_out") {
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
  quotes
}: BuildBenchmarkResultArgs): BenchmarkRunResult {
  const quotesByKey = new Map<string, ProviderQuote>();

  for (const quote of quotes) {
    quotesByKey.set(
      getQuoteKey(quote.scopeKey, quote.roomId, quote.windowId, quote.providerKey),
      quote
    );
  }

  const cheapestWinCounts = new Map<string, number>();
  const scopeResults: BenchmarkScopeResult[] = [];

  let availableRateCount = 0;
  let expectedRateCount = 0;
  let parityRiskCount = 0;
  let premiumCount = 0;
  let missingCount = 0;

  for (const scope of scopes) {
    const scopeProviders = providers.filter((provider) =>
      provider.supportedScopes.includes(scope.id)
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
            sourceHint: provider.searchTemplate ?? ""
          };

          const quote =
            quotesByKey.get(getQuoteKey(scope.id, room.id, window.id, provider.key)) ??
            fallbackQuote;

          const differencePct =
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
            sourceHint: quote.sourceHint
          };
        });

        const availableEntries = entries.filter(
          (entry) => entry.status === "available" && entry.scrapedPrice !== null
        );
        const cheapestEntry = availableEntries.reduce<BenchmarkCell | null>((current, entry) => {
          if (!current) {
            return entry;
          }

          return (entry.scrapedPrice ?? Number.POSITIVE_INFINITY) <
            (current.scrapedPrice ?? Number.POSITIVE_INFINITY)
            ? entry
            : current;
        }, null);

        if (cheapestEntry) {
          cheapestWinCounts.set(
            cheapestEntry.providerKey,
            (cheapestWinCounts.get(cheapestEntry.providerKey) ?? 0) + 1
          );
        }

        return {
          roomId: room.id,
          roomName: room.name,
          occupancyLabel: room.occupancyLabel,
          referencePrice,
          entries
        };
      });

      return {
        ...window,
        rows
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
        averageSpreadPct: average(scopeSpreadValues)
      }
    });
  }

  const cheapestProviderWins: ProviderWin[] = providers
    .map((provider) => ({
      providerKey: provider.key,
      providerName: provider.name,
      wins: cheapestWinCounts.get(provider.key) ?? 0
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
    cheapestProviderWins
  };

  return {
    runId: `run_${Date.now().toString(36)}`,
    generatedAt: new Date().toISOString(),
    mode,
    warnings,
    providers,
    scopes: scopeResults,
    summary
  };
}
