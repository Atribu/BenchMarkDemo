import type {
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";
import { TUI_HOTEL_CONFIG } from "@/src/lib/ota/live-config";
import {
  classifyRoom,
  deduplicateOffers,
  matchOfferRoom,
  selectOfferQuotes,
} from "./offer-matching";
import {
  buildManualReviewQuotes,
  normalizeInlineText,
} from "@/src/lib/ota/live-helpers";

// The public accommodation-only room panel returns all room offers. The former
// CloudFront search endpoint returned only a cheapest-offer summary.
const ROOMS_ENDPOINT = "https://cloud.tui.com/osp/ao/ml/rooms-panel/rooms";

interface TuiRoomContent {
  roomCode?: string;
  facilities?: { text?: string }[];
}
interface TuiRoomOffer {
  arrivalDate?: string;
  departureDate?: string;
  duration?: number;
  currency?: string;
  hotel?: { giataCode?: string };
  price?: { amount?: number };
  travellers?: { age?: number }[];
  rooms?: { roomName?: string; supplierRoomId?: string }[];
  board?: { boardName?: string };
  tourOperator?: string;
  cancellationTerms?: { freeCancellation?: boolean; date?: string };
  hasCityTax?: boolean;
}
interface TuiRoomType {
  supplierRoomTypeName?: string;
  roomContent?: TuiRoomContent[];
  offers?: TuiRoomOffer[];
}

function offerUrl(
  giataId: number,
  slug: string,
  window: ReportScopeDefinition["windows"][number],
) {
  const url = new URL(
    `https://www.tui.com/suchen/angebote/${slug}/${giataId}/list/`,
  );
  Object.entries({
    startDate: window.checkIn,
    endDate: window.checkOut,
    duration: String(window.nights),
    selectedDuration: String(window.nights),
    travellers: "2",
    searchScope: "HOTEL",
    showTotalPrice: "1",
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

export async function collectTuiLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const config = TUI_HOTEL_CONFIG[scope.hotelKey];
  if (!config)
    return buildManualReviewQuotes(
      provider,
      scope,
      "",
      `TUI için ${scope.hotelName} otel eşleştirmesi bulunamadı.`,
    );
  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];

  for (const window of scope.windows) {
    const sourceHint = offerUrl(config.giataId, config.offerSlug, window);
    const quote = (
      roomId: string,
      status: ProviderQuote["status"],
      price: number | null,
      reason?: string,
      offerDescription?: string,
    ): ProviderQuote => ({
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId,
      windowId: window.id,
      price,
      currency: scope.currency,
      status,
      dataMode: "live",
      sourceHint,
      reason,
      offerDescription,
    });
    try {
      const response = await fetch(ROOMS_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(40000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          hotelId: String(config.giataId),
          locale: "de-DE",
          market: "de",
          ages: "30,30",
          startDate: window.checkIn,
          endDate: window.checkOut,
          duration: String(window.nights),
          sourceSystem: "TRIPS",
        }),
      });
      if (!response.ok)
        throw new Error(`Oda servisi HTTP ${response.status} döndürdü.`);
      const data = (await response.json()) as {
        roomTypes?: TuiRoomType[];
      } | null;
      if (!data || !Array.isArray(data.roomTypes))
        throw new Error("Oda servisi yanıtı doğrulanamadı.");
      if (!data.roomTypes.length) {
        const reason =
          "TUI, seçilen tarihlerde bu otel için uçaksız teklif döndürmedi. Bu, otelin tüm kanallarda dolu olduğu anlamına gelmez.";
        quotes.push(
          ...scope.rooms.map((room) =>
            quote(room.id, "sold_out", null, reason),
          ),
        );
        warnings.push(`TUI / ${scope.hotelName} / ${window.label}: ${reason}`);
        continue;
      }

      const windowOffers: CollectedOffer[] = [];
      const observedAt = new Date().toISOString();
      for (const roomType of data.roomTypes)
        for (const offer of roomType.offers ?? []) {
          const price = offer.price?.amount;
          if (
            offer.arrivalDate !== window.checkIn ||
            offer.departureDate !== window.checkOut ||
            offer.duration !== window.nights ||
            offer.currency !== scope.currency ||
            offer.hotel?.giataCode !== String(config.giataId) ||
            typeof price !== "number" ||
            !Number.isFinite(price) ||
            price <= 0 ||
            offer.rooms?.length !== 1 ||
            offer.travellers?.length !== 2 ||
            !offer.travellers.every(
              (person) => typeof person.age === "number" && person.age >= 18,
            )
          )
            continue;
          const room = offer.rooms[0];
          const name = normalizeInlineText(
            room.roomName ?? roomType.supplierRoomTypeName ?? "",
          );
          const content = roomType.roomContent?.find(
            (entry) => entry.roomCode === room.supplierRoomId,
          );
          if (!name) continue;
          const roomFeatures = classifyRoom(
            name,
            content?.facilities
              ?.map((facility) => facility.text ?? "")
              .join(" "),
          );
          windowOffers.push({
            id: `tui:${scope.id}:${window.id}:${windowOffers.length}`,
            providerKey: provider.key,
            scopeKey: scope.id,
            windowId: window.id,
            checkIn: window.checkIn,
            checkOut: window.checkOut,
            nights: window.nights,
            rooms: 1,
            adults: 2,
            price,
            currency: scope.currency,
            roomName: name,
            roomFeatures,
            sourceHint,
            observedAt,
            ...matchOfferRoom(scope, roomFeatures),
            terms: {
              board: offer.board?.boardName || "Belirtilmedi",
              cancellation:
                offer.cancellationTerms?.freeCancellation === false
                  ? "Ücretsiz iptal yok"
                  : offer.cancellationTerms?.freeCancellation === true
                    ? `Ücretsiz iptal${offer.cancellationTerms.date ? `: ${offer.cancellationTerms.date}` : "; son tarih kaynakta kontrol edilmeli"}`
                    : "Belirtilmedi",
              taxes:
                offer.hasCityTax === true
                  ? "Şehir vergisi var; ödeme ayrıntısı kaynakta kontrol edilmeli"
                  : offer.hasCityTax === false
                    ? "Serviste şehir vergisi yok; diğer vergi ayrıntıları belirtilmedi"
                    : "Belirtilmedi",
              operator: offer.tourOperator,
              availability:
                "Oda servisi teklifi; son fiyat rezervasyon adımında tekrar doğrulanmalı.",
            },
          });
        }
      const uniqueOffers = deduplicateOffers(windowOffers);
      offers.push(...uniqueOffers);
      quotes.push(
        ...selectOfferQuotes(provider, scope, window, uniqueOffers, sourceHint),
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Beklenmeyen hata.";
      const reason =
        "TUI oda servisine ulaşılamadı veya yanıt doğrulanamadı. Bu bir müsaitlik sonucu değildir.";
      warnings.push(`TUI / ${scope.hotelName} / ${window.label}: ${detail}`);
      quotes.push(
        ...scope.rooms.map((room) =>
          quote(room.id, "manual-review", null, reason),
        ),
      );
    }
  }
  return { quotes, warnings, offers };
}
