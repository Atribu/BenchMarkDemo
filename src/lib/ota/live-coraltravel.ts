import type {
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";
import { createPatchrightBrowserPage } from "./patchright-browser";
import { buildManualReviewQuotes } from "./live-helpers";
import { deduplicateOffers, selectOfferQuotes } from "./offer-matching";
import { matchCoralTravelRoom } from "./coraltravel-rooms";
import { searchCoralTravel } from "./coraltravel-search";

const HOME = "https://coraltravel.de/";
const HOTEL_IDS = { "miramare-beach": "4893" } as const;

type ApiOffer = {
  productType?: string;
  flightOffer?: unknown;
  tourOperator?: { code?: string };
  hotelOffer?: {
    hotel?: { giata?: { hotelId?: string | number } };
    roomType?: { originalCode?: string; originalName?: string; name?: string };
    boardType?: { code?: string; name?: string };
  };
  travelDate?: { fromDate?: string; toDate?: string; duration?: string | number };
  totalPrice?: { value?: string | number; currency?: string };
  personPrice?: { value?: string | number; currency?: string };
  id?: string | number;
};

type ApiPayload = { offerList?: ApiOffer[]; totalResultCount?: string | number };

function parseOffers(
  data: unknown,
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: ReportScopeDefinition["windows"][number],
  sourceHint: string,
): CollectedOffer[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as ApiPayload).offerList)) return [];
  const result = data as ApiPayload;
  const expectedHotel = HOTEL_IDS["miramare-beach"];
  const resultOffers: CollectedOffer[] = [];
  for (const [index, offer] of (result.offerList ?? []).entries()) {
    if (offer.productType?.toLowerCase() !== "hotelonly" || offer.flightOffer != null) continue;
    if (offer.tourOperator?.code !== "COR") continue;
    if (String(offer.hotelOffer?.hotel?.giata?.hotelId ?? "") !== expectedHotel) continue;
    if (offer.travelDate?.fromDate !== window.checkIn || offer.travelDate?.toDate !== window.checkOut) continue;
    if (Number(offer.travelDate?.duration) !== window.nights) continue;
    if (offer.totalPrice?.currency !== "EUR") continue;
    const price = Number(offer.totalPrice.value);
    if (!Number.isFinite(price) || price <= 0) continue;

    const roomCode = offer.hotelOffer?.roomType?.originalCode?.trim();
    const roomName = offer.hotelOffer?.roomType?.originalName?.trim();
    const boardName = offer.hotelOffer?.boardType?.name?.trim();
    const boardCode = offer.hotelOffer?.boardType?.code?.trim() ?? "";
    if (!roomCode || !roomName || !boardName) continue;
    if (!/all inclusive|ultra|ai\b/i.test(boardName)) continue;
    if (scope.requiredBoard === "all-inclusive-plus" && !/ultra|plus|premium/i.test(boardName)) continue;

    const match = matchCoralTravelRoom(scope, roomCode, roomName);
    const observedAt = new Date().toISOString();
     resultOffers.push({
      id: `coraltravel:${scope.id}:${window.id}:${roomCode}:${index}`,
      sourceOfferId: offer.id === undefined ? undefined : String(offer.id),
      sourceProductCode: roomCode,
      sourceBoardCode: boardCode,
      providerKey: provider.key,
      scopeKey: scope.id,
      windowId: window.id,
      checkIn: window.checkIn,
      checkOut: window.checkOut,
      nights: window.nights,
      rooms: 1,
      adults: 2,
      price,
      currency: "EUR",
      roomName,
      roomFeatures: match.features,
      terms: {
        board: boardName,
        cancellation: "Kaynakta doğrulanmalı",
        taxes: "Kaynakta doğrulanmalı",
        operator: "Coral Travel (COR)",
        availability: "CoralTravel teklif API yanıtında listelendi; rezervasyon teyidi değildir",
      },
      sourceHint,
      observedAt,
      matchedRoomId: match.matchedRoomId,
      matchReason: match.reason,
    });
  }
  return resultOffers;
}

export async function collectCoralTravelLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  // Queen is intentionally disabled until its GIATA ID, room codes, and form
  // selection are confirmed in a real capture.
  if (scope.hotelKey !== "miramare-beach" || scope.currency !== "EUR") {
    return buildManualReviewQuotes(provider, scope, HOME,
      "CoralTravel: bu otel için gerçek API otel kimliği ve oda kodları henüz doğrulanmadı.");
  }

  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];

  for (const window of scope.windows) {
    let handle: Awaited<ReturnType<typeof createPatchrightBrowserPage>> | undefined;
    let sourceHint = HOME;
    try {
      handle = await createPatchrightBrowserPage({
        profilePath: `./.benchmark-state/coraltravel-${scope.id}-${process.pid}`,
        headless: false,
        market: "de",
        proxyUrl: process.env.CORALTRAVEL_PROXY_URL || undefined,
      });
      const { page, context } = handle;
      const payloads: unknown[] = [];
      const pending = new Set<Promise<void>>();
      let totalResultCount: number | undefined;

      context.on("response", (response) => {
        if (response.request().method() !== "POST" ||
            new URL(response.url()).pathname !== "/api/trafics/offers" ||
            response.status() !== 200) return;
        const pendingRead = (async () => {
          const data: unknown = await response.json();
          if (!data || typeof data !== "object" || !Array.isArray((data as ApiPayload).offerList)) return;
          payloads.push(data);
          const total = Number((data as ApiPayload).totalResultCount);
          if (Number.isFinite(total)) totalResultCount = Math.max(totalResultCount ?? 0, total);
        })().catch((error: unknown) => {
          warnings.push(`CoralTravel teklif JSON okunamadı: ${String(error)}`);
        });
        pending.add(pendingRead);
        void pendingRead.finally(() => pending.delete(pendingRead));
      });

      const firstOffers = page.waitForResponse(
        (response) => response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/trafics/offers" &&
          response.status() === 200,
        { timeout: 45_000 },
      );

      const navigation = await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (!navigation || navigation.status() !== 200) throw new Error(`Ana sayfa HTTP ${navigation?.status()}`);
      await page.getByRole("button", { name: "Ablehnen", exact: true })
        .click({ timeout: 5_000 }).catch(() => undefined);

      await searchCoralTravel(page, scope.hotelKey, window.checkIn, window.checkOut);
      await firstOffers;
      sourceHint = page.url();
      // Both 12-item and 10-item partial results were observed after search.
      // Wait briefly for both without relying on networkidle (analytics never idles).
      await page.waitForTimeout(1_500);
      await Promise.allSettled([...pending]);

      const windowOffers = deduplicateOffers(payloads.flatMap((payload) =>
        parseOffers(payload, provider, scope, window, sourceHint)));
      if (!windowOffers.length) throw new Error("Doğrulanmış otel-only COR teklifi bulunamadı.");

      offers.push(...windowOffers);
      quotes.push(...selectOfferQuotes(provider, scope, window, windowOffers, sourceHint));

      if (totalResultCount !== undefined && totalResultCount > windowOffers.length) {
        warnings.push(`CoralTravel ${scope.hotelName} ${window.checkIn}: API toplamı ${totalResultCount}, ` +
          `tekilleştirilmiş gözlenen teklif ${windowOffers.length}. Pagination doğrulanmadı; sonuçlar eksik olabilir.`);
      }
      warnings.push(`CoralTravel ${scope.hotelName} ${window.checkIn}: API teklifleri görüldü; ` +
        "1 oda / 2 yetişkin kişi sayısı yanıt içinden ayrıca doğrulanmadı. " +
        "İptal ve vergi koşulları karşılaştırılmadan fiyat paritesi kesin sayılmamalı.");
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      warnings.push(`CoralTravel ${scope.hotelName} ${window.checkIn}: ${reason}`);
      quotes.push(...scope.rooms.map((room): ProviderQuote => ({
        providerKey: provider.key, scopeKey: scope.id, windowId: window.id,
        roomId: room.id, price: null, currency: scope.currency,
        status: "manual-review", dataMode: "live", sourceHint, reason,
      })));
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  console.log("[CORALTRAVEL] Final collection:", {
  hotel: scope.hotelName,
  scope: scope.id,
  totalOffers: offers.length,
  matchedOffers: offers.filter(
    (offer) => Boolean(offer.matchedRoomId),
  ).length,
  availableQuotes: quotes.filter(
    (quote) => quote.status === "available",
  ).length,
  manualReviewQuotes: quotes.filter(
    (quote) => quote.status === "manual-review",
  ).length,
  warnings,
});

console.table(
  quotes.map((quote) => ({
    room: quote.roomId,
    status: quote.status,
    price: quote.price,
    currency: quote.currency,
    reason: quote.reason,
  })),
);

  return { quotes, offers, warnings };
}