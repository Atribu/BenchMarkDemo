
import type {
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";

import { createPatchrightBrowserPage } from "./patchright-browser";
import { parseAnexTourOffers } from "./anextour-parser";
import { buildManualReviewQuotes } from "./live-helpers";
import { ANEX_HOTEL_CONFIG } from "./live-config";
import { classifyRoom } from "./offer-matching";

function normalizeRoomName(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchAnexRoom(
  scope: ReportScopeDefinition,
  roomName: string,
): ReportScopeDefinition["rooms"][number] | undefined {
  const config = ANEX_HOTEL_CONFIG[scope.hotelKey];
  if (!config) return undefined;
  const normalizedName = normalizeRoomName(roomName);
  const rule = config.roomMatchers.find((candidate) =>
    candidate.patterns.some((pattern) => pattern.test(normalizedName)),
  );
  return scope.rooms.find((room) => room.id === rule?.roomId);
}

function buildAnexUrl(
  accommodationId: string,
  checkIn: string,
  checkOut: string,
  nights: number,
): string {
  const url = new URL(
    "https://nurhotel.anextour.de/search/offer",
  );

  url.searchParams.set("aid", accommodationId);
  url.searchParams.set("dur", String(nights));
  url.searchParams.set("ibe", "hotel");
  url.searchParams.set("ddate", checkIn);
  url.searchParams.set("rdate", checkOut);
  url.searchParams.set("adult", "2");

  return url.toString();
}

function compactDate(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

interface AnexRuOffer {
  roomName: string;
  board: string;
  price: number;
}

export function parseAnexRuOffers(
  response: unknown,
  expected: {
    hotelId: string;
    checkIn: string;
    checkOut: string;
    nights: number;
  },
): AnexRuOffer[] {
  const candidates: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (
      item.converted_price !== undefined &&
      (item.roomName || item.roomLName)
    ) {
      candidates.push(item);
      return;
    }
    Object.values(item).forEach(visit);
  };
  visit(response);

  const seen = new Set<string>();
  return candidates.flatMap((item) => {
    const price = Number(item.converted_price);
    const roomName = String(item.roomName ?? item.roomLName ?? "").trim();
    const board = String(item.mealName ?? item.mealLName ?? "").trim();
    const hotelId = String(item.hotelInc ?? item.hotelId ?? "");
    const nights = Number(item.nights);
    const adult = item.adult === undefined ? 2 : Number(item.adult);
    const key = `${roomName}|${board}|${price}`;

    if (
      hotelId !== expected.hotelId ||
      compactDate(item.checkIn) !== compactDate(expected.checkIn) ||
      compactDate(item.checkOut) !== compactDate(expected.checkOut) ||
      nights !== expected.nights ||
      adult !== 2 ||
      !roomName ||
      !board ||
      !Number.isFinite(price) ||
      price <= 0 ||
      seen.has(key)
    ) {
      return [];
    }
    seen.add(key);
    return [{ roomName, board, price }];
  });
}

function buildAnexRuUrl(
  hotelId: string,
  hotelSlug: string,
  checkIn: string,
  checkOut: string,
): string {
  const url = new URL(
    `https://anextour.ru/hotels/turkey/${hotelSlug}`,
  );
  const params = {
    ADULT: "2",
    CHILD: "0",
    CURRENCY: "1",
    PRICE_PAGE: "1",
    RECONPAGE: "500",
    REGULAR: "True",
    SORT_TYPE: "0",
    STATEINC: "3",
    THE_BEST_AT_TOP: "True",
    TOWNFROM: "moskva",
    CHARTER: "True",
    FILTER: "1",
    FREIGHT: "1",
    HOTELLIST: hotelId,
    CHECKIN_BEG: compactDate(checkIn),
    CHECKIN_END: compactDate(checkOut),
    STATEFROM: "2",
    SEARCH_TYPE: "PACKET_ONLY_HOTELS",
  };
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return url.toString();
}

async function collectAnexRuLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const hotelConfig = ANEX_HOTEL_CONFIG[scope.hotelKey];
  const hotelId = hotelConfig?.ruHotelId;
  const hotelSlug = hotelConfig?.ruHotelSlug;
  if (!hotelId || !hotelSlug) {
    return buildManualReviewQuotes(
      provider,
      scope,
      "https://anextour.ru/hotels/",
      "ANEX Rusya otel kimliği doğrulanmadı.",
    );
  }

  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];

  for (const window of scope.windows) {
    const sourceHint = buildAnexRuUrl(
      hotelId,
      hotelSlug,
      window.checkIn,
      window.checkOut,
    );
    let handle: Awaited<ReturnType<typeof createPatchrightBrowserPage>> | undefined;
    try {
      handle = await createPatchrightBrowserPage({
        profilePath: `./.benchmark-state/anextour-ru-${scope.id}-${process.pid}`,
        headless: false,
        market: "ru",
        proxyUrl: process.env.ANEXTOUR_RU_PROXY_URL || undefined,
      });
      const { page } = handle;
      const searchResponsePromise = page.waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            response.request().method() === "GET" &&
            url.origin === "https://api.anextour.ru" &&
            url.pathname === "/search"
          );
        },
        { timeout: 60_000 },
      );
      const navigation = await page.goto(sourceHint, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      if (!navigation || navigation.status() !== 200) {
        throw new Error(`ANEX Rusya ana sayfa HTTP ${navigation?.status() ?? "unknown"}`);
      }
      const response = await searchResponsePromise;
      if (response.status() !== 200) {
        throw new Error(`ANEX Rusya teklif servisi HTTP ${response.status()}`);
      }
      const requestUrl = new URL(response.url());
      if (
        requestUrl.searchParams.get("HOTELLIST") !== hotelId ||
        requestUrl.searchParams.get("SEARCH_TYPE") !== "PACKET_ONLY_HOTELS" ||
        requestUrl.searchParams.get("CURRENCY") !== "1" ||
        requestUrl.searchParams.get("ADULT") !== "2" ||
        requestUrl.searchParams.get("CHILD") !== "0" ||
        requestUrl.searchParams.get("checkIn") !== compactDate(window.checkIn) ||
        requestUrl.searchParams.get("checkOut") !== compactDate(window.checkOut)
      ) {
        throw new Error("ANEX Rusya API arama koşulları benchmark kriterleriyle eşleşmiyor.");
      }
      const parsed = parseAnexRuOffers(await response.json(), {
        hotelId,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
      });

      const observedAt = new Date().toISOString();
      const windowOffers = parsed.map((offer, index): CollectedOffer => {
        const matchedRoom = matchAnexRoom(scope, offer.roomName);
        return {
          id: `anextour-ru:${scope.id}:${window.id}:${index}`,
          providerKey: provider.key,
          scopeKey: scope.id,
          windowId: window.id,
          checkIn: window.checkIn,
          checkOut: window.checkOut,
          nights: window.nights,
          rooms: 1,
          adults: 2,
          price: offer.price,
          currency: "RUB",
          roomName: offer.roomName,
          roomFeatures: classifyRoom(offer.roomName),
          terms: {
            board: offer.board,
            cancellation: "Kaynakta doğrulanmalı",
            taxes: "Kaynakta doğrulanmalı",
            operator: "ANEX Tour Russia",
            availability: "ANEX Rusya hotel-only API yanıtında listelendi",
          },
          sourceHint,
          observedAt,
          matchedRoomId: matchedRoom?.id,
          matchReason: matchedRoom
            ? "ANEX Rusya oda kategorisi eşleşti; tarife koşulları ayrıca kontrol edilmeli."
            : "Oda kategorisi güvenle eşleştirilemedi.",
        };
      });
      offers.push(...windowOffers);
      for (const room of scope.rooms) {
        const best = windowOffers
          .filter((offer) => offer.matchedRoomId === room.id)
          .sort((a, b) => a.price - b.price)[0];
        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: best?.price ?? null,
          currency: "RUB",
          status: best ? "available" : parsed.length ? "manual-review" : "sold_out",
          dataMode: "live",
          captureMethod: "automated",
          observedAt,
          sourceHint,
          offerDescription: best?.roomName,
          roomFeatures: best?.roomFeatures,
          terms: best?.terms,
          offerConditions: best
            ? `${best.terms.board}; ANEX Rusya; ${window.nights} gece; 1 oda / 2 yetişkin; RUB toplam fiyat.`
            : undefined,
          reason: best
            ? undefined
            : parsed.length
              ? "ANEX Rusya teklifleri bulundu ancak bu oda kategorisi güvenle eşleştirilemedi."
              : "ANEX Rusya tamamlanan hotel-only aramasında bu tarihler için teklif döndürmedi.",
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      warnings.push(`ANEX Rusya / ${scope.hotelName} / ${window.checkIn}: ${reason}`);
      quotes.push(
        ...scope.rooms.map((room): ProviderQuote => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: null,
          currency: "RUB",
          status: "manual-review",
          dataMode: "live",
          sourceHint,
          reason,
        })),
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
  return { quotes, offers, warnings };
}

export async function collectAnexTourLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  if (scope.currency === "RUB") {
    return collectAnexRuLiveQuotes(provider, scope);
  }
  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];

  const hotelConfig = ANEX_HOTEL_CONFIG[scope.hotelKey];
  const accommodationId = hotelConfig?.accommodationId;

  if (!accommodationId || scope.currency !== "EUR") {
    return buildManualReviewQuotes(
      provider,
      scope,
      "https://nurhotel.anextour.de/",
      "ANEX Tour için bu otelin kimliği veya EUR kapsamı henüz doğrulanmadı.",
    );
  }

  for (const window of scope.windows) {
    const sourceHint = buildAnexUrl(
      accommodationId,
      window.checkIn,
      window.checkOut,
      window.nights,
    );

    let handle:
      | Awaited<ReturnType<typeof createPatchrightBrowserPage>>
      | undefined;

    try {
      handle = await createPatchrightBrowserPage({
        profilePath: `./.benchmark-state/anextour-${scope.id}`,
        headless: false,
        market: "de",
      });

      const page = handle.page;

      // Dinleyiciyi navigasyondan önce başlatıyoruz.
      // Convert listener rejection into a value immediately. If navigation
      // itself fails and the browser closes, the pending listener must not
      // become an unhandled rejection after the collector has returned.
      const listResponsePromise = page
        .waitForResponse(
          (response) => {
            const request = response.request();
            const pathname = new URL(response.url()).pathname;

            return (
              response.url().startsWith(
                "https://nurhotel.anextour.de/",
              ) &&
              pathname === "/api/search/offers/list" &&
              request.method() === "POST"
            );
          },
          { timeout: 45_000 },
        )
        .then(
          (response) => ({ response }),
          (error: unknown) => ({ error }),
        );

      const navigation = await page.goto(sourceHint, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      if (!navigation || navigation.status() !== 200) {
        throw new Error(
          `ANEX navigasyon başarısız: HTTP ${navigation?.status() ?? "unknown"}`,
        );
      }

      const listResponseResult = await listResponsePromise;
      if ("error" in listResponseResult) {
        throw listResponseResult.error;
      }
      const listResponse = listResponseResult.response;

      if (listResponse.status() !== 200) {
        throw new Error(
          `ANEX teklif servisi HTTP ${listResponse.status()}`,
        );
      }

      const requestPayload = listResponse
        .request()
        .postDataJSON();

      // API isteğinin gerçekten paneldeki aramaya ait
      // olduğunu fiyatları okumadan önce doğruluyoruz.
      if (
        requestPayload?.dates?.start !== window.checkIn ||
        requestPayload?.dates?.end !== window.checkOut ||
        requestPayload?.durations?.days?.[0] !== window.nights ||
        !requestPayload?.accommodations?.ids?.includes(
          accommodationId,
        ) ||
        requestPayload?.ageOfPersons?.adults?.length !== 2 ||
        requestPayload?.ageOfPersons?.children?.length > 0
      ) {
        throw new Error(
          "ANEX API arama koşulları benchmark kriterleriyle eşleşmiyor.",
        );
      }

      const responseJson = await listResponse.json();

      const parsedOffers = parseAnexTourOffers(responseJson, {
        accommodationId,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
      });

      console.log("[ANEX] Collection:", {
        hotel: scope.hotelName,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
        verifiedOffers: parsedOffers.length,
      });

      const collectedAt = new Date().toISOString();
      const confirmedEmpty = parsedOffers.length === 0;

      const matchedOffers = parsedOffers.map((offer, index) => {
        const matchedRoom = matchAnexRoom(scope, offer.roomName);

        const collected: CollectedOffer = {
          id: `anextour:${scope.id}:${window.id}:${index}`,
          providerKey: "anextour",
          scopeKey: scope.id,
          windowId: window.id,
          checkIn: offer.checkIn,
          checkOut: offer.checkOut,
          nights: offer.nights,
          rooms: 1,
          adults: 2,
          price: offer.price,
          currency: "EUR",
          roomName: offer.roomName,
          roomFeatures: classifyRoom(offer.roomName),
          terms: {
            board: offer.board,
            cancellation: "Kaynakta doğrulanmalı",
            taxes: "Kaynakta doğrulanmalı",
            operator: "ANEX Tour",
            availability: "Teklif yanıtında listelendi",
          },
          sourceHint,
          observedAt: collectedAt,
          matchedRoomId: matchedRoom?.id,
          matchReason: matchedRoom
            ? "ANEX oda kategorisi eşleşti; tarife koşulları ayrıca kontrol edilmeli."
            : "Oda kategorisi güvenle eşleştirilemedi.",
        };

        return collected;
      });

      offers.push(...matchedOffers);

      for (const room of scope.rooms) {
        const matching = matchedOffers
          .filter((offer) => offer.matchedRoomId === room.id)
          .sort((a, b) => a.price - b.price);

        const best = matching[0];

        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: best?.price ?? null,
          currency: scope.currency,
          status: best
            ? "available"
            : confirmedEmpty
              ? "sold_out"
              : "manual-review",
          dataMode: "live",
          captureMethod: "automated",
          observedAt: collectedAt,
          sourceHint,
          offerDescription: best?.roomName,
          roomFeatures: best?.roomFeatures,
          terms: best?.terms,
          offerConditions: best
            ? `${best.terms.board}; ANEX Tour; ${window.nights} gece; 1 oda / 2 yetişkin; EUR toplam fiyat; iptal ve vergi koşulları ayrıca doğrulanmalı.`
            : undefined,
          reason: best
            ? undefined
            : confirmedEmpty
              ? "ANEX Tour tamamlanan aramada bu tarihler için doğrulanmış uçaksız teklif döndürmedi; bu, otelin diğer kanallarda kapalı olduğu anlamına gelmez."
              : "ANEX Tour teklifleri bulundu ancak bu oda kategorisi güvenle eşleştirilemedi.",
        });
      }

      if (confirmedEmpty) {
        warnings.push(
          `ANEX Tour / ${scope.hotelName} / ${window.checkIn}: Tamamlanan aramada doğrulanmış ANEX uçaksız teklifi yok.`,
        );
      }
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message.split("\n")[0]
          : "ANEX Tour fiyatları doğrulanamadı.";

      warnings.push(
        `ANEX Tour / ${scope.hotelName} / ${window.checkIn}: ${reason}`,
      );

      quotes.push(
        ...scope.rooms.map(
          (room): ProviderQuote => ({
            providerKey: provider.key,
            scopeKey: scope.id,
            roomId: room.id,
            windowId: window.id,
            price: null,
            currency: scope.currency,
            status: "manual-review",
            dataMode: "live",
            sourceHint,
            reason,
          }),
        ),
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  return { quotes, warnings, offers };
}
