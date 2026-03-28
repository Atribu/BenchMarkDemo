import type {
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition
} from "@/src/lib/benchmark/types";
import { TUI_HOTEL_CONFIG } from "@/src/lib/ota/live-config";
import { buildManualReviewQuotes, normalizeInlineText } from "@/src/lib/ota/live-helpers";

interface TuiOfferRoom {
  description?: string;
}

interface TuiOffer {
  totalPrice?: number;
  calculatedPricePerPerson?: number;
  rooms?: TuiOfferRoom[];
}

interface TuiOfferResponse {
  results?: number;
  offers?: TuiOffer[];
}

function buildTuiOfferApiUrl(giataId: number, checkIn: string, checkOut: string, nights: number) {
  const url = new URL("https://dlys20kgkdnsd.cloudfront.net/data");
  url.searchParams.set("scope", "HOTEL");
  url.searchParams.set("tenant", "tui.com");
  url.searchParams.set("abTestTenant", "undefined");
  url.searchParams.set("startDate", checkIn);
  url.searchParams.set("endDate", checkOut);
  url.searchParams.set("durations", String(nights));
  url.searchParams.set("hotelGiataId", String(giataId));
  url.searchParams.set("travellers", "2");
  url.searchParams.set("lang", "de-DE");
  return url.toString();
}

function buildTuiOfferPageUrl(
  offerSlug: string,
  giataId: number,
  checkIn: string,
  checkOut: string,
  nights: number
) {
  const url = new URL(
    `https://www.tui.com/suchen/angebote/${offerSlug}/${giataId}/list/`
  );
  url.searchParams.set("startDate", checkIn);
  url.searchParams.set("endDate", checkOut);
  url.searchParams.set("duration", String(nights));
  url.searchParams.set("travellers", "2");
  url.searchParams.set("searchScope", "HOTEL");
  url.searchParams.set("showTotalPrice", "0");
  return url.toString();
}

function matchRoomId(
  description: string,
  roomAliases: Record<string, string[]>
): string | null {
  const normalized = description.toLowerCase();

  for (const [roomId, aliases] of Object.entries(roomAliases)) {
    if (aliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
      return roomId;
    }
  }

  return null;
}

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

export async function collectTuiLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition
): Promise<ProviderCollectionResult> {
  const config = TUI_HOTEL_CONFIG[scope.hotelKey];

  if (!config) {
    return buildManualReviewQuotes(
      provider,
      scope,
      "",
      `TUI icin ${scope.hotelName} mapping'i bulunamadi.`
    );
  }

  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];

  try {
    for (const window of scope.windows) {
      const sourceHint = buildTuiOfferPageUrl(
        config.offerSlug,
        config.giataId,
        window.checkIn,
        window.checkOut,
        window.nights
      );
      const apiUrl = buildTuiOfferApiUrl(
        config.giataId,
        window.checkIn,
        window.checkOut,
        window.nights
      );

      const response = await fetch(apiUrl, {
        headers: {
          "accept-language": "de-DE,de;q=0.9,en;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        warnings.push(
          `TUI offer endpoint ${response.status} dondu: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...scope.rooms.map((room) =>
            buildQuote(
              provider,
              scope,
              window.id,
              room.id,
              sourceHint,
              "manual-review"
            )
          )
        );
        continue;
      }

      const data = (await response.json()) as TuiOfferResponse;

      if (!data.results || !Array.isArray(data.offers) || data.offers.length === 0) {
        warnings.push(`TUI offer sonucu yok: ${scope.label} / ${window.label}`);
        quotes.push(
          ...scope.rooms.map((room) =>
            buildQuote(provider, scope, window.id, room.id, sourceHint, "sold_out")
          )
        );
        continue;
      }

      const bestOfferByRoomId = new Map<string, number>();
      let hasMatchedRoom = false;

      for (const offer of data.offers) {
        const description = normalizeInlineText(
          offer.rooms?.map((room) => room.description ?? "").join(" ") ?? ""
        );
        const roomId = description
          ? matchRoomId(description, config.roomAliases)
          : null;

        if (!roomId) {
          continue;
        }

        const totalPrice =
          typeof offer.totalPrice === "number"
            ? offer.totalPrice
            : typeof offer.calculatedPricePerPerson === "number"
              ? offer.calculatedPricePerPerson * 2
              : null;

        if (totalPrice === null) {
          continue;
        }

        hasMatchedRoom = true;
        const currentBest = bestOfferByRoomId.get(roomId);
        if (currentBest === undefined || totalPrice < currentBest) {
          bestOfferByRoomId.set(roomId, totalPrice);
        }
      }

      if (!hasMatchedRoom) {
        warnings.push(
          `TUI offer bulundu ama room eslesmesi cikmadi: ${scope.label} / ${window.label}`
        );
      }

      for (const room of scope.rooms) {
        const price = bestOfferByRoomId.get(room.id);

        if (price !== undefined) {
          quotes.push(
            buildQuote(provider, scope, window.id, room.id, sourceHint, "available", price)
          );
          continue;
        }

        quotes.push(
          buildQuote(
            provider,
            scope,
            window.id,
            room.id,
            sourceHint,
            hasMatchedRoom ? "manual-review" : "manual-review"
          )
        );
      }
    }
  } catch (error) {
    return buildManualReviewQuotes(
      provider,
      scope,
      config.offerPageUrl,
      `TUI live collector hatasi: ${
        error instanceof Error ? error.message : "bilinmeyen hata"
      }`
    );
  }

  return {
    quotes,
    warnings
  };
}
