import type {
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
  RoomFeatures,
} from "../benchmark/types";
import type { DynamicOtaCollectorConfig } from "../hotels/runtime-manifest";
import { classifyRoom, resolveRoomMatch } from "./offer-matching";

const DERTOUR_ORIGIN = "https://www.dertour.de";
const OPERATOR_CODES = new Set(["DER", "ITS"]);

interface DertourHotelConfig {
  coreId: string;
  slug: string;
  roomAliases: Readonly<Record<string, readonly string[]>>;
}

export const DERTOUR_HOTEL_CONFIG: Readonly<Record<string, DertourHotelConfig>> = {
  "miramare-beach": {
    coreId: "1116XL",
    slug: "miramare-beach",
    roomAliases: {
      corner: ["Doppelzimmer Superior Corner"],
      economy: ["Doppelzimmer Economy"],
      "superior-land": ["Doppelzimmer Superior Landblick"],
      "superior-sea": ["Doppelzimmer Superior Meerblick"],
    },
  },
  "sy-hotels-belek": {
    coreId: "12t1zL",
    slug: "sy-hotels-belek-boutique-luxury",
    roomAliases: {
      "deluxe-land": ["Deluxe Zimmer Landblick"],
      "deluxe-pool": ["Deluxe Zimmer Poolblick"],
      "deluxe-superior": ["Deluxe Superior Zimmer"],
      "deluxe-family": ["Deluxe Familienzimmer"],
      "deluxe-duplex-family": ["Deluxe Duplex Familienzimmer"],
      "deluxe-swim-up": ["Deluxe Swim Up Zimmer"],
      "deluxe-family-swim-up": ["Deluxe Swim Up Familienzimmer"],
      "deluxe-shallow-pool": ["Deluxe Zimmer mit flachem Pool"],
    },
  },
};

interface ParsedDertourOffer {
  offerId: string;
  operator: "DER" | "ITS";
  price: number;
  roomName: string;
  roomCode: string;
  boardName: string;
  boardCode?: string;
  productCode?: string;
  matchedRoomId?: string;
  matchReason?: string;
  roomFeatures?: RoomFeatures;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function extractNextData(html: string): Record<string, unknown> {
  const match = html.match(
    /<script\s+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) throw new Error("DERTOUR teklif verisi sayfada bulunamadı.");
  try {
    const value = JSON.parse(match[1]);
    const parsed = record(value);
    if (!parsed) throw new Error("Invalid NEXT_DATA");
    return parsed;
  } catch {
    throw new Error("DERTOUR teklif verisi doğrulanamadı.");
  }
}

function getOffersCache(nextData: Record<string, unknown>) {
  const props = record(nextData.props);
  const pageProps = record(props?.pageProps);
  const cache = record(pageProps?.__cache);
  if (!cache) throw new Error("DERTOUR teklif önbelleği bulunamadı.");
  const entry = Object.values(cache).find(
    (candidate) => record(record(candidate)?.spec)?.url === "/api/hotel/get-offers",
  );
  if (!entry) throw new Error("DERTOUR hotel-only teklif yanıtı bulunamadı.");
  return record(entry)!;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function buildDertourSourceUrl(
  config: Pick<DertourHotelConfig, "coreId" | "slug">,
  checkIn: string,
  checkOut: string,
) {
  const url = new URL(`/hotel/${config.slug}-${config.coreId}`, DERTOUR_ORIGIN);
  url.search = new URLSearchParams({
    travelType: "hotelOnly",
    dateFrom: checkIn,
    dateTo: checkOut,
    duration: "exact",
    adults: "2",
    priceMode: "total",
  }).toString();
  url.searchParams.append("tourOperator", "DER");
  url.searchParams.append("tourOperator", "ITS");
  return url.toString();
}

export function parseDertourOffers(
  html: string,
  expected: {
    coreId: string;
    checkIn: string;
    checkOut: string;
    nights: number;
  },
): ParsedDertourOffer[] {
  const entry = getOffersCache(extractNextData(html));
  const params = record(record(entry.params)?.body);
  const hotelParams = record(params?.hotel);
  const id = record(hotelParams?.id);
  const operatorCodes = stringArray(hotelParams?.tourOperatorCodes);
  if (
    text(id?.cid).toLowerCase() !== expected.coreId.toLowerCase() ||
    hotelParams?.fromDate !== expected.checkIn ||
    hotelParams?.toDate !== expected.checkOut ||
    hotelParams?.duration !== "exact" ||
    hotelParams?.numberOfAdults !== 2 ||
    hotelParams?.tenant !== "DERTOUR" ||
    hotelParams?.priceMode !== "TOTAL_PRICE" ||
    !operatorCodes.includes("DER") ||
    !operatorCodes.includes("ITS")
  )
    throw new Error("DERTOUR sorgu kapsamı seçilen otel ve tarihlerle eşleşmiyor.");

  const result = record(entry.result);
  if (result?.success !== true)
    throw new Error("DERTOUR teklif sorgusu tamamlanamadı.");
  const data = record(result.data);
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const seen = new Set<string>();
  const offers: ParsedDertourOffer[] = [];

  for (const rawRoom of rooms) {
    const roomGroup = record(rawRoom);
    const boards = Array.isArray(roomGroup?.boards) ? roomGroup.boards : [];
    for (const rawBoard of boards) {
      const offer = record(record(rawBoard)?.offer);
      const operator = text(offer?.tourOperator);
      const price = record(offer?.price);
      const room = record(offer?.room);
      const roomPeriod = record(room?.travelPeriod);
      const stayPeriod = record(offer?.hotelStayPeriod);
      const hotel = record(offer?.hotel);
      const board = record(offer?.board);
      const travellers = Array.isArray(offer?.travellers) ? offer.travellers : [];
      const offerId = text(offer?.offerId);
      const roomName = text(room?.name) || text(roomGroup?.name);
      const roomCode = text(room?.operatorCode);
      const boardName = text(board?.name);
      const total = positiveNumber(price?.amount);
      const roomTotal = positiveNumber(record(room?.price)?.amount);
      if (
        !OPERATOR_CODES.has(operator) ||
        offer?.offerType !== "HOTEL" ||
        text(hotel?.id).toLowerCase() !== expected.coreId.toLowerCase() ||
        hotel?.country2Lc !== "TR" ||
        stayPeriod?.from !== expected.checkIn ||
        stayPeriod?.to !== expected.checkOut ||
        stayPeriod?.duration !== expected.nights ||
        roomPeriod?.from !== expected.checkIn ||
        roomPeriod?.to !== expected.checkOut ||
        roomPeriod?.duration !== expected.nights ||
        travellers.length !== 2 ||
        travellers.some((traveller) => record(traveller)?.type !== "ADULT") ||
        price?.currencyCode !== "EUR" ||
        total === undefined ||
        roomTotal === undefined ||
        Math.abs(total - roomTotal) > 0.01 ||
        !offerId ||
        !roomName ||
        !roomCode ||
        !/all(?:es)?\s+inklusive|all\s+inclusive/i.test(boardName) ||
        seen.has(offerId)
      )
        continue;
      seen.add(offerId);
      offers.push({
        offerId,
        operator: operator as "DER" | "ITS",
        price: Math.round((total + Number.EPSILON) * 100) / 100,
        roomName,
        roomCode,
        boardName,
        boardCode: stringArray(board?.code)[0],
        productCode: text(offer?.productCode) || undefined,
      });
    }
  }
  return offers;
}

function applyRoomMatches(
  offers: ParsedDertourOffer[],
  scope: ReportScopeDefinition,
  aliases: Readonly<Record<string, readonly string[]>>,
  matchingPolicy?: DynamicOtaCollectorConfig["matchingPolicy"],
) {
  return offers.map((offer) => {
    const match = resolveRoomMatch(
      scope,
      offer.roomName,
      aliases,
      offer.roomCode,
      matchingPolicy,
    );
    return {
      ...offer,
      matchedRoomId: match.matchedRoomId,
      matchReason: match.matchReason,
      roomFeatures: match.roomFeatures,
    };
  });
}

function featureFor(offer: ParsedDertourOffer): RoomFeatures {
  return offer.roomFeatures ?? classifyRoom(offer.roomName, offer.roomCode);
}

async function fetchDertourPage(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "de-DE,de;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`DERTOUR HTTP ${response.status}`);
  if (!(response.headers.get("content-type") ?? "").includes("text/html"))
    throw new Error("DERTOUR HTML olmayan yanıt döndürdü.");
  const html = await response.text();
  if (new Blob([html]).size > 8_000_000)
    throw new Error("DERTOUR yanıtı güvenli boyut sınırını aştı.");
  return html;
}

export async function collectDertourLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  fetchImpl: typeof fetch = fetch,
  runtimeConfig?: DynamicOtaCollectorConfig,
): Promise<ProviderCollectionResult> {
  const staticConfig = DERTOUR_HOTEL_CONFIG[scope.hotelKey];
  const config = runtimeConfig?.dertour ?? staticConfig;
  const aliases = runtimeConfig?.roomAliases ?? staticConfig?.roomAliases;
  if (!config || !aliases || scope.currency !== "EUR") {
    const reason = "DERTOUR/ITS Almanya için bu otel/EUR eşleştirmesi doğrulanmadı.";
    return {
      quotes: scope.rooms.flatMap((room) =>
        scope.windows.map((window) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: null,
          currency: scope.currency,
          status: "manual-review" as const,
          dataMode: "live" as const,
          sourceHint: provider.searchTemplate ?? "",
          reason,
        })),
      ),
      warnings: [`DERTOUR/ITS / ${scope.hotelName}: ${reason}`],
      offers: [],
    };
  }

  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];
  for (const window of scope.windows) {
    const sourceHint = buildDertourSourceUrl(config, window.checkIn, window.checkOut);
    try {
      const parsed = parseDertourOffers(await fetchDertourPage(fetchImpl, sourceHint), {
        coreId: config.coreId,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
      });
      const candidates = applyRoomMatches(
        parsed,
        scope,
        aliases,
        runtimeConfig?.matchingPolicy,
      );
      const observedAt = new Date().toISOString();
      const collected = candidates.map(
        (candidate): CollectedOffer => ({
          id: `dertour:${scope.id}:${window.id}:${candidate.offerId}`,
          providerKey: provider.key,
          scopeKey: scope.id,
          windowId: window.id,
          checkIn: window.checkIn,
          checkOut: window.checkOut,
          nights: window.nights,
          rooms: 1,
          adults: 2,
          price: candidate.price,
          currency: "EUR",
          roomName: candidate.roomName,
          roomFeatures: featureFor(candidate),
          terms: {
            board: candidate.boardName,
            cancellation: "Teklif detayında doğrulanmalı",
            taxes: "Teklif detayında doğrulanmalı",
            operator: candidate.operator === "DER" ? "DERTOUR" : "ITS",
            availability: "DERTOUR kesin tarihli hotel-only sayfasında listelendi",
          },
          sourceHint,
          observedAt,
          matchedRoomId: candidate.matchedRoomId,
          matchReason:
            candidate.matchReason ??
            "DERTOUR oda adı doğrulandı ancak panel odasıyla eşleşmedi.",
          sourceOfferId: candidate.offerId,
          sourceProductCode: candidate.productCode,
          sourceTravelType: "HOTEL",
          sourceSystemCode: config.coreId,
          sourceBoardCode: candidate.boardCode,
        }),
      );
      offers.push(...collected);

      for (const room of scope.rooms) {
        const best = collected
          .filter((offer) => offer.matchedRoomId === room.id)
          .sort((a, b) => a.price - b.price)[0];
        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: best?.price ?? null,
          currency: "EUR",
          status: best
            ? "available"
            : parsed.length === 0
              ? "sold_out"
              : "manual-review",
          dataMode: "live",
          captureMethod: "automated",
          sourceHint,
          observedAt: best?.observedAt,
          offerId: best?.id,
          offerDescription: best?.roomName,
          roomFeatures: best?.roomFeatures,
          terms: best?.terms,
          offerConditions: best
            ? `${best.terms.board}; ${window.nights} gece; 1 oda / 2 yetişkin; EUR doğrulanmış toplam; ${best.terms.operator}.`
            : undefined,
          reason: best
            ? undefined
            : parsed.length === 0
              ? "DERTOUR/ITS kesin tarihli hotel-only aramasında teklif döndürmedi."
              : "DERTOUR/ITS teklifleri bulundu ancak bu oda kategorisi eşleşmedi.",
        });
      }
      warnings.push(
        `DERTOUR/ITS / ${scope.hotelName} / ${window.checkIn}: ${parsed.length} teklif bulundu; ${collected.filter((offer) => offer.matchedRoomId).length} teklif oda kategorisiyle eşleşti.`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      warnings.push(`DERTOUR/ITS / ${scope.hotelName} / ${window.checkIn}: ${reason}`);
      quotes.push(
        ...scope.rooms.map(
          (room): ProviderQuote => ({
            providerKey: provider.key,
            scopeKey: scope.id,
            roomId: room.id,
            windowId: window.id,
            price: null,
            currency: "EUR",
            status: "manual-review",
            dataMode: "live",
            sourceHint,
            reason,
          }),
        ),
      );
    }
  }
  return { quotes, offers, warnings };
}
