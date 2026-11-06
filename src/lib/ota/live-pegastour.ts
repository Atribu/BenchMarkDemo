import type {
  BenchmarkWindowDefinition,
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
  RoomFeatures,
} from "../benchmark/types";
import { createPatchrightBrowserPage } from "./patchright-browser";
import { resolveRoomMatch } from "./offer-matching";
import type { DynamicOtaCollectorConfig } from "../hotels/runtime-manifest";

const PEGAS_ORIGIN = "https://pegast.ru";
const SEARCH_ENDPOINT = "/hotelOnlyTours/search/searchByHotel";

export const PEGAS_HOTEL_CONFIG = {
  "port-nature": {
    hotelId: 6609069,
    locationId: 7192,
    hotelName: "Port Nature Luxury Resort Hotel & Spa",
    pageUrl:
      "https://pegast.ru/hotel/turkey/antalya/belek/port-nature-luxury-resort-hotel-and-spa-6609069",
  },
  "sy-hotels-belek": {
    hotelId: 816187159,
    locationId: 7192,
    hotelName: "SY Hotels Belek Boutique Luxury",
    pageUrl:
      "https://pegast.ru/hotel/turkey/antalya/belek/sy-hotels-belek-boutique-luxury-816187159",
  },
} as const;

type PegasHotelKey = keyof typeof PEGAS_HOTEL_CONFIG;

export interface PegasSearchPayload {
  hotel: {
    countryIds: number[];
    regionIds: number[];
    locationIds: number[];
    locationAreaIds: number[];
    hotelsOutsideAreasLocationIds: number[];
    hotelIds: number[];
  };
  startDates: string[];
  durations: number[];
  roomAccommodations: Array<{
    adults: number;
    childrenAges: number[];
  }>;
}

export interface PegasHotelOnlyOffer {
  optionId: string;
  hotelId: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalPrice: number;
  currency: "RUB";
  roomName: string;
  roomCategoryId: string;
  boardName: string;
  boardCode: string;
  matchedRoomId?: string;
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

function sourceDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

export function matchPegasRoom(
  roomName: string,
  hotelKey: PegasHotelKey = "port-nature",
): string | undefined {
  const text = normalize(roomName);
  if (hotelKey === "sy-hotels-belek") {
    if (/(family|семеи)/.test(text) && /(swim up|swimup)/.test(text))
      return "deluxe-family-swim-up";
    if (/(duplex|dublex|дуплекс)/.test(text) && /(family|семеи)/.test(text))
      return "deluxe-duplex-family";
    if (/(family|семеи)/.test(text)) return "deluxe-family";
    if (/(shallow pool|мелк)/.test(text)) return "deluxe-shallow-pool";
    if (/superior/.test(text)) return "deluxe-superior";
    if (/(swim up|swimup)/.test(text)) return "deluxe-swim-up";
    if (/(pool view|вид на бассейн)/.test(text)) return "deluxe-pool";
    if (/(land view|ландшафт|суш)/.test(text)) return "deluxe-land";
    return undefined;
  }
  if (/(family|familien|семеи)/.test(text)) return "family";
  if (/(king|royal|королев)/.test(text) && /(suite|suit|сьют)/.test(text))
    return "king-suite";
  if (
    /(side sea|side seaview|partial sea|seitlich|боков)/.test(text) &&
    /(sea|meer|мор)/.test(text)
  )
    return "standard-side-sea";
  if (/(sea|seaview|meer|мор)/.test(text)) return "standard-sea";
  if (/(land|garden|landschaft|ландшафт|суш)/.test(text))
    return "standard-land";
  return undefined;
}

export function matchPegasRuntimeRoom(
  scope: ReportScopeDefinition,
  roomName: string,
  runtimeConfig?: DynamicOtaCollectorConfig,
): string | undefined {
  if (!runtimeConfig)
    return matchPegasRoom(roomName, scope.hotelKey as PegasHotelKey);
  return resolveRoomMatch(
    scope,
    roomName,
    runtimeConfig.roomAliases,
    "",
    runtimeConfig.matchingPolicy,
  ).matchedRoomId;
}

export function buildPegasSearchPayload(
  hotelId: number,
  window: BenchmarkWindowDefinition,
): PegasSearchPayload {
  return {
    hotel: {
      countryIds: [],
      regionIds: [],
      locationIds: [],
      locationAreaIds: [],
      hotelsOutsideAreasLocationIds: [],
      hotelIds: [hotelId],
    },
    startDates: [window.checkIn],
    durations: [window.nights],
    roomAccommodations: [{ adults: 2, childrenAges: [] }],
  };
}

function referenceName(
  referenceDescription: Record<string, unknown> | undefined,
  collectionName: string,
  id: unknown,
): string {
  const collection = referenceDescription?.[collectionName];
  if (!Array.isArray(collection)) return "";
  const item = collection.find((candidate) => {
    const record = asRecord(candidate);
    return String(record?.id ?? "") === String(id ?? "");
  });
  const record = asRecord(item);
  return typeof record?.name === "string" ? record.name.trim() : "";
}

function paymentCurrencyIsRub(paymentCurrency: Record<string, unknown>): boolean {
  const parts = asRecord(paymentCurrency.parts);
  const currency = asRecord(parts?.currency);
  const explicitCodes = [
    paymentCurrency.currency,
    paymentCurrency.currencyCode,
    paymentCurrency.code,
    currency?.code,
    currency?.isoCode,
  ].filter((value): value is string => typeof value === "string");
  if (explicitCodes.length > 0)
    return explicitCodes.some((value) => value.trim().toUpperCase() === "RUB");
  return /₽|руб/i.test(
    [currency?.symbol, paymentCurrency.formatted]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
}

function allInclusive(boardName: string, boardCode: string): boolean {
  return /all[\s-]*inclusive|все\s+включено|ультра|ultra|premium|премиум/i.test(
    `${boardName} ${boardCode}`,
  );
}

export function parsePegasHotelOnlyOffers(
  value: unknown,
  expected: {
    hotelId: number;
    checkIn: string;
    checkOut: string;
    nights: number;
    hotelKey?: PegasHotelKey;
    matchRoom?: (roomName: string) => string | undefined;
  },
): PegasHotelOnlyOffer[] {
  const root = asRecord(value);
  if (!root) throw new Error("Pegas hotel-only yanıtı beklenen biçimde değil.");
  if (root.ok === false)
    throw new Error(
      typeof root.errorDescription === "string"
        ? root.errorDescription
        : "Pegas hotel-only sorgusu başarısız oldu.",
    );
  const data = asRecord(root.data) ?? root;
  const accommodationOptions = data.accommodationOptions;
  if (accommodationOptions === null || accommodationOptions === undefined) {
    if (root.ok === true && root.data === null) return [];
    throw new Error("Pegas konaklama seçenekleri yanıtı eksik.");
  }
  if (!Array.isArray(accommodationOptions))
    throw new Error("Pegas konaklama seçenekleri liste değil.");

  const checkIn = sourceDate(data.startDate ?? data.checkInDate);
  const nights = Number(data.duration ?? data.nights);
  const checkOut =
    sourceDate(data.endDate ?? data.checkOutDate) ??
    (checkIn && Number.isFinite(nights) ? addDays(checkIn, nights) : undefined);
  if (
    checkIn !== expected.checkIn ||
    checkOut !== expected.checkOut ||
    nights !== expected.nights
  )
    throw new Error("Pegas yanıtındaki tarihler benchmark aralığıyla eşleşmiyor.");

  const hotel = asRecord(data.hotel);
  const rawHotelId = hotel?.hotelId ?? data.hotelId;
  const hotelId = Number(rawHotelId);
  const hasHotelId = rawHotelId !== null && rawHotelId !== undefined;

  // PEGAS doğrulanmış fakat boş bir aramada `hotel: null` ve
  // `accommodationOptions: []` döndürüyor. İstek zaten tek bir hotelId ile
  // gönderildiği ve yanıt tarihleri birebir doğrulandığı için bu durum
  // kimlik uyuşmazlığı değil, teklif bulunmaması anlamına gelir.
  if (!hasHotelId && accommodationOptions.length === 0) return [];
  if (!hasHotelId || hotelId !== expected.hotelId)
    throw new Error("Pegas yanıtındaki otel benchmark oteliyle eşleşmiyor.");

  const referenceDescription = asRecord(data.referenceDescription);
  const seen = new Set<string>();
  const offers: PegasHotelOnlyOffer[] = [];

  accommodationOptions.forEach((rawAccommodation, accommodationIndex) => {
    const accommodation = asRecord(rawAccommodation);
    const rooms = accommodation?.rooms;
    if (!Array.isArray(rooms) || rooms.length !== 1) return;
    const room = asRecord(rooms[0]);
    const options = room?.options;
    if (!Array.isArray(options)) return;

    const roomCategoryId = String(room?.roomCategoryId ?? "");
    const roomName =
      referenceName(referenceDescription, "roomCategories", roomCategoryId) ||
      (typeof room?.roomCategoryName === "string"
        ? room.roomCategoryName.trim()
        : "");
    if (!roomName) return;

    options.forEach((rawOption, optionIndex) => {
      const option = asRecord(rawOption);
      const paymentCurrency = asRecord(
        asRecord(option?.pricePerStay)?.paymentCurrency,
      );
      const totalPrice = positiveNumber(paymentCurrency?.raw);
      if (
        totalPrice === undefined ||
        !paymentCurrency ||
        !paymentCurrencyIsRub(paymentCurrency)
      )
        return;

      const boardTypeId = option?.boardTypeId;
      const boardTypeGroupId = option?.boardTypeGroupId;
      const boardName =
        referenceName(referenceDescription, "hotelBoardTypes", boardTypeId) ||
        referenceName(
          referenceDescription,
          "hotelBoardTypeGroups",
          boardTypeGroupId,
        ) ||
        (typeof option?.boardTypeName === "string"
          ? option.boardTypeName.trim()
          : "");
      const boardCode = String(
        option?.boardTypeCode ?? boardTypeId ?? boardTypeGroupId ?? "",
      );
      if (!boardName || !allInclusive(boardName, boardCode)) return;

      const optionId = String(
        option?.id ??
          option?.optionId ??
          `${accommodationIndex}-${optionIndex}-${roomCategoryId}`,
      );
      const uniqueKey = `${optionId}:${roomCategoryId}:${totalPrice}`;
      if (seen.has(uniqueKey)) return;
      seen.add(uniqueKey);
      offers.push({
        optionId,
        hotelId,
        checkIn,
        checkOut,
        nights,
        totalPrice,
        currency: "RUB",
        roomName,
        roomCategoryId,
        boardName,
        boardCode,
        matchedRoomId: expected.matchRoom
          ? expected.matchRoom(roomName)
          : matchPegasRoom(roomName, expected.hotelKey),
      });
    });
  });

  return offers;
}

function roomFeatures(offer: PegasHotelOnlyOffer): RoomFeatures {
  if (offer.matchedRoomId === "standard-land")
    return { category: "standard", view: "land", balcony: "unknown" };
  if (offer.matchedRoomId === "standard-side-sea")
    return { category: "standard", view: "partial-sea", balcony: "unknown" };
  if (offer.matchedRoomId === "standard-sea")
    return { category: "standard", view: "sea", balcony: "unknown" };
  return { category: "variant", view: "unknown", balcony: "unknown" };
}

function missingQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  reason: string,
): ProviderQuote[] {
  return scope.rooms.flatMap((room) =>
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
  );
}

async function searchPegasHotelOnly(
  page: Awaited<ReturnType<typeof createPatchrightBrowserPage>>["page"],
  payload: PegasSearchPayload,
): Promise<unknown> {
  const response = await page.evaluate(
    async ({ endpoint, requestPayload }) => {
      const result = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });
      return {
        status: result.status,
        contentType: result.headers.get("content-type") ?? "",
        body: await result.text(),
      };
    },
    { endpoint: SEARCH_ENDPOINT, requestPayload: payload },
  );
  if (response.status !== 200)
    throw new Error(`Pegas hotel-only servisi HTTP ${response.status}`);
  if (!response.contentType.includes("application/json"))
    throw new Error("Pegas hotel-only servisi JSON olmayan yanıt döndürdü.");
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new Error("Pegas hotel-only JSON yanıtı okunamadı.");
  }
}

export async function collectPegasTourLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  runtimeConfig?: DynamicOtaCollectorConfig,
): Promise<ProviderCollectionResult> {
  const runtimePegas = runtimeConfig?.pegastour;
  const config = runtimePegas
    ? {
        hotelId: runtimePegas.hotelId,
        hotelName: runtimePegas.hotelName,
        pageUrl: runtimeConfig.pageUrl,
      }
    : PEGAS_HOTEL_CONFIG[scope.hotelKey as PegasHotelKey];
  if (!config || scope.currency !== "RUB") {
    const reason = "Pegas Touristik Rusya için bu otel/RUB eşleştirmesi doğrulanmadı.";
    return {
      quotes: missingQuotes(provider, scope, reason),
      warnings: [`Pegas Touristik / ${scope.hotelName}: ${reason}`],
      offers: [],
    };
  }

  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];
  let handle: Awaited<ReturnType<typeof createPatchrightBrowserPage>> | undefined;

  try {
    handle = await createPatchrightBrowserPage({
      profilePath: `./.benchmark-state/pegastour-ru-${scope.id}-${process.pid}`,
      headless: false,
      market: "ru",
      proxyUrl:
        process.env.PEGASTOUR_RU_PROXY_URL || process.env.OTA_PROXY_URL || undefined,
    });
    const navigation = await handle.page.goto(config.pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!navigation || navigation.status() !== 200)
      throw new Error(`Pegas otel sayfası HTTP ${navigation?.status() ?? "unknown"}`);
    const bodyText = await handle.page.locator("body").innerText();
    if (/Доступ временно ограничен|Access denied/i.test(bodyText))
      throw new Error("Pegas otomatik erişimi geçici olarak sınırlandırdı.");
    if (!bodyText.toLocaleLowerCase("ru-RU").includes(config.hotelName.toLocaleLowerCase("ru-RU")))
      throw new Error("Pegas otel sayfası beklenen otel kimliğini doğrulamadı.");

    for (const window of scope.windows) {
      try {
        const data = await searchPegasHotelOnly(
          handle.page,
          buildPegasSearchPayload(config.hotelId, window),
        );
        const parsed = parsePegasHotelOnlyOffers(data, {
          hotelId: config.hotelId,
          checkIn: window.checkIn,
          checkOut: window.checkOut,
          nights: window.nights,
          hotelKey: scope.hotelKey as PegasHotelKey,
          matchRoom: runtimeConfig
            ? (roomName) =>
                matchPegasRuntimeRoom(scope, roomName, runtimeConfig)
            : undefined,
        });
        const observedAt = new Date().toISOString();
        const windowOffers = parsed.map((offer): CollectedOffer => ({
          id: `pegastour:${scope.id}:${window.id}:${offer.optionId}`,
          providerKey: provider.key,
          scopeKey: scope.id,
          windowId: window.id,
          checkIn: window.checkIn,
          checkOut: window.checkOut,
          nights: window.nights,
          rooms: 1,
          adults: 2,
          price: offer.totalPrice,
          currency: "RUB",
          roomName: offer.roomName,
          roomFeatures: roomFeatures(offer),
          terms: {
            board: offer.boardName,
            cancellation: "Rezervasyon adımında doğrulanmalı",
            taxes: "Pegas toplamında; rezervasyon adımında doğrulanmalı",
            operator: "PEGAS Touristik Russia",
            availability: "Pegas hotel-only fiyat servisinde listelendi",
          },
          sourceHint: config.pageUrl,
          observedAt,
          matchedRoomId: offer.matchedRoomId,
          matchReason: offer.matchedRoomId
            ? `Pegas oda adı ${offer.matchedRoomId} kategorisiyle eşleşti.`
            : "Pegas teklifi doğrulandı ancak oda kategorisi güvenle eşleştirilemedi.",
          sourceOfferId: offer.optionId,
          sourceProductCode: offer.roomCategoryId,
          sourceTravelType: "Accommodation",
          sourceSystemCode: String(config.hotelId),
          sourceBoardCode: offer.boardCode,
        }));
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
            status: best ? "available" : "missing",
            dataMode: "live",
            sourceHint: config.pageUrl,
            reason: best
              ? undefined
              : parsed.length === 0
                ? "Seçilen tarihlerde Pegas hotel-only teklif bulunamadı."
                : "Pegas tekliflerinde bu oda kategorisi eşleşmedi.",
            offerDescription: best?.roomName,
            offerConditions: best
              ? `${best.terms.board}; yalnızca konaklama; toplam RUB fiyatı`
              : undefined,
            observedAt: best?.observedAt ?? observedAt,
            roomFeatures: best?.roomFeatures,
            terms: best?.terms,
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Pegas Touristik / ${scope.hotelName} / ${window.checkIn}: ${detail}`,
        );
        for (const room of scope.rooms) {
          quotes.push({
            providerKey: provider.key,
            scopeKey: scope.id,
            roomId: room.id,
            windowId: window.id,
            price: null,
            currency: "RUB",
            status: "manual-review",
            dataMode: "live",
            sourceHint: config.pageUrl,
            reason: detail,
          });
        }
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      quotes: missingQuotes(provider, scope, detail),
      warnings: [`Pegas Touristik / ${scope.hotelName}: ${detail}`],
      offers: [],
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }

  return { quotes, warnings, offers };
}
