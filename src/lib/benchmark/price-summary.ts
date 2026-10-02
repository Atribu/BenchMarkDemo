import type { BenchmarkRunResult, CurrencyCode, OtaKey } from "./types";
import { benchmarkStatusLabel } from "./status";

export interface PriceSummaryItem {
  scopeKey: string;
  marketLabel: string;
  hotelName: string;
  hotelKey: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  providerKey: OtaKey;
  providerName: string;
  currency: CurrencyCode;
  price: number | null;
  source: string;
  description: string;
  observedAt?: string;
}

export function buildPriceSummary(
  report: BenchmarkRunResult,
): PriceSummaryItem[] {
  return report.scopes.flatMap((scope) =>
    scope.windows.flatMap((window) =>
      scope.providers.map((provider): PriceSummaryItem => {
        const entries = window.rows.flatMap((row) =>
          row.entries.filter((cell) => cell.providerKey === provider.key),
        );
        const base = {
          scopeKey: scope.id,
          marketLabel: scope.marketLabel,
          hotelKey: scope.hotelKey,
          hotelName: scope.hotelName,
          checkIn: window.checkIn,
          checkOut: window.checkOut,
          nights: window.nights,
          providerKey: provider.key,
          providerName: provider.name,
          currency: scope.currency,
        };
        const direct = [
          ...entries
            .filter(
              (cell) =>
                cell.status === "available" &&
                cell.scrapedPrice !== null &&
                cell.captureMethod !== "manual-browser",
            )
            .map((cell) => ({
              price: cell.scrapedPrice!,
              description: cell.offerDescription || "Oda teklifi",
              observedAt: cell.observedAt,
            })),
          ...(window.alternativeOffers ?? [])
            .filter((offer) => offer.providerKey === provider.key)
            .map((offer) => ({
              price: offer.price,
              description: `${offer.roomName} · ${offer.terms.board}`,
              observedAt: offer.observedAt,
            })),
        ]
          .filter((value) => Number.isFinite(value.price) && value.price > 0)
          .sort((a, b) => a.price - b.price);
        if (direct[0])
          return {
            ...base,
            ...direct[0],
            source:
              report.mode === "mock" ? "Demo / gerçek değil" : provider.name,
          };
        const secondary = (report.secondaryOffers ?? [])
          .filter(
            (offer) =>
              offer.hotelKey === scope.hotelKey &&
              offer.checkIn === window.checkIn &&
              offer.checkOut === window.checkOut &&
              offer.advertisedProviderKey === provider.key &&
              Number.isFinite(offer.price) &&
              offer.price > 0,
          )
          .sort((a, b) => a.price - b.price)[0];
        if (secondary)
          return {
            ...base,
            price: secondary.price,
            currency: secondary.currency,
            source: "HolidayCheck üzerinden",
            description: `${secondary.roomName} · ${secondary.terms.board}`,
            observedAt: secondary.observedAt,
          };
        const meta = (report.hotelPrices ?? [])
          .filter(
            (price) =>
              price.scopeKey === scope.id &&
              price.windowId === window.id &&
              price.providerKey === provider.key &&
              Number.isFinite(price.price) &&
              price.price > 0,
          )
          .sort((a, b) => a.price - b.price)[0];
        if (meta)
          return {
            ...base,
            price: meta.price,
            currency: meta.currency,
            source:
              meta.collectedVia === "serpapi"
                ? "Google Hotels / SerpAPI"
                : "Google Hotels",
            description:
              "Otel başlangıç toplamı; oda ve pansiyon doğrulanmadı.",
            observedAt: meta.observedAt,
          };
        return {
          ...base,
          price: null,
          source: "Fiyat alınamadı",
          description: entries[0]
            ? benchmarkStatusLabel(entries[0])
            : "Bu sorguda teklif doğrulanamadı.",
        };
      }),
    ),
  );
}
