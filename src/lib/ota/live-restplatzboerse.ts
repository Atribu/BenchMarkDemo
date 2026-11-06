import type {
  BenchmarkWindowDefinition,
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
  RoomFeatures,
} from "../benchmark/types";
import type { DynamicOtaCollectorConfig } from "../hotels/runtime-manifest";
import { classifyRoom, resolveRoomMatch } from "./offer-matching";

const RESTPLATZBOERSE_ORIGIN = "https://www.restplatzboerse.at";
const FLUX_ORIGIN = "https://ibe.flux.reisen";
const OFFERS_ENDPOINT = `${FLUX_ORIGIN}/v1/hotel-offers`;
const VERIFY_ENDPOINT = `${FLUX_ORIGIN}/v1/verify-offer`;

export const RESTPLATZBOERSE_HOTEL_CONFIG = {
  "miramare-beach": {
    hotelIffCode: 1708,
    hotelName: "Miramare Beach Hotel",
  },
  "miramare-queen": {
    hotelIffCode: 17048,
    hotelName: "Miramare Queen Hotel",
  },
  "port-nature": {
    hotelIffCode: 136301,
    hotelName: "Port Nature Luxury Resort Hotel & Spa",
  },
  "sy-hotels-belek": {
    hotelIffCode: 297825,
    hotelName: "SY Hotels Belek Boutique Luxury",
  },
} as const;

type RestplatzboerseHotelKey = keyof typeof RESTPLATZBOERSE_HOTEL_CONFIG;

export interface RestplatzboerseOffer {
  offerId: string;
  offerCode: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalPrice: number;
  currency: "EUR";
  roomName: string;
  roomCode: string;
  roomType: string;
  roomView: string;
  boardCode: "AllInclusive" | "AllInclusiveSuperior";
  operatorCode: string;
  operatorName: string;
  matchedRoomId?: string;
  matchedRoomFeatures?: RoomFeatures;
  matchReason?: string;
}

type ExpectedStay = {
  hotelKey: RestplatzboerseHotelKey;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finitePositive(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? number
    : undefined;
}

function sourceDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchRestplatzboerseRoom(
  hotelKey: RestplatzboerseHotelKey,
  roomName: string,
  roomCode: string,
  roomType: string,
  roomView: string,
): string | undefined {
  const name = normalize(roomName);
  const code = roomCode.trim().toUpperCase();

  if (hotelKey === "miramare-beach") {
    if (/\b(economy|sparzimmer)\b/.test(name)) return "economy";
    if (/\b(corner|eckzimmer)\b/.test(name)) return "corner";
    if (
      roomType === "DoubleRoom" &&
      roomView === "NothingSpecial" &&
      /\bsuperior\b/.test(name) &&
      /\b(land|landseite|landblick|garden|garten)\b/.test(name) &&
      /\b(balkon|balcony)\b/.test(name) &&
      !/\b(ohne balkon|without balcony|best price)\b/.test(name)
    )
      return "superior-land";
    if (
      roomType === "DoubleRoom" &&
      roomView === "FullOcean" &&
      /\bsuperior\b/.test(name)
    )
      return "superior-sea";
    return undefined;
  }

  if (hotelKey === "miramare-queen") {
    if (
      roomType === "DoubleRoom" &&
      roomView === "FullOcean" &&
      /\b(meerbl|meerblick|sea view)\b/.test(name)
    )
      return "standard-sea";
    if (
      roomType === "DoubleRoom" &&
      roomView === "NothingSpecial" &&
      /^(doppelzimmer|standard room)$/.test(name)
    )
      return "standard-land";
    return undefined;
  }

  if (hotelKey === "sy-hotels-belek") {
    if (/\bfamily\b/.test(name) && /\b(swim up|swimup)\b/.test(name))
      return "deluxe-family-swim-up";
    if (/\b(duplex|dubleks)\b/.test(name) && /\bfamily\b/.test(name))
      return "deluxe-duplex-family";
    if (/\bfamily\b/.test(name)) return "deluxe-family";
    if (/\bshallow pool\b/.test(name)) return "deluxe-shallow-pool";
    if (/\bsuperior\b/.test(name)) return "deluxe-superior";
    if (/\b(swim up|swimup)\b/.test(name)) return "deluxe-swim-up";
    if (/\b(pool view|poolblick)\b/.test(name)) return "deluxe-pool";
    if (/\b(land view|landblick|landseite)\b/.test(name)) return "deluxe-land";
    return undefined;
  }

  if (code === "KS Q" && name === "suite king") return "king-suite";
  if (
    roomType === "FamilyRoom" &&
    roomView === "PartialOcean" &&
    /^(fz|familienzimmer)/.test(name)
  )
    return "family";
  if (
    roomType === "DoubleRoom" &&
    roomView === "PartialOcean" &&
    /\b(seitl|seitl meerbl|seitl meerblick)\b/.test(name)
  )
    return "standard-side-sea";
  if (
    roomType === "DoubleRoom" &&
    roomView === "FullOcean" &&
    /\bmeerbl(?:ick)?\b/.test(name)
  )
    return "standard-sea";
  if (
    roomType === "DoubleRoom" &&
    roomView === "NothingSpecial" &&
    /\blandbl(?:ick)?\b/.test(name)
  )
    return "standard-land";

  return undefined;
}

export function buildRestplatzboersePayload(
  hotelIffCode: number,
  window: BenchmarkWindowDefinition,
) {
  return {
    CurrencyCode: "EUR",
    RoomViews: [],
    HotelIffCode: hotelIffCode,
    StartDate: window.checkIn,
    EndDate: window.checkOut,
    Adults: 2,
    Children: [],
    MinDuration: window.nights,
    MaxDuration: window.nights,
    BoardTypes: [],
    RoomTypes: [],
    Transfer: [],
    DefiniteStartDate: true,
    NumberOfResults: 20,
    TourOperatorCodes: [],
    TravelType: "Accommodation",
  } as const;
}

export function buildRestplatzboerseSourceUrl(
  hotelIffCode: number,
  window: BenchmarkWindowDefinition,
) {
  const url = new URL(`${RESTPLATZBOERSE_ORIGIN}/hotel/${hotelIffCode}/`);
  url.search = new URLSearchParams({
    ibe: "hotel",
    adult: "2",
    dur: String(window.nights),
    ddate: window.checkIn,
    rdate: window.checkOut,
    srtHot: "popular",
  }).toString();
  return url.toString();
}

function responseOffers(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    throw new Error("Restplatzbörse teklif yanıtı beklenen biçimde değil.");
  }
  const offers = asRecord(value)?.Offers;
  if (!Array.isArray(offers))
    throw new Error("Restplatzbörse teklif listesi eksik.");
  return offers;
}

export function parseRestplatzboerseOffers(
  value: unknown,
  expected: ExpectedStay,
): RestplatzboerseOffer[] {
  const seen = new Set<string>();
  return responseOffers(value).flatMap((raw) => {
    const offer = asRecord(raw);
    const pricing = asRecord(offer?.Pricing);
    const single = asRecord(pricing?.Single);
    const total = asRecord(pricing?.Total);
    const room = asRecord(offer?.Room);
    const operator = asRecord(offer?.TourOperator);
    const offerId = typeof offer?.OfferID === "string" ? offer.OfferID : "";
    const offerCode = typeof offer?.OfferCode === "string" ? offer.OfferCode : "";
    const roomName = typeof room?.Name === "string" ? room.Name.trim() : "";
    const roomCode = typeof room?.Code === "string" ? room.Code.trim() : "";
    const roomType = typeof room?.Type === "string" ? room.Type : "";
    const roomView = typeof room?.View === "string" ? room.View : "";
    const operatorCode =
      typeof operator?.Code === "string" ? operator.Code.trim() : "";
    const operatorName =
      typeof operator?.Name === "string" ? operator.Name.trim() : "";
    const totalPrice = finitePositive(total?.Amount);
    const singlePrice = finitePositive(single?.Amount);
    const displayedPrice = finitePositive(offer?.Price);
    const nights = Number(offer?.OvernightStays);

    if (
      offer?.Name !== expected.hotelName ||
      offer?.Category !== 5 ||
      sourceDate(offer?.StartDate) !== expected.checkIn ||
      sourceDate(offer?.EndDate) !== expected.checkOut ||
      nights !== expected.nights ||
      offer?.CurrencyCode !== "EUR" ||
      offer?.OriginalCurrencyCode !== "EUR" ||
      pricing?.Type !== "AveragePerson" ||
      (offer?.BoardType !== "AllInclusive" &&
        offer?.BoardType !== "AllInclusiveSuperior") ||
      totalPrice === undefined ||
      singlePrice === undefined ||
      displayedPrice === undefined ||
      Math.abs(singlePrice - displayedPrice) > 0.01 ||
      Math.abs(totalPrice - singlePrice * 2) > 0.05 ||
      !offerId ||
      !offerCode ||
      !roomName ||
      !roomCode ||
      !roomType ||
      !roomView ||
      !operatorCode ||
      !operatorName ||
      seen.has(offerId)
    )
      return [];

    seen.add(offerId);
    return [
      {
        offerId,
        offerCode,
        hotelName: expected.hotelName,
        checkIn: expected.checkIn,
        checkOut: expected.checkOut,
        nights,
        totalPrice,
        currency: "EUR" as const,
        roomName,
        roomCode,
        roomType,
        roomView,
        boardCode: offer.BoardType,
        operatorCode,
        operatorName,
        matchedRoomId: matchRestplatzboerseRoom(
          expected.hotelKey,
          roomName,
          roomCode,
          roomType,
          roomView,
        ),
      },
    ];
  });
}

export function parseVerifiedRestplatzboerseOffer(
  value: unknown,
  candidate: RestplatzboerseOffer,
): number {
  const root = asRecord(value);
  const offer = asRecord(root?.Offer);
  const room = asRecord(offer?.Room);
  const operator = asRecord(offer?.TourOperator);
  const travellers = Array.isArray(offer?.Travellers) ? offer.Travellers : [];
  const price = finitePositive(offer?.Price);
  if (
    root?.Status !== "Available" ||
    root?.Available !== true ||
    offer?.TravelType !== "Accommodation" ||
    sourceDate(offer?.StartDate) !== candidate.checkIn ||
    sourceDate(offer?.EndDate) !== candidate.checkOut ||
    offer?.OvernightStays !== candidate.nights ||
    offer?.TravellerAmount !== 2 ||
    offer?.CurrencyCode !== "EUR" ||
    offer?.OfferID !== candidate.offerId ||
    offer?.OfferCode !== candidate.offerCode ||
    offer?.BoardType !==
      (candidate.boardCode === "AllInclusiveSuperior"
        ? "ALLINCLUSIVEPLUS"
        : "ALLINCLUSIVE") ||
    room?.Name !== candidate.roomName ||
    room?.Code !== candidate.roomCode ||
    operator?.Code !== candidate.operatorCode ||
    operator?.Name !== candidate.operatorName ||
    travellers.length !== 2 ||
    travellers.some(
      (traveller) => asRecord(traveller)?.Qualifier !== "ADULT",
    ) ||
    price === undefined
  )
    throw new Error("Restplatzbörse teklif doğrulaması arama sonucuyla eşleşmiyor.");
  return Math.round((price + Number.EPSILON) * 100) / 100;
}

const API_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: RESTPLATZBOERSE_ORIGIN,
  Referer: `${RESTPLATZBOERSE_ORIGIN}/`,
};

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
) {
  const response = await fetchImpl(url, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: API_HEADERS,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Restplatzbörse HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new Error("Restplatzbörse JSON olmayan yanıt döndürdü.");
  return response.json() as Promise<unknown>;
}

async function fetchAllOffers(
  fetchImpl: typeof fetch,
  payload: ReturnType<typeof buildRestplatzboersePayload>,
  expected: ExpectedStay,
) {
  const offers: RestplatzboerseOffer[] = [];
  const seenUrls = new Set<string>();
  let url: string | undefined = OFFERS_ENDPOINT;

  for (let page = 0; url && page < 10; page += 1) {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.origin !== FLUX_ORIGIN ||
      parsedUrl.pathname !== "/v1/hotel-offers" ||
      seenUrls.has(parsedUrl.href)
    )
      throw new Error("Restplatzbörse sayfalama bağlantısı geçersiz.");
    seenUrls.add(parsedUrl.href);
    const data = await fetchJson(fetchImpl, parsedUrl.href, payload);
    offers.push(...parseRestplatzboerseOffers(data, expected));
    const next = asRecord(asRecord(data)?._links)?.next;
    url = typeof next === "string" && next ? next : undefined;
  }

  if (url) throw new Error("Restplatzbörse sayfalama güvenlik sınırı aşıldı.");

  return offers;
}

async function verifyOffer(
  fetchImpl: typeof fetch,
  candidate: RestplatzboerseOffer,
) {
  const data = await fetchJson(fetchImpl, VERIFY_ENDPOINT, {
    TravelType: "Accommodation",
    OfferID: candidate.offerId,
    Adults: 2,
    CurrencyCode: "EUR",
  });
  return parseVerifiedRestplatzboerseOffer(data, candidate);
}

function roomFeatures(offer: RestplatzboerseOffer): RoomFeatures {
  if (offer.matchedRoomFeatures) return offer.matchedRoomFeatures;
  if (offer.matchedRoomId === "standard-land")
    return { category: "standard", view: "land", balcony: "unknown" };
  if (offer.matchedRoomId === "standard-side-sea")
    return { category: "standard", view: "partial-sea", balcony: "unknown" };
  if (offer.matchedRoomId === "standard-sea")
    return { category: "standard", view: "sea", balcony: "unknown" };
  if (offer.matchedRoomId === "family")
    return { category: "variant", view: "partial-sea", balcony: "unknown" };
  if (offer.matchedRoomId === "king-suite")
    return { category: "variant", view: "unknown", balcony: "unknown" };
  return classifyRoom(offer.roomName, offer.roomView);
}

export function applyDynamicRestplatzboerseRoomMatch(
  offers: RestplatzboerseOffer[],
  scope: ReportScopeDefinition,
  runtimeConfig: DynamicOtaCollectorConfig,
): RestplatzboerseOffer[] {
  return offers.map((offer) => {
    const match = resolveRoomMatch(
      scope,
      offer.roomName,
      runtimeConfig.roomAliases,
      `${offer.roomCode} ${offer.roomType} ${offer.roomView}`,
      runtimeConfig.matchingPolicy,
    );
    return {
      ...offer,
      matchedRoomId: match.matchedRoomId,
      matchedRoomFeatures: match.roomFeatures,
      matchReason: match.matchReason,
    };
  });
}

export async function collectRestplatzboerseLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  fetchImpl: typeof fetch = fetch,
  runtimeConfig?: DynamicOtaCollectorConfig,
): Promise<ProviderCollectionResult> {
  const config =
    runtimeConfig?.restplatzboerse ??
    RESTPLATZBOERSE_HOTEL_CONFIG[scope.hotelKey as RestplatzboerseHotelKey];
  if (!config || scope.currency !== "EUR") {
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
          reason: "Restplatzbörse için bu otel/EUR eşleştirmesi doğrulanmadı.",
        })),
      ),
      warnings: [
        `Restplatzbörse / ${scope.hotelName}: otel/EUR eşleştirmesi doğrulanmadı.`,
      ],
      offers: [],
    };
  }

  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];

  for (const window of scope.windows) {
    const sourceHint = buildRestplatzboerseSourceUrl(
      config.hotelIffCode,
      window,
    );
    try {
      const expected = {
        hotelKey: scope.hotelKey as RestplatzboerseHotelKey,
        hotelName: config.hotelName,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
      };
      const parsedCandidates = await fetchAllOffers(
        fetchImpl,
        buildRestplatzboersePayload(config.hotelIffCode, window),
        expected,
      );
      const candidates = runtimeConfig
        ? applyDynamicRestplatzboerseRoomMatch(
            parsedCandidates,
            scope,
            runtimeConfig,
          )
        : parsedCandidates;
      const groups = new Map<string, RestplatzboerseOffer[]>();
      for (const candidate of candidates) {
        const key = candidate.matchedRoomId ?? "unmatched";
        const group = groups.get(key) ?? [];
        group.push(candidate);
        groups.set(key, group);
      }

      const verified: CollectedOffer[] = [];
      for (const [groupKey, group] of groups) {
        const sorted = group.sort((a, b) => a.totalPrice - b.totalPrice);
        let selected: CollectedOffer | undefined;
        for (const candidate of sorted.slice(0, 5)) {
          try {
            const price = await verifyOffer(fetchImpl, candidate);
            const observedAt = new Date().toISOString();
            selected = {
              id: `restplatzboerse:${scope.id}:${window.id}:${candidate.offerId}`,
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
              roomName: candidate.roomName,
              roomFeatures: roomFeatures(candidate),
              terms: {
                board:
                  candidate.boardCode === "AllInclusiveSuperior"
                    ? "All Inclusive Plus"
                    : "All Inclusive",
                cancellation: "Rezervasyon adımında doğrulanmalı",
                taxes: "Rezervasyon adımında doğrulanmalı",
                operator: `${candidate.operatorName} (${candidate.operatorCode})`,
                availability: "Restplatzbörse verify-offer ile canlı doğrulandı",
              },
              sourceHint,
              observedAt,
              matchedRoomId: candidate.matchedRoomId,
              matchReason: candidate.matchedRoomId
                ? candidate.matchReason ??
                  `Restplatzbörse oda kodu ve manzara alanı ${candidate.matchedRoomId} kategorisiyle eşleşti.`
                : candidate.matchReason ??
                  "Restplatzbörse teklifi doğrulandı ancak oda manzarası güvenle eşleştirilemedi.",
              sourceOfferId: candidate.offerId,
              sourceProductCode: candidate.offerCode,
              sourceTravelType: "Accommodation",
              sourceSystemCode: String(config.hotelIffCode),
              sourceBoardCode: candidate.boardCode,
            };
            break;
          } catch (error) {
            warnings.push(
              `Restplatzbörse / ${scope.hotelName} / ${window.checkIn} / ${groupKey}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        if (selected) verified.push(selected);
      }
      offers.push(...verified);

      for (const room of scope.rooms) {
        const best = verified
          .filter((offer) => offer.matchedRoomId === room.id)
          .sort((a, b) => a.price - b.price)[0];
        const hadCandidate = candidates.some(
          (candidate) => candidate.matchedRoomId === room.id,
        );
        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: best?.price ?? null,
          currency: "EUR",
          status: best
            ? "available"
            : candidates.length === 0
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
            ? `${best.terms.board}; ${best.terms.operator}; ${window.nights} gece; 1 oda / 2 yetişkin; EUR doğrulanmış toplam.`
            : undefined,
          reason: best
            ? undefined
            : candidates.length === 0
              ? "Restplatzbörse tamamlanan kesin tarihli hotel-only aramasında teklif döndürmedi."
              : hadCandidate
                ? "Restplatzbörse oda teklifi bulundu ancak verify-offer doğrulaması tamamlanamadı."
                : "Restplatzbörse teklifleri bulundu ancak bu oda kategorisi eşleşmedi.",
        });
      }

      warnings.push(
        `Restplatzbörse / ${scope.hotelName} / ${window.checkIn}: ${candidates.length} kesin tarihli teklif bulundu; ${verified.length} en ucuz oda teklifi canlı doğrulandı.`,
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.split("\n")[0] : String(error);
      warnings.push(
        `Restplatzbörse / ${scope.hotelName} / ${window.checkIn}: ${reason}`,
      );
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
