import type {
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition
} from "@/src/lib/benchmark/types";
import { HOLIDAYCHECK_HOTEL_CONFIG } from "@/src/lib/ota/live-config";
import {
  buildManualReviewQuotes,
  createBrowserPage,
  normalizeInlineText,
  resolveProviderLiveConfig
} from "@/src/lib/ota/live-helpers";

interface HolidayCheckDateValue {
  day?: number;
  month?: number;
  year?: number;
  formatted?: string;
}

interface HolidayCheckOffer {
  travelkind?: string;
  type?: string;
  totalPrice?: {
    amount?: number;
    currency?: string;
  };
  room?: {
    description?: string;
    name?: string;
  };
  rooms?: Array<{
    description?: string;
    name?: string;
  }>;
  departureDate?: HolidayCheckDateValue | string | null;
  returnDate?: HolidayCheckDateValue | string | null;
  stayStartDate?: HolidayCheckDateValue | string | null;
  stayEndDate?: HolidayCheckDateValue | string | null;
}

interface HolidayCheckPageState {
  offers: HolidayCheckOffer[];
  bodyText: string;
}

interface HolidayCheckWindowState extends HolidayCheckPageState {
  apiStatus: number | null;
  currentUrl: string;
  title: string;
}

interface HolidayCheckRoomCandidate {
  offer: HolidayCheckOffer;
  roomText: string;
  score: number;
}

interface HolidayCheckRoomProfile {
  requiredGroups: string[][];
  optionalGroups: string[][];
  blockedKeywords: string[];
}

const HOLIDAYCHECK_ROOM_PROFILES: Partial<
  Record<ReportScopeDefinition["rooms"][number]["id"], HolidayCheckRoomProfile>
> = {
  "superior-land": {
    requiredGroups: [["landseite", "land", "garden", "inland"]],
    optionalGroups: [["superior"], ["doppelzimmer", "zimmer", "room"]],
    blockedKeywords: ["meerblick", "see", "sea", "ocean", "seitlicher meerblick"]
  },
  "superior-sea": {
    requiredGroups: [["meerblick", "sea", "ocean", "seitlicher meerblick", "side sea"]],
    optionalGroups: [["superior"], ["doppelzimmer", "zimmer", "room"]],
    blockedKeywords: ["landseite", "land", "garden", "inland"]
  },
  "standard-land": {
    requiredGroups: [["landseite", "land", "garden", "inland", "economy", "sparzimmer"]],
    optionalGroups: [["standard", "doppelzimmer", "zimmer", "room", "economy"]],
    blockedKeywords: ["meerblick", "see", "sea", "ocean", "seitlicher meerblick"]
  },
  "standard-sea": {
    requiredGroups: [["meerblick", "sea", "ocean", "seitlicher meerblick", "side sea"]],
    optionalGroups: [["standard", "doppelzimmer", "zimmer", "room"]],
    blockedKeywords: ["landseite", "land", "garden", "inland", "economy", "sparzimmer"]
  }
};

function buildQuote(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  windowId: string,
  roomId: string,
  sourceHint: string,
  status: ProviderQuote["status"],
  price: number | null = null
): ProviderQuote {
  return {
    providerKey: provider.key,
    scopeKey: scope.id,
    roomId,
    windowId,
    price,
    currency: scope.currency,
    status,
    dataMode: "live",
    sourceHint
  };
}

function normalizeHolidayCheckDate(
  value: HolidayCheckOffer["departureDate"] | HolidayCheckOffer["stayStartDate"]
): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const isoLike = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(isoLike) ? isoLike : null;
  }

  if (typeof value.year === "number" && typeof value.month === "number" && typeof value.day === "number") {
    return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  }

  if (value.formatted) {
    const match = value.formatted.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
  }

  return null;
}

function resolveOfferRoomText(offer: HolidayCheckOffer): string {
  return normalizeInlineText(
    offer.room?.description ??
      offer.room?.name ??
      offer.rooms?.map((room) => room.description ?? room.name ?? "").join(" ") ??
      ""
  );
}

function extractHolidayCheckOffers(payload: unknown): HolidayCheckOffer[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const responseData =
    "data" in payload && payload.data && typeof payload.data === "object"
      ? (payload.data as { offers?: unknown[] })
      : null;

  return Array.isArray(responseData?.offers)
    ? (responseData.offers as HolidayCheckOffer[])
    : [];
}

function normalizeComparableText(text: string): string {
  return normalizeInlineText(text)
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeComparableText(text: string): string[] {
  return normalizeComparableText(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function includesAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(normalizeComparableText(keyword)));
}

function scoreAliasMatch(normalizedRoomText: string, roomTokens: Set<string>, aliases: string[]) {
  let score = 0;

  for (const alias of aliases) {
    const normalizedAlias = normalizeComparableText(alias);

    if (!normalizedAlias) {
      continue;
    }

    if (normalizedRoomText.includes(normalizedAlias)) {
      score += 10;
    }

    const aliasTokens = tokenizeComparableText(alias);
    const matchedTokenCount = aliasTokens.filter((token) => roomTokens.has(token)).length;

    if (matchedTokenCount > 0) {
      score += matchedTokenCount * 2;
    }

    if (aliasTokens.length > 1 && matchedTokenCount === aliasTokens.length) {
      score += 4;
    }
  }

  return score;
}

function scoreProfileMatch(
  roomId: ReportScopeDefinition["rooms"][number]["id"],
  normalizedRoomText: string,
  roomTokens: Set<string>
) {
  const profile = HOLIDAYCHECK_ROOM_PROFILES[roomId];

  if (!profile) {
    return 0;
  }

  let score = 0;

  for (const group of profile.requiredGroups) {
    const hasGroupMatch = group.some((keyword) => normalizedRoomText.includes(normalizeComparableText(keyword)));

    if (hasGroupMatch) {
      score += 6;
    } else {
      score -= 8;
    }
  }

  for (const group of profile.optionalGroups) {
    const matchedCount = group.filter((keyword) => roomTokens.has(normalizeComparableText(keyword))).length;
    score += matchedCount * 2;
  }

  if (includesAnyKeyword(normalizedRoomText, profile.blockedKeywords)) {
    score -= 10;
  }

  return score;
}

function scoreRoomCandidate(
  roomId: ReportScopeDefinition["rooms"][number]["id"],
  roomText: string,
  aliases: string[]
): number {
  const normalizedRoomText = normalizeComparableText(roomText);
  const roomTokens = new Set(tokenizeComparableText(roomText));

  return (
    scoreAliasMatch(normalizedRoomText, roomTokens, aliases) +
    scoreProfileMatch(roomId, normalizedRoomText, roomTokens)
  );
}

function findRoomCandidates(
  offers: HolidayCheckOffer[],
  roomId: ReportScopeDefinition["rooms"][number]["id"],
  aliases: string[]
): HolidayCheckRoomCandidate[] {
  return offers
    .map((offer) => {
      const roomText = resolveOfferRoomText(offer);

      return {
        offer,
        roomText,
        score: scoreRoomCandidate(roomId, roomText, aliases)
      };
    })
    .filter((candidate) => candidate.score >= 6)
    .sort((left, right) => right.score - left.score);
}

async function readHolidayCheckPageState(
  page: Awaited<ReturnType<typeof createBrowserPage>>["page"]
): Promise<HolidayCheckPageState> {
  return page.evaluate(() => {
    const state = (window as { __FLUXIBLE_STATE__?: unknown }).__FLUXIBLE_STATE__;
    const stores =
      state &&
      typeof state === "object" &&
      "dispatcher" in state &&
      (state as {
        dispatcher?: {
          stores?: Record<string, unknown>;
        };
      }).dispatcher?.stores
        ? (state as {
            dispatcher: {
              stores: Record<string, unknown>;
            };
          }).dispatcher.stores
        : {};
    const hotelOfferStore = stores.HotelOfferStore as
      | {
          offers?: unknown[];
        }
      | undefined;

    return {
      offers: Array.isArray(hotelOfferStore?.offers)
        ? (hotelOfferStore?.offers as HolidayCheckOffer[])
        : [],
      bodyText: document.body?.innerText ?? ""
    };
  });
}

function buildHolidayCheckHotelOnlyUrl(
  pageUrl: string,
  checkIn: string,
  checkOut: string
): string | null {
  const match = pageUrl.match(
    /^https:\/\/www\.holidaycheck\.de\/hi\/([^/]+)\/([a-f0-9-]+)\/?$/i
  );

  if (!match) {
    return null;
  }

  const [, slug, hotelId] = match;

  return `https://www.holidaycheck.de/ho/angebote-${slug}/${hotelId}/hotelonly?_offer=departureDate:${checkIn},duration:exactly,returnDate:${checkOut},rooms:a-a`;
}

async function readHolidayCheckWindowState(
  page: Awaited<ReturnType<typeof createBrowserPage>>["page"],
  offerUrl: string
): Promise<HolidayCheckWindowState> {
  const allOffersResponsePromise = page
    .waitForResponse(
      (response) => response.url().includes("holidaycheck.de/api/all-offers-service"),
      {
        timeout: 25000
      }
    )
    .catch(() => null);

  await page.goto(offerUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForTimeout(5000);

  const allOffersResponse = await allOffersResponsePromise;
  const apiOffers =
    allOffersResponse && allOffersResponse.ok()
      ? extractHolidayCheckOffers(await allOffersResponse.json().catch(() => null))
      : [];
  const pageState = await readHolidayCheckPageState(page);

  return {
    offers: apiOffers.length ? apiOffers : pageState.offers,
    bodyText: pageState.bodyText,
    apiStatus: allOffersResponse?.status() ?? null,
    currentUrl: page.url(),
    title: await page.title()
  };
}

export async function collectHolidayCheckLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition
): Promise<ProviderCollectionResult> {
  const config = HOLIDAYCHECK_HOTEL_CONFIG[scope.hotelKey];

  if (!config) {
    return buildManualReviewQuotes(
      provider,
      scope,
      "",
      `HolidayCheck icin ${scope.hotelName} mapping'i bulunamadi.`
    );
  }

  let browserHandle: Awaited<ReturnType<typeof createBrowserPage>> | null = null;
  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];
  const liveConfig = resolveProviderLiveConfig("holidaycheck");

  try {
    browserHandle = await createBrowserPage(liveConfig);

    for (const window of scope.windows) {
      const offerUrl = buildHolidayCheckHotelOnlyUrl(
        config.pageUrl,
        window.checkIn,
        window.checkOut
      );

      if (!offerUrl) {
        warnings.push(
          `HolidayCheck hotel-only URL'i olusturulamadi: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...scope.rooms.map((room) =>
            buildQuote(provider, scope, window.id, room.id, config.pageUrl, "manual-review")
          )
        );
        continue;
      }

      const windowState = await readHolidayCheckWindowState(browserHandle.page, offerUrl);
      const sourceHint = windowState.currentUrl || offerUrl;

      if (
        /captcha|blocked|challenge/i.test(windowState.title) ||
        !windowState.currentUrl.includes("holidaycheck.de")
      ) {
        warnings.push(
          `HolidayCheck sayfasi challenge veya beklenmeyen redirect verdi: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...scope.rooms.map((room) =>
            buildQuote(provider, scope, window.id, room.id, sourceHint, "manual-review")
          )
        );
        continue;
      }

      if (!windowState.offers.length) {
        const bodyText = windowState.bodyText.toLowerCase();
        const soldOutSignal =
          windowState.apiStatus === 200 ||
          /kein angebot gefunden|leider kein angebot|keine angebote|nicht verfugbar/.test(
            bodyText
          );

        warnings.push(
          soldOutSignal
            ? `HolidayCheck ${window.label} icin hotel-only teklif dondurmedi: ${scope.label}`
            : `HolidayCheck all-offers-service sonucu alinamadi: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...scope.rooms.map((room) =>
            buildQuote(
              provider,
              scope,
              window.id,
              room.id,
              sourceHint,
              soldOutSignal ? "sold_out" : "manual-review"
            )
          )
        );
        continue;
      }

      const roomSample = windowState.offers
        .slice(0, 4)
        .map((offer) => resolveOfferRoomText(offer))
        .filter((text) => text.length > 0)
        .join(" | ");

      for (const room of scope.rooms) {
        const aliases = config.roomAliases[room.id] ?? [room.name];
        const roomOffers = findRoomCandidates(windowState.offers, room.id, aliases);

        if (!roomOffers.length) {
          warnings.push(
            `HolidayCheck hotel-only sonucunda ${room.name} icin room eslesmesi cikmadi: ${scope.label} / ${window.label}${roomSample ? ` / mevcut odalar: ${roomSample}` : ""}`
          );
          quotes.push(
            buildQuote(provider, scope, window.id, room.id, sourceHint, "manual-review")
          );
          continue;
        }

        const exactWindowOfferCandidate = roomOffers.find(({ offer }) => {
          const start =
            normalizeHolidayCheckDate(offer.stayStartDate) ??
            normalizeHolidayCheckDate(offer.departureDate);
          const end =
            normalizeHolidayCheckDate(offer.stayEndDate) ??
            normalizeHolidayCheckDate(offer.returnDate);

          return start === window.checkIn && end === window.checkOut;
        });

        const exactWindowOffer = exactWindowOfferCandidate?.offer;

        if (!exactWindowOffer) {
          warnings.push(
            `HolidayCheck room bulundu ama ${window.label} ile exact tarih eslesmedi: ${scope.label} / ${room.name}`
          );
          quotes.push(
            buildQuote(provider, scope, window.id, room.id, sourceHint, "manual-review")
          );
          continue;
        }

        const totalPrice = exactWindowOffer.totalPrice?.amount;

        if (typeof totalPrice !== "number") {
          warnings.push(
            `HolidayCheck exact-date offer bulundu ama fiyat okunamadi: ${scope.label} / ${room.name} / ${window.label}`
          );
          quotes.push(
            buildQuote(provider, scope, window.id, room.id, sourceHint, "manual-review")
          );
          continue;
        }

        if (exactWindowOffer.travelkind === "hotelonly") {
          quotes.push(
            buildQuote(
              provider,
              scope,
              window.id,
              room.id,
              sourceHint,
              "available",
              totalPrice
            )
          );
          continue;
        }

        warnings.push(
          `HolidayCheck exact-date offer bulundu ama su an ${exactWindowOffer.travelkind ?? exactWindowOffer.type ?? "unknown"} tipinde. Fiyat manual-review olarak isaretlendi: ${scope.label} / ${room.name} / ${window.label}`
        );
        quotes.push(
          buildQuote(
            provider,
            scope,
            window.id,
            room.id,
            sourceHint,
            "manual-review",
            totalPrice
          )
        );
      }
    }
  } catch (error) {
    return buildManualReviewQuotes(
      provider,
      scope,
      config.pageUrl,
      `HolidayCheck live collector hatasi: ${
        error instanceof Error ? error.message : "bilinmeyen hata"
      }`
    );
  } finally {
    if (browserHandle) {
      await browserHandle.browser.close().catch(() => undefined);
    }
  }

  return {
    quotes,
    warnings
  };
}
