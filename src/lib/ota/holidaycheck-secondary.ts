import type {
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
  ScopeKey,
  SecondaryOffer,
} from "../benchmark/types";
import { collectInBatches } from "./collection-queue";
import {
  buildHolidayCheckHotelOnlyUrl,
  collectHolidayCheckLiveQuotes,
} from "./live-holidaycheck";
import { HOLIDAYCHECK_HOTEL_CONFIG } from "./live-config";
import { deduplicateOffers } from "./offer-matching";

type Seller = SecondaryOffer["advertisedProviderKey"];

export function holidayCheckSeller(name?: string): Seller | null {
  const normalized = name?.trim().toLowerCase();
  return normalized === "booking.com"
    ? "booking"
    : normalized === "expedia"
      ? "expedia"
      : normalized === "tui"
        ? "tui"
        : null;
}

interface SecondarySourceArgs {
  scopes: ReportScopeDefinition[];
  catalog: ReportScopeDefinition[];
  providers: ProviderDescriptor[];
  quotes: ProviderQuote[];
  holidayCheckProvider: ProviderDescriptor;
  existing?: Partial<Record<ScopeKey, ProviderCollectionResult>>;
  collect?: typeof collectHolidayCheckLiveQuotes;
}

export async function collectHolidayCheckSecondary({
  scopes,
  catalog,
  providers,
  quotes,
  holidayCheckProvider,
  existing = {},
  collect = collectHolidayCheckLiveQuotes,
}: SecondarySourceArgs): Promise<{
  secondaryOffers: SecondaryOffer[];
  warnings: string[];
}> {
  const selected = new Set(providers.map((provider) => provider.key));
  const jobs = new Map<
    ScopeKey,
    {
      scope: ReportScopeDefinition;
      targets: {
        window: ReportScopeDefinition["windows"][number];
        providerKey: Seller;
      }[];
    }
  >();
  for (const scope of scopes) {
    const sourceScope = catalog.find(
      (candidate) =>
        candidate.hotelKey === scope.hotelKey &&
        candidate.currency === "EUR" &&
        holidayCheckProvider.supportedScopes.includes(candidate.id),
    );
    if (!sourceScope) continue;
    for (const window of scope.windows) {
      for (const providerKey of ["booking", "expedia", "tui"] as const) {
        if (
          !selected.has(providerKey) ||
          !quotes.some(
            (quote) =>
              quote.scopeKey === scope.id &&
              quote.windowId === window.id &&
              quote.providerKey === providerKey &&
              quote.dataMode === "live" &&
              ["manual-review", "missing"].includes(quote.status),
          )
        )
          continue;
        const job = jobs.get(sourceScope.id) ?? {
          scope: { ...sourceScope, windows: [] },
          targets: [],
        };
        if (!job.scope.windows.some((candidate) => candidate.id === window.id))
          job.scope.windows.push(window);
        if (
          !job.targets.some(
            (target) =>
              target.providerKey === providerKey &&
              target.window.id === window.id,
          )
        )
          job.targets.push({ window, providerKey });
        jobs.set(sourceScope.id, job);
      }
    }
  }
  const results = await collectInBatches(
    [...jobs.values()].map(({ scope, targets }) => async () => {
      const warnings: string[] = [];
      const secondaryOffers: SecondaryOffer[] = [];
      try {
        // Reuse a selected HolidayCheck run, including failures; never retry the same search here.
        const result =
          existing[scope.id] ?? (await collect(holidayCheckProvider, scope));
        if (!existing[scope.id])
          warnings.push(
            ...result.warnings.map((warning) => `Ek kaynak: ${warning}`),
          );
        for (const offer of deduplicateOffers(result.offers ?? [])) {
          const seller = holidayCheckSeller(offer.terms.operator);
          const target = targets.find(
            (candidate) =>
              candidate.providerKey === seller &&
              candidate.window.id === offer.windowId,
          );
          if (
            !seller ||
            !target ||
            offer.providerKey !== "holidaycheck" ||
            offer.scopeKey !== scope.id ||
            offer.currency !== "EUR" ||
            offer.checkIn !== target.window.checkIn ||
            offer.checkOut !== target.window.checkOut ||
            offer.nights !== target.window.nights ||
            offer.adults !== 2 ||
            offer.rooms !== 1 ||
            !Number.isFinite(offer.price) ||
            offer.price <= 0
          )
            continue;
          const expectedUrl = buildHolidayCheckHotelOnlyUrl(
            HOLIDAYCHECK_HOTEL_CONFIG[scope.hotelKey]?.pageUrl ?? "",
            offer.checkIn,
            offer.checkOut,
          );
          if (
            !expectedUrl ||
            offer.sourceHint !== expectedUrl ||
            !Number.isFinite(Date.parse(offer.observedAt))
          )
            continue;
          secondaryOffers.push({
            ...offer,
            providerKey: "holidaycheck",
            source: "holidaycheck",
            advertisedProviderKey: seller,
            hotelKey: scope.hotelKey,
            hotelName: scope.hotelName,
          });
        }
        warnings.push(
          secondaryOffers.length
            ? `${scope.hotelName}: HolidayCheck üzerinden ${secondaryOffers.length} seçili OTA etiketli uçaksız teklif bulundu. Kaynak para birimi EUR; doğrudan OTA doğrulaması değildir ve oda kapsamasına eklenmez.`
            : `${scope.hotelName}: HolidayCheck ek kaynağında seçilen kanallar için doğrulanmış teklif bulunamadı.`,
        );
      } catch (error) {
        warnings.push(
          `HolidayCheck ek kaynak / ${scope.hotelName}: ${error instanceof Error ? error.message.split("\n")[0] : "Sorgu tamamlanamadı."}`,
        );
      }
      return { secondaryOffers, warnings };
    }),
    2,
  );
  return {
    secondaryOffers: results
      .flatMap((result) => result.secondaryOffers)
      .sort((a, b) => a.price - b.price),
    warnings: results.flatMap((result) => result.warnings),
  };
}
