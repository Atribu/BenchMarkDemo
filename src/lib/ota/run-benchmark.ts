import { buildBenchmarkResult } from "@/src/lib/benchmark/engine";
import { nightCount } from "@/src/lib/benchmark/request";
import { buildCollectionPlan } from "@/src/lib/benchmark/collection-plan";
import {
  DEFAULT_REQUEST,
  REPORT_SCOPES,
} from "@/src/lib/benchmark/sample-data";
import type {
  BenchmarkCustomWindowInput,
  BenchmarkRequest,
  BenchmarkWindowDefinition,
  CollectionMode,
  OtaKey,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  RoomDefinition,
  ReportScopeDefinition,
  ScopeKey,
} from "@/src/lib/benchmark/types";
import { collectBookingLiveQuotes } from "@/src/lib/ota/live-booking";
import { collectExpediaLiveQuotes } from "@/src/lib/ota/live-expedia";
import { collectHolidayCheckLiveQuotes } from "@/src/lib/ota/live-holidaycheck";
import { collectHotelbedsLiveQuotes } from "@/src/lib/ota/live-hotelbeds";
import { buildManualReviewQuotes } from "@/src/lib/ota/live-helpers";
import { collectTuiLiveQuotes } from "@/src/lib/ota/live-tui";
import {
  collectLoveholidaysLiveQuotes,
  collectOnTheBeachLiveQuotes,
} from "@/src/lib/ota/live-uk-ota";
import { OTA_PROVIDERS } from "@/src/lib/ota/registry";
import { collectInBatches } from "./collection-queue";
import { collectGoogleHotelPrices } from "./live-google-hotels";
import { collectHolidayCheckSecondary } from "./holidaycheck-secondary";
import { collectSerpApiHotelPrices, serpApiEnabled } from "./live-serpapi";

interface ProviderProfile {
  baseMarkup: number;
  volatility: number;
  missingModulo: number;
  soldOutModulo: number;
  canUndercut: boolean;
}

const PROVIDER_PROFILES: Record<OtaKey, ProviderProfile> = {
  booking: {
    baseMarkup: 0.17,
    volatility: 0.16,
    missingModulo: 13,
    soldOutModulo: 17,
    canUndercut: true,
  },
  expedia: {
    baseMarkup: 0.15,
    volatility: 0.14,
    missingModulo: 15,
    soldOutModulo: 19,
    canUndercut: true,
  },
  hotelbeds: {
    baseMarkup: 0.08,
    volatility: 0.1,
    missingModulo: 11,
    soldOutModulo: 23,
    canUndercut: true,
  },
  holidaycheck: {
    baseMarkup: 0.12,
    volatility: 0.09,
    missingModulo: 12,
    soldOutModulo: 18,
    canUndercut: false,
  },
  loveholidays: {
    baseMarkup: 0.2,
    volatility: 0.13,
    missingModulo: 10,
    soldOutModulo: 16,
    canUndercut: true,
  },
  onthebeach: {
    baseMarkup: 0.18,
    volatility: 0.12,
    missingModulo: 14,
    soldOutModulo: 21,
    canUndercut: true,
  },
  tui: {
    baseMarkup: 0.11,
    volatility: 0.08,
    missingModulo: 16,
    soldOutModulo: 22,
    canUndercut: false,
  },
};

function hashValue(input: string): number {
  let hash = 0;

  for (const character of input) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1000003;
  }

  return hash;
}

function roundToCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateNightCount(checkIn: string, checkOut: string): number | null {
  return nightCount(checkIn, checkOut);
}

function buildWindowId(checkIn: string, checkOut: string): string {
  return `${checkIn}_${checkOut}`;
}

function buildWindowLabel(checkIn: string, checkOut: string): string {
  return `${checkIn} -> ${checkOut}`;
}

function buildRequestWindow(
  customWindow?: BenchmarkCustomWindowInput,
): BenchmarkWindowDefinition | null {
  if (!customWindow?.checkIn || !customWindow?.checkOut) {
    return null;
  }

  const nights = calculateNightCount(
    customWindow.checkIn,
    customWindow.checkOut,
  );

  if (!nights) {
    return null;
  }

  return {
    id: buildWindowId(customWindow.checkIn, customWindow.checkOut),
    label: buildWindowLabel(customWindow.checkIn, customWindow.checkOut),
    checkIn: customWindow.checkIn,
    checkOut: customWindow.checkOut,
    nights,
  };
}

function averageRoomReference(room: RoomDefinition): number {
  const values = Object.values(room.referenceRates).filter(
    (value): value is number => typeof value === "number",
  );

  if (values.length === 0) {
    return 1000;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function applyCustomWindow(
  scopes: ReportScopeDefinition[],
  customWindow?: BenchmarkCustomWindowInput,
): {
  scopes: ReportScopeDefinition[];
  warnings: string[];
} {
  const requestWindow = buildRequestWindow(customWindow);

  if (!customWindow) {
    return {
      scopes,
      warnings: [],
    };
  }

  if (!requestWindow) {
    throw new Error("Geçersiz tarih aralığı. Konaklama 1–60 gece olmalı.");
  }

  const warnings: string[] = [];
  const nextScopes = scopes.map((scope) => {
    return {
      ...scope,
      windows: [requestWindow],
    };
  });

  return {
    scopes: nextScopes,
    warnings,
  };
}

function interpolateSearchTemplate(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  roomName: string,
  window: ReportScopeDefinition["windows"][number],
): string {
  if (!provider.searchTemplate) {
    return "";
  }

  return provider.searchTemplate
    .replace("{hotelName}", encodeURIComponent(scope.hotelName))
    .replace("{checkIn}", window.checkIn)
    .replace("{checkOut}", window.checkOut)
    .replace("{roomName}", encodeURIComponent(roomName));
}

function simulateQuote(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  room: ReportScopeDefinition["rooms"][number],
  window: ReportScopeDefinition["windows"][number],
): ProviderQuote {
  const referencePrice =
    room.referenceRates[window.id] ?? averageRoomReference(room);
  const signature = `${provider.key}:${scope.id}:${room.id}:${window.id}`;
  const seed = hashValue(signature);
  const profile = PROVIDER_PROFILES[provider.key];

  if (seed % profile.soldOutModulo === 0) {
    return {
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId: room.id,
      windowId: window.id,
      price: null,
      currency: scope.currency,
      status: "sold_out",
      dataMode: "mock",
      sourceHint: interpolateSearchTemplate(provider, scope, room.name, window),
    };
  }

  if (seed % profile.missingModulo === 0) {
    return {
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId: room.id,
      windowId: window.id,
      price: null,
      currency: scope.currency,
      status: "missing",
      dataMode: "mock",
      sourceHint: interpolateSearchTemplate(provider, scope, room.name, window),
    };
  }

  const variation = ((seed % 1000) / 1000 - 0.5) * profile.volatility;
  const undercut =
    profile.canUndercut && seed % 9 === 0 ? -0.03 - (seed % 5) * 0.01 : 0;
  const markup = profile.baseMarkup + variation + undercut;
  const price = roundToCurrency(referencePrice * (1 + markup));

  return {
    providerKey: provider.key,
    scopeKey: scope.id,
    roomId: room.id,
    windowId: window.id,
    price,
    currency: scope.currency,
    status: "available",
    dataMode: "mock",
    sourceHint: interpolateSearchTemplate(provider, scope, room.name, window),
  };
}

async function collectProviderQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  _mode: CollectionMode,
): Promise<ProviderQuote[]> {
  return scope.rooms.flatMap((room) =>
    scope.windows.map((window) => simulateQuote(provider, scope, room, window)),
  );
}

async function collectLiveProviderQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  switch (provider.key) {
    case "booking":
      return collectBookingLiveQuotes(provider, scope);
    case "expedia":
      return collectExpediaLiveQuotes(provider, scope);
    case "hotelbeds":
      return collectHotelbedsLiveQuotes(provider, scope);
    case "holidaycheck":
      return collectHolidayCheckLiveQuotes(provider, scope);
    case "loveholidays":
      return collectLoveholidaysLiveQuotes(provider, scope);
    case "onthebeach":
      return collectOnTheBeachLiveQuotes(provider, scope);
    case "tui":
      return collectTuiLiveQuotes(provider, scope);
    default:
      return buildManualReviewQuotes(
        provider,
        scope,
        provider.searchTemplate ?? "",
        `${provider.name} icin live collector henuz eklenmedi.`,
      );
  }
}

export async function runBenchmarkJob(
  request: Partial<BenchmarkRequest> = {},
  collectLive: typeof collectLiveProviderQuotes = collectLiveProviderQuotes,
) {
  const resolvedRequest: BenchmarkRequest = {
    mode: request.mode ?? DEFAULT_REQUEST.mode,
    providerKeys: request.providerKeys ?? DEFAULT_REQUEST.providerKeys,
    scopeKeys: request.scopeKeys ?? DEFAULT_REQUEST.scopeKeys,
    customWindow: request.customWindow ?? DEFAULT_REQUEST.customWindow,
  };

  const baseScopes = REPORT_SCOPES.filter((scope) =>
    resolvedRequest.scopeKeys.includes(scope.id),
  );
  const customWindowResult = applyCustomWindow(
    baseScopes,
    resolvedRequest.customWindow,
  );
  const selectedProviders = OTA_PROVIDERS.filter((provider) =>
    resolvedRequest.providerKeys.includes(provider.key),
  );
  const plan = buildCollectionPlan(
    customWindowResult.scopes,
    selectedProviders,
    REPORT_SCOPES,
  );
  const selectedScopes = plan.scopes;

  const warnings: string[] = [...customWindowResult.warnings, ...plan.warnings];

  if (resolvedRequest.mode === "live") {
    warnings.push(
      "Canlı bağlantılar beta aşamasında. Eşleşmeyen gerçek teklifler ayrı gösterilir ve oda kapsamasına katılmaz. Oda eşleşmesi aynı tarife anlamına gelmez: pansiyon, iptal ve vergiler bütünüyle eşitlenmediği için canlı raporda en ucuz OTA/parite sıralaması yapılmaz. Cashback toplamdan düşülmez.",
    );
  }

  if (selectedScopes.length === 0) {
    warnings.push("Hic scope secilmedigi icin rapor bos olustu.");
  }

  const collectionResults = await collectInBatches(
    plan.tasks.map(
      ({ provider, scope, supported, reason }) =>
        async (): Promise<ProviderCollectionResult> => {
          if (!supported) {
            const result = buildManualReviewQuotes(
              provider,
              scope,
              "",
              reason,
              reason,
            );
            return {
              ...result,
              quotes: result.quotes.map((quote) => ({
                ...quote,
                dataMode: resolvedRequest.mode,
              })),
            };
          }
          return resolvedRequest.mode === "live"
            ? collectLive(provider, scope).catch((error) => {
                const detail = `${provider.name}: ${error instanceof Error ? error.message.split("\n")[0] : "Bağlantı hatası"}`;
                return buildManualReviewQuotes(
                  provider,
                  scope,
                  "",
                  detail,
                  detail,
                );
              })
            : {
                quotes: await collectProviderQuotes(
                  provider,
                  scope,
                  resolvedRequest.mode,
                ),
                warnings: [],
              };
        },
    ),
  );

  const quotes = collectionResults.flatMap((result) => result.quotes);
  warnings.push(...collectionResults.flatMap((result) => result.warnings));

  const existingHolidayCheck: Partial<
    Record<ScopeKey, ProviderCollectionResult>
  > = {};
  plan.tasks.forEach((task, index) => {
    if (task.provider.key === "holidaycheck")
      existingHolidayCheck[task.scope.id] = collectionResults[index];
  });
  const supplementary =
    resolvedRequest.mode === "live" &&
    process.env.OTA_HOLIDAYCHECK_SECONDARY !== "false"
      ? await collectHolidayCheckSecondary({
          scopes: selectedScopes,
          catalog: REPORT_SCOPES,
          providers: selectedProviders,
          quotes,
          existing: existingHolidayCheck,
          holidayCheckProvider: OTA_PROVIDERS.find(
            (provider) => provider.key === "holidaycheck",
          )!,
        })
      : { secondaryOffers: [], warnings: [] };
  warnings.push(...supplementary.warnings);

  const managedSource = serpApiEnabled();
  const missingProviders = (scope: ReportScopeDefinition) =>
    selectedProviders.filter(
      (provider) =>
        plan.providersByScope[scope.id]?.includes(provider.key) &&
        (managedSource
          ? provider.key !== "hotelbeds"
          : ["booking", "expedia"].includes(provider.key)) &&
        quotes.some(
          (quote) =>
            quote.scopeKey === scope.id &&
            quote.providerKey === provider.key &&
            quote.status === "manual-review" &&
            !quotes.some(
              (other) =>
                other.scopeKey === quote.scopeKey &&
                other.windowId === quote.windowId &&
                other.providerKey === quote.providerKey &&
                other.status === "available",
            ) &&
            !collectionResults.some((result) =>
              result.offers?.some(
                (offer) =>
                  offer.scopeKey === quote.scopeKey &&
                  offer.windowId === quote.windowId &&
                  offer.providerKey === quote.providerKey,
              ),
            ) &&
            !supplementary.secondaryOffers.some(
              (offer) =>
                offer.hotelKey === scope.hotelKey &&
                offer.windowId === quote.windowId &&
                offer.advertisedProviderKey === quote.providerKey,
            ),
        ),
    );
  const secondaryResults =
    resolvedRequest.mode === "live" && process.env.OTA_GOOGLE_HOTELS !== "false"
      ? await collectInBatches(
          selectedScopes
            .filter((scope) => missingProviders(scope).length > 0)
            .map(
              (scope) => () =>
                (managedSource
                  ? collectSerpApiHotelPrices
                  : collectGoogleHotelPrices)(scope, missingProviders(scope)),
            ),
          managedSource ? 1 : 2,
        )
      : [];
  warnings.push(...secondaryResults.flatMap((result) => result.warnings));

  const uniqueWarnings = [...new Set(warnings)];

  const report = buildBenchmarkResult({
    mode: resolvedRequest.mode,
    warnings: uniqueWarnings,
    scopes: selectedScopes,
    providers: selectedProviders,
    quotes,
    offers: collectionResults.flatMap((result) => result.offers ?? []),
    providersByScope: plan.providersByScope,
  });
  return {
    ...report,
    summary: {
      ...report.summary,
      secondaryOfferCount: supplementary.secondaryOffers.length,
    },
    secondaryOffers: supplementary.secondaryOffers,
    hotelPrices: secondaryResults.flatMap((result) => result.hotelPrices),
  };
}
