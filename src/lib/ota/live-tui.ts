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

    console.log("[TUI] Scope resolution:", {
  scopeId: scope.id,
  hotel: scope.hotelName,
  currency: scope.currency,
  availableMarkets: Object.keys(config.markets),
});

    const marketConfig = config.markets[scope.currency];

if (!marketConfig) {
  console.log("[TUI] Market config missing:", {
    scopeId: scope.id,
    currency: scope.currency,
  });

  return buildManualReviewQuotes(
    provider,
    scope,
    config.offerPageUrl,
    `TUI ${scope.hotelName} için ${scope.currency} pazarı henüz doğrulanmadı.`,
  );
}

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
      
  const requestBody = {
  hotelId:
    marketConfig.hotelId ??
    String(config.giataId),

  giataId: String(config.giataId),

  locale: marketConfig.locale,
  market: marketConfig.market,

  ages: "30,30",
  startDate: window.checkIn,
  endDate: window.checkOut,
  duration: String(window.nights),

  sourceSystem: "TRIPS",

  ...(marketConfig.sourcing
    ? { sourcing: marketConfig.sourcing }
    : {}),

  ...(marketConfig.productId
    ? { productId: marketConfig.productId }
    : {}),
};

  console.log("[TUI] Request body:", requestBody);

  const response = await fetch(ROOMS_ENDPOINT, {
  method: "POST",
  cache: "no-store",
  signal: AbortSignal.timeout(40000),
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify(requestBody),
});

console.log("[TUI] Response:", {
  status: response.status,
  statusText: response.statusText,
  contentType: response.headers.get("content-type"),
});

if (!response.ok) {
  const errorBody = await response.text().catch(() => "");

  console.error("[TUI] Error response:", {
    status: response.status,
    body: errorBody.slice(0, 3000),
  });

  throw new Error(
    `Oda servisi HTTP ${response.status} döndürdü.`,
  );
}

const data = (await response.json()) as {
  roomTypes?: TuiRoomType[];
} | null;

      console.log(
  "[TUI] Raw response:",
  JSON.stringify(data, null, 2),
);
      if (!data || !Array.isArray(data.roomTypes))
        throw new Error("Oda servisi yanıtı doğrulanamadı.");

      console.log("\n========== TUI DEBUG START ==========");
console.log("[TUI] Hotel:", scope.hotelName);
console.log("[TUI] Hotel key:", scope.hotelKey);
console.log("[TUI] GIATA:", config.giataId);
console.log("[TUI] Offer slug:", config.offerSlug);
console.log("[TUI] Currency:", scope.currency);
console.log("[TUI] Check-in:", window.checkIn);
console.log("[TUI] Check-out:", window.checkOut);
console.log("[TUI] Nights:", window.nights);
console.log("[TUI] Room type count:", data.roomTypes.length);
     
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

for (const roomType of data.roomTypes) {
  for (const offer of roomType.offers ?? []) {
    const price = offer.price?.amount;
    const rejectionReasons: string[] = [];

    if (offer.arrivalDate !== window.checkIn) {
      rejectionReasons.push(
        `arrivalDate=${offer.arrivalDate} expected=${window.checkIn}`,
      );
    }

    if (offer.departureDate !== window.checkOut) {
      rejectionReasons.push(
        `departureDate=${offer.departureDate} expected=${window.checkOut}`,
      );
    }

    if (offer.duration !== window.nights) {
      rejectionReasons.push(
        `duration=${offer.duration} expected=${window.nights}`,
      );
    }

    if (offer.currency !== scope.currency) {
      rejectionReasons.push(
        `currency=${offer.currency} expected=${scope.currency}`,
      );
    }

const expectedHotelIdentifier =
  marketConfig.hotelId ?? String(config.giataId);

if (offer.hotel?.giataCode !== expectedHotelIdentifier) {
  rejectionReasons.push(
    `hotelIdentifier=${offer.hotel?.giataCode} expected=${expectedHotelIdentifier}`,
  );
}

    if (
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      rejectionReasons.push(`price=${price}`);
    }

    if (offer.rooms?.length !== 1) {
      rejectionReasons.push(
        `rooms=${offer.rooms?.length}`,
      );
    }

    if (offer.travellers?.length !== 2) {
      rejectionReasons.push(
        `travellers=${offer.travellers?.length}`,
      );
    } else if (
      !offer.travellers.every(
        (person) =>
          typeof person.age === "number" &&
          person.age >= 18,
      )
    ) {
      rejectionReasons.push(
        `travellerAges=${offer.travellers
          .map((person) => person.age)
          .join(",")}`,
      );
    }

    if (rejectionReasons.length > 0) {
      console.log("[TUI] Offer rejected:", {
        roomType: roomType.supplierRoomTypeName,
        roomName: offer.rooms?.[0]?.roomName,
        price,
        reasons: rejectionReasons,
      });

      continue;
    }

    // TypeScript narrowing
if (typeof price !== "number") {
  continue;
}

    const room = offer.rooms?.[0];

    if (!room) {
      console.log("[TUI] Offer rejected: missing room", {
        roomType: roomType.supplierRoomTypeName,
        price,
      });
      continue;
    }

    const name = normalizeInlineText(
      room.roomName ??
        roomType.supplierRoomTypeName ??
        "",
    );

    const content = roomType.roomContent?.find(
      (entry) =>
        entry.roomCode === room.supplierRoomId,
    );

    if (!name) {
      console.log("[TUI] Offer rejected: empty room name", {
        roomType: roomType.supplierRoomTypeName,
        supplierRoomId: room.supplierRoomId,
        price,
      });
      continue;
    }

    const facilities =
      content?.facilities
        ?.map((facility) => facility.text ?? "")
        .join(" ") ?? "";

    const roomFeatures = classifyRoom(
      name,
      facilities,
    );

    const match = matchOfferRoom(
      scope,
      roomFeatures,
    );

    console.log("[TUI] Accepted offer:", {
      roomName: name,
      price,
      currency: offer.currency,
      facilities,
      roomFeatures,
      match,
    });

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
      ...match,
      terms: {
        board:
          offer.board?.boardName ||
          "Belirtilmedi",

        cancellation:
          offer.cancellationTerms
            ?.freeCancellation === false
            ? "Ücretsiz iptal yok"
            : offer.cancellationTerms
                  ?.freeCancellation === true
              ? `Ücretsiz iptal${
                  offer.cancellationTerms.date
                    ? `: ${offer.cancellationTerms.date}`
                    : "; son tarih kaynakta kontrol edilmeli"
                }`
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
}

console.log(
  "[TUI] Valid offer count:",
  windowOffers.length,
);

console.log(
  "========== TUI DEBUG END ==========\n",
);
      const uniqueOffers = deduplicateOffers(windowOffers);
      offers.push(...uniqueOffers);
      quotes.push(
        ...selectOfferQuotes(provider, scope, window, uniqueOffers, sourceHint),
      );
    } catch (error) {
  console.error("[TUI] Collection failed:", {
    hotel: scope.hotelName,
    error:
      error instanceof Error
        ? error.message
        : String(error),
  });

  const detail =
    error instanceof Error
      ? error.message
      : "Beklenmeyen hata.";
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
