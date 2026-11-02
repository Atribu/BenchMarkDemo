import type {
  BenchmarkWindowDefinition,
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
  RoomFeatures,
} from "../benchmark/types";
import { classifyRoom } from "./offer-matching";

const STAYFORLONG_ORIGIN = "https://www.stayforlong.de";
const API_ORIGIN = "https://gw.stayforlong.de";

export const STAYFORLONG_HOTEL_CONFIG = {
  "miramare-beach": {
    propertyId: 67296,
    slug: "miramare-beach-hotel_manavgat",
    hotelName: "Miramare Beach Hotel",
  },
  "miramare-queen": {
    propertyId: 67402,
    slug: "miramare-queen-hotel-all-inclusive_manavgat",
    hotelName: "Miramare Queen Hotel - All Inclusive",
  },
  "port-nature": {
    propertyId: 40539,
    slug: "port-nature-luxury-resort_serik",
    hotelName: "Port Nature Luxury Resort & Spa – All Inclusive",
  },
} as const;

type StayforlongHotelKey = keyof typeof STAYFORLONG_HOTEL_CONFIG;

export interface StayforlongOffer {
  availabilityId: string;
  propertyId: number;
  totalPrice: number;
  currency: "EUR";
  roomName: string;
  roomCode: string;
  normalizedRoomCode: string;
  boardCode: "AI" | "AS";
  boardName: string;
  adults: 2;
  children: 0;
  rooms: 1;
  providerCode: string;
  matchedRoomId?: string;
}

export interface VerifiedStayforlongOffer {
  price: number;
  cancellation: string;
  taxes: string;
  availability: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : undefined;
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

export function matchStayforlongRoom(
  hotelKey: StayforlongHotelKey,
  roomName: string,
  roomCode: string,
): string | undefined {
  const text = normalize(`${roomName} ${roomCode}`);

  if (hotelKey === "miramare-beach") {
    if (/\b(economy|sparzimmer)\b/.test(text)) return "economy";
    if (/\b(eckzimmer|corner room)\b/.test(text)) return "corner";
    if (
      /\bsuperior\b/.test(text) &&
      /\b(landschaftsblick|landansicht|land view|landblick)\b/.test(text)
    )
      return "superior-land";
    if (
      /\bsuperior\b/.test(text) &&
      /\b(meerblick|sea view)\b/.test(text) &&
      !/\b(seitlicher|teilweiser|side|partial)\b/.test(text)
    )
      return "superior-sea";
    return undefined;
  }

  if (hotelKey === "miramare-queen") {
    if (
      /\b(meerblick|sea view)\b/.test(text) &&
      !/\b(seitlicher|teilweiser|side|partial|suite|family|familienzimmer)\b/.test(
        text,
      )
    )
      return "standard-sea";
    if (
      /^(doppelbett oder zwei einzelbetten)( (2293|rmsddb0000 own6))?$/.test(
        text,
      )
    )
      return "standard-land";
    return undefined;
  }

  if (hotelKey !== "port-nature") return undefined;

  if (/\bfamily room\b|\bfamilienzimmer\b/.test(text)) return "family";
  if (/\bking suite\b|\bking suit\b/.test(text)) return "king-suite";
  if (
    /\b(side sea view|partial sea view|seitlicher meerblick|teilweiser meerblick)\b/.test(
      text,
    )
  )
    return "standard-side-sea";
  if (/\b(sea view|meerblick)\b/.test(text)) return "standard-sea";
  if (/\b(land view|landansicht|landblick)\b/.test(text))
    return "standard-land";
  return undefined;
}

export function buildStayforlongSourceUrl(
  slug: string,
  window: BenchmarkWindowDefinition,
) {
  const url = new URL(`${STAYFORLONG_ORIGIN}/de-de/hotel/tr/${slug}`);
  url.search = new URLSearchParams({
    adults: "2",
    checkIn: window.checkIn,
    checkOut: window.checkOut,
  }).toString();
  return url.toString();
}

export function buildStayforlongAvailabilityUrl(
  propertyId: number,
  window: BenchmarkWindowDefinition,
) {
  const url = new URL(`${API_ORIGIN}/v4/availability/property/${propertyId}`);
  url.search = new URLSearchParams({
    adultsByRoom: "2",
    checkin: window.checkIn,
    checkout: window.checkOut,
    childrenAges: "",
    childrenByRoom: "0",
    lang: "de",
    language: "de",
    market: "de",
    currency: "EUR",
    device: "desktop",
    affiliate: "stayforlong",
    source: "web",
  }).toString();
  return url.toString();
}

export function parseStayforlongOffers(
  value: unknown,
  propertyId: number,
  hotelKey: StayforlongHotelKey,
  nights: number,
): StayforlongOffer[] {
  const root = asRecord(value);
  const property = asRecord(root?.[String(propertyId)]);
  if (!property)
    throw new Error("Stayforlong otel availability kaydı bulunamadı.");
  const rawOffers = property.availability;
  if (!Array.isArray(rawOffers))
    throw new Error("Stayforlong availability listesi eksik.");

  const seen = new Set<string>();
  return rawOffers.flatMap((raw) => {
    const offer = asRecord(raw);
    const summary = asRecord(offer?.summary);
    const total = asRecord(summary?.total_with_fees);
    const availabilityId =
      typeof offer?.id_availability === "string"
        ? offer.id_availability.trim()
        : "";
    const roomName =
      typeof offer?.room_name === "string" ? offer.room_name.trim() : "";
    const roomCode =
      typeof offer?.room_code === "string" ? offer.room_code.trim() : "";
    const sourceNormalizedRoomCode =
      typeof offer?.normalized_room_code === "string"
        ? offer.normalized_room_code.trim()
        : "";
    const normalizedRoomCode = sourceNormalizedRoomCode || roomCode;
    const boardName =
      typeof offer?.board_name === "string" ? offer.board_name.trim() : "";
    const providerCode =
      typeof offer?.provider === "string" ? offer.provider.trim() : "";
    const sellingRate = positiveNumber(offer?.selling_rate);
    const totalPrice = positiveNumber(total?.amount);
    const averageRate = positiveNumber(offer?.avg_rate);

    if (
      !availabilityId ||
      seen.has(availabilityId) ||
      offer?.adults !== 2 ||
      offer?.children !== 0 ||
      offer?.rooms !== 1 ||
      offer?.currency !== "EUR" ||
      (offer?.board_code !== "AI" && offer?.board_code !== "AS") ||
      !/all\s+inklusive|all\s+inclusive/i.test(boardName) ||
      !roomName ||
      !roomCode ||
      !normalizedRoomCode ||
      !providerCode ||
      sellingRate === undefined ||
      totalPrice === undefined ||
      total?.currency !== "EUR" ||
      Math.abs(sellingRate - totalPrice) > 0.01 ||
      (averageRate !== undefined &&
        Math.abs(averageRate * nights - totalPrice) > 0.05)
    )
      return [];

    seen.add(availabilityId);
    return [
      {
        availabilityId,
        propertyId,
        totalPrice,
        currency: "EUR" as const,
        roomName,
        roomCode,
        normalizedRoomCode,
        boardCode: offer.board_code,
        boardName,
        adults: 2 as const,
        children: 0 as const,
        rooms: 1 as const,
        providerCode,
        matchedRoomId: matchStayforlongRoom(hotelKey, roomName, roomCode),
      },
    ];
  });
}

export function parseVerifiedStayforlongOffer(
  value: unknown,
  candidate: StayforlongOffer,
  nights: number,
): VerifiedStayforlongOffer {
  const offer = asRecord(value);
  const price = positiveNumber(offer?.selling_rate);
  const taxes = Array.isArray(offer?.taxes) ? offer.taxes : [];
  const cancellationPolicies = Array.isArray(offer?.cancellation_policies)
    ? offer.cancellation_policies
    : [];
  if (
    offer?.id_property !== candidate.propertyId ||
    offer?.currency !== "EUR" ||
    offer?.nights !== nights ||
    offer?.adults !== 2 ||
    offer?.children !== 0 ||
    offer?.rooms !== 1 ||
    offer?.board_code !== candidate.boardCode ||
    offer?.room_name !== candidate.roomName ||
    price === undefined ||
    taxes.some((tax) => asRecord(tax)?.included !== true)
  )
    throw new Error("Stayforlong bookingRules doğrulaması teklifle eşleşmiyor.");

  const policy = asRecord(cancellationPolicies[0]);
  const cancellationAmount = positiveNumber(policy?.amount);
  const cancellationDate =
    typeof policy?.from === "string" ? policy.from.slice(0, 10) : undefined;
  const cancellation = cancellationDate
    ? `${cancellationDate} tarihinden itibaren ${cancellationAmount ?? 0} EUR; rezervasyon koşullarını kontrol edin`
    : "Rezervasyon adımında doğrulanmalı";
  const includedTax = taxes.reduce((sum, tax) => {
    const amount = positiveNumber(asRecord(tax)?.amount);
    return sum + (amount ?? 0);
  }, 0);

  return {
    price: Math.round((price + Number.EPSILON) * 100) / 100,
    cancellation,
    taxes:
      includedTax > 0
        ? `${includedTax.toFixed(2)} EUR vergi toplam fiyata dahil`
        : "Vergi dökümü yok; rezervasyon adımında doğrulanmalı",
    availability: "Stayforlong bookingRules ile canlı yeniden doğrulandı",
  };
}

const API_HEADERS = {
  Accept: "application/json",
  Origin: STAYFORLONG_ORIGIN,
  Referer: `${STAYFORLONG_ORIGIN}/`,
  "x-url-market": "de",
  "x-url-language": "de",
};

async function fetchJson(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(35_000),
    headers: API_HEADERS,
  });
  if (!response.ok) throw new Error(`Stayforlong HTTP ${response.status}`);
  if (!(response.headers.get("content-type") ?? "").includes("application/json"))
    throw new Error("Stayforlong JSON olmayan yanıt döndürdü.");
  return response.json() as Promise<unknown>;
}

async function verifyOffer(
  fetchImpl: typeof fetch,
  candidate: StayforlongOffer,
  nights: number,
) {
  const url = new URL(
    `${API_ORIGIN}/v2/availability/${encodeURIComponent(candidate.availabilityId)}/bookingRules`,
  );
  const data = await fetchJson(fetchImpl, url.toString());
  return parseVerifiedStayforlongOffer(data, candidate, nights);
}

function roomFeatures(offer: StayforlongOffer): RoomFeatures {
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
  return classifyRoom(offer.roomName, offer.roomCode);
}

export async function collectStayforlongLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderCollectionResult> {
  const config =
    STAYFORLONG_HOTEL_CONFIG[scope.hotelKey as StayforlongHotelKey];
  if (!config || scope.currency !== "EUR") {
    const reason = "Stayforlong Almanya için bu otel/EUR eşleştirmesi doğrulanmadı.";
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
      warnings: [`Stayforlong / ${scope.hotelName}: ${reason}`],
      offers: [],
    };
  }

  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];

  for (const window of scope.windows) {
    const sourceHint = buildStayforlongSourceUrl(config.slug, window);
    try {
      const data = await fetchJson(
        fetchImpl,
        buildStayforlongAvailabilityUrl(config.propertyId, window),
      );
      const candidates = parseStayforlongOffers(
        data,
        config.propertyId,
        scope.hotelKey as StayforlongHotelKey,
        window.nights,
      );
      const groups = new Map<string, StayforlongOffer[]>();
      for (const candidate of candidates) {
        const key = candidate.matchedRoomId ?? "unmatched";
        groups.set(key, [...(groups.get(key) ?? []), candidate]);
      }

      const verifiedGroups = await Promise.all(
        [...groups].map(async ([groupKey, group]) => {
          let selected: CollectedOffer | undefined;
          for (const candidate of group
            .sort((a, b) => a.totalPrice - b.totalPrice)
            .slice(0, 4)) {
            try {
              const verification = await verifyOffer(
                fetchImpl,
                candidate,
                window.nights,
              );
              const observedAt = new Date().toISOString();
              selected = {
                id: `stayforlong:${scope.id}:${window.id}:${candidate.availabilityId}`,
                providerKey: provider.key,
                scopeKey: scope.id,
                windowId: window.id,
                checkIn: window.checkIn,
                checkOut: window.checkOut,
                nights: window.nights,
                rooms: 1,
                adults: 2,
                price: verification.price,
                currency: "EUR",
                roomName: candidate.roomName,
                roomFeatures: roomFeatures(candidate),
                terms: {
                  board: candidate.boardName,
                  cancellation: verification.cancellation,
                  taxes: verification.taxes,
                  operator: "Stayforlong",
                  availability: verification.availability,
                },
                sourceHint,
                observedAt,
                matchedRoomId: candidate.matchedRoomId,
                matchReason: candidate.matchedRoomId
                  ? `Stayforlong oda adı ve kodu ${candidate.matchedRoomId} kategorisiyle eşleşti.`
                  : "Stayforlong teklifi doğrulandı ancak oda kategorisi güvenle eşleştirilemedi.",
                sourceOfferId: candidate.availabilityId,
                sourceProductCode: candidate.normalizedRoomCode,
                sourceTravelType: "Accommodation",
                sourceSystemCode: String(config.propertyId),
                sourceBoardCode: candidate.boardCode,
              };
              break;
            } catch (error) {
              warnings.push(
                `Stayforlong / ${scope.hotelName} / ${window.checkIn} / ${groupKey}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
          return selected;
        }),
      );
      const verified = verifiedGroups.filter(
        (offer): offer is CollectedOffer => Boolean(offer),
      );
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
            ? `${best.terms.board}; ${window.nights} gece; 1 oda / 2 yetişkin; EUR doğrulanmış toplam.`
            : undefined,
          reason: best
            ? undefined
            : candidates.length === 0
              ? "Stayforlong kesin tarihli hotel-only aramasında teklif döndürmedi."
              : hadCandidate
                ? "Stayforlong oda teklifi bulundu ancak bookingRules doğrulaması tamamlanamadı."
                : "Stayforlong teklifleri bulundu ancak bu oda kategorisi eşleşmedi.",
        });
      }

      warnings.push(
        `Stayforlong / ${scope.hotelName} / ${window.checkIn}: ${candidates.length} teklif bulundu; ${verified.length} oda teklifi bookingRules ile doğrulandı.`,
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.split("\n")[0] : String(error);
      warnings.push(
        `Stayforlong / ${scope.hotelName} / ${window.checkIn}: ${reason}`,
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
