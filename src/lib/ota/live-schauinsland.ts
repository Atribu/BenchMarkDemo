import type {
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";

import { createPatchrightBrowserPage } from "./patchright-browser";
import { buildManualReviewQuotes } from "./live-helpers";
import { matchSchauinslandRoom } from "./schauinsland-rooms";
import { SCHAUINSLAND_HOTEL_CONFIG } from "./live-config";


export interface SchauinslandOffer {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  nights: number;

  roomName: string;
  roomCode: string;
  boardCode: string;
  boardName: string;

  totalPrice: number;
  currency: "EUR";
  tourOperator: "SLR";

  // GraphQL teklif metadata
  offerId: string | null;
  externalId: string | null;
  productCode: string | null;
  travelType: string | null;
  sourceCode: string | null;
  hotelOfferCategory: number | null;
}


export interface SchauinslandSearchCriteria {
  hotelId: "4893" | "4894";
  checkIn: string;
  checkOut: string;
  nights: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as UnknownRecord;
}

function getRecord(
  value: UnknownRecord | null,
  key: string,
): UnknownRecord | null {
  return asRecord(value?.[key]);
}

function getString(
  value: UnknownRecord | null,
  key: string,
): string | null {
  const result = value?.[key];

  return typeof result === "string" ? result : null;
}

export function parseSchauinslandOffers(
  response: unknown,
  criteria: SchauinslandSearchCriteria,
): SchauinslandOffer[] {
  const root = asRecord(response);
  const data = getRecord(root, "data");
  const productOffers = getRecord(data, "productOffers");

  const hotels = productOffers?.hotels;

  if (!Array.isArray(hotels)) {
    return [];
  }

  const parsedOffers: SchauinslandOffer[] = [];

  for (const hotel of hotels) {
    const hotelResult = asRecord(hotel);
    const offers = hotelResult?.offers;

    if (!Array.isArray(offers)) {
      continue;
    }

    for (const rawOffer of offers) {
      const offer = asRecord(rawOffer);

      if (!offer) continue;

    


      const hotelContentId = getRecord(
        offer,
        "hotelContentId",
      );

      const tourOperator = getRecord(
        offer,
        "tourOperator",
      );

      const offerStart = getRecord(offer, "offerStart");
      const offerEnd = getRecord(offer, "offerEnd");
      const price = getRecord(offer, "price");

      // 1. Yalnızca beklediğimiz otelin teklifleri
const giataId = hotelContentId?.giataId;

if (
  typeof giataId !== "string" &&
  typeof giataId !== "number"
) {
  continue;
}

if (String(giataId) !== criteria.hotelId) {
  continue;
}

      // 2. Yalnızca Schauinsland Reisen
      if (getString(tourOperator, "code") !== "SLR") {
        continue;
      }


      // 3. Kesin giriş ve çıkış tarihleri
      if (
        getString(offerStart, "date") !== criteria.checkIn ||
        getString(offerEnd, "date") !== criteria.checkOut
      ) {
        continue;
      }

      // 4. Konaklama süresi
      if (offer.lengthOfStay !== criteria.nights) {
        continue;
      }

      // 5. Uçuş içeren paketler hariç
      if (offer.departure != null || offer.return != null) {
        continue;
      }

      // 6. Satılmış teklifler hariç
      if (offer.soldOut !== false) {
        continue;
      }

      // 7. EUR toplam fiyat
      if (getString(price, "currency") !== "EUR") {
        continue;
      }

      const amount = price?.amount;

      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        continue;
      }

      const rooms = getRecord(offer, "rooms")?.room;

      if (!Array.isArray(rooms) || rooms.length !== 1) {
        continue;
      }

      const room = asRecord(rooms[0]);

      if (!room) continue;


      const roomCode = getString(room, "opCode");
      const roomName = getString(
        room,
        "providerDescription",
      );

      if (!roomCode || !roomName) {
        continue;
      }

      const board = getRecord(room, "board");


parsedOffers.push({
  hotelId: criteria.hotelId,
  checkIn: criteria.checkIn,
  checkOut: criteria.checkOut,
  nights: criteria.nights,

  roomName,
  roomCode,
  boardCode: getString(board, "code") ?? "",
  boardName: getString(board, "label") ?? "",

  totalPrice: amount,
  currency: "EUR",
  tourOperator: "SLR",

  offerId: getString(offer, "id"),
  externalId: getString(offer, "externalId"),
  productCode: getString(offer, "productCode"),
  travelType: getString(offer, "travelType"),
  sourceCode: getString(offer, "sourceCode"),
  hotelOfferCategory:
    typeof offer.hotelOfferCategory === "number"
      ? offer.hotelOfferCategory
      : null,
});

    }
  }

  return parsedOffers;
}


export function buildSchauinslandCollectedOffers(
  parsedOffers: SchauinslandOffer[],
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: ReportScopeDefinition["windows"][number],
  sourceHint: string,
  collectedAt: string,
  
): CollectedOffer[] {
  return parsedOffers.map((offer, index) => {
    const match = matchSchauinslandRoom(
      scope,
      offer.roomCode,
      offer.roomName,
    );

    const confirmedRoom = match.confirmed
      ? match.room
      : undefined;

    return {
      id: `schauinsland:${scope.id}:${window.id}:${index}`,

      sourceOfferId: offer.offerId ?? undefined,
      sourceProductCode: offer.productCode ?? undefined,
      sourceTravelType: offer.travelType,
      sourceSystemCode: offer.sourceCode ?? undefined,
      sourceBoardCode: offer.boardCode,

      providerKey: provider.key,
      scopeKey: scope.id,
      windowId: window.id,

      checkIn: offer.checkIn,
      checkOut: offer.checkOut,
      nights: offer.nights,

      rooms: 1,
      adults: 2,

      price: offer.totalPrice,
      currency: "EUR",

      roomName: offer.roomName,
      roomFeatures: match.features,

      terms: {
        board: offer.boardName,
        cancellation: "Kaynakta doğrulanmalı",
        taxes: "Kaynakta doğrulanmalı",
        operator: "Schauinsland Reisen",
        availability: "Teklif yanıtında listelendi",
      },

      sourceHint,
      observedAt: collectedAt,

      matchedRoomId: confirmedRoom?.id,

      matchReason: confirmedRoom
        ? match.reason
        : `${match.reason} Otomatik fiyat eşleşmesi için oda özelliklerinin doğrulanması gerekiyor.`,
    };
  });
}


export function getSchauinslandBoardCode(
  requiredBoard: ReportScopeDefinition["requiredBoard"],
): string | undefined {
  switch (requiredBoard) {
    case "all-inclusive":
      return "GT06-AI";

    case "all-inclusive-plus":
      return "GT06-AIP";

    default:
      return undefined;
  }
}


export function selectSchauinslandBestOffer(
  offers: CollectedOffer[],
  roomId: string,
  boardCode?: string,
): CollectedOffer | undefined {
  return offers
    .filter(
      (offer) =>
        offer.matchedRoomId === roomId &&
        (!boardCode || offer.sourceBoardCode === boardCode),
    )
    .sort((a, b) => a.price - b.price)[0];
}


export function getSchauinslandPaginationOffsets(
  resultsTotal: number,
  pageSize = 50,
): number[] {
  if (
    !Number.isSafeInteger(resultsTotal) ||
    resultsTotal < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize <= 0
  ) {
    throw new Error("Geçersiz Schauinsland pagination değeri.");
  }

  const offsets: number[] = [];

  for (let offset = 0; offset < resultsTotal; offset += pageSize) {
    offsets.push(offset);
  }

  return offsets;
}


interface SchauinslandCapturedRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

interface SchauinslandPaginationClient {
  post: (
    url: string,
    options: {
      data: string;
      headers: Record<string, string>;
      timeout: number;
    },
  ) => Promise<{
    status: () => number;
    json: () => Promise<unknown>;
  }>;
}

export async function fetchSchauinslandRemainingPages(
  client: SchauinslandPaginationClient,
  captured: SchauinslandCapturedRequest,
  firstResult: unknown,
  pageSize = 50,
): Promise<unknown> {
  const first = asRecord(firstResult);
  const firstData = getRecord(first, "data");
  const firstProductOffers = getRecord(
    firstData,
    "productOffers",
  );

  const pagination = getRecord(
    firstProductOffers,
    "pagination",
  );

  const total = pagination?.resultsTotal;
  const firstHotels = firstProductOffers?.hotels;

  if (
    typeof total !== "number" ||
    !Array.isArray(firstHotels)
  ) {
    throw new Error(
      "Schauinsland pagination bilgisi eksik.",
    );
  }

  const offsets = getSchauinslandPaginationOffsets(
    total,
    pageSize,
  );

  // Güvenlik sınırı: sınırsız sayfa isteği gönderme.
  if (offsets.length > 20) {
    throw new Error(
      "Schauinsland pagination güvenlik sınırı aşıldı.",
    );
  }

  const allHotels: unknown[] = [...firstHotels];

  const seenIds = new Set<string>();
  let receivedCount = 0;

  function appendOfferIds(hotels: unknown[]) {
    for (const rawHotel of hotels) {
      const hotel = asRecord(rawHotel);
      const offers = hotel?.offers;

      if (!Array.isArray(offers)) {
        throw new Error(
          "Schauinsland sayfasında teklif listesi eksik.",
        );
      }

      for (const rawOffer of offers) {
        const offer = asRecord(rawOffer);
        const id = getString(offer, "id");

        if (!id || seenIds.has(id)) {
          throw new Error(
            "Schauinsland teklif kimliği eksik veya tekrarlı.",
          );
        }

        seenIds.add(id);
        receivedCount += 1;
      }
    }
  }

  appendOfferIds(firstHotels);

  if (receivedCount > Math.min(pageSize, total)) {
    throw new Error(
      "Schauinsland ilk sayfası beklenen boyutu aşıyor.",
    );
  }

  const originalPayload = JSON.parse(
    captured.body,
  ) as unknown;

  const originalOperations = Array.isArray(
    originalPayload,
  )
    ? originalPayload
    : [originalPayload];

  const operationIndex = originalOperations.findIndex(
    (operation) =>
      asRecord(operation)?.operationName === "getOfferList",
  );

  if (operationIndex < 0) {
    throw new Error(
      "Schauinsland GraphQL operasyonu bulunamadı.",
    );
  }

  // Browser context çerezleri otomatik kullanılır.
  // Eski Content-Length/Cookie gibi başlıklar taşınmaz.
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(
    captured.headers,
  )) {
    const lower = key.toLowerCase();

    if (
      lower === "content-type" ||
      lower === "accept" ||
      lower === "authorization" ||
      lower === "origin" ||
      lower === "referer" ||
      lower.startsWith("x-")
    ) {
      headers[key] = value;
    }
  }

  for (const offset of offsets.slice(1)) {
    const operations = structuredClone(
      originalOperations,
    ) as UnknownRecord[];

    const operation = operations[operationIndex];
    const variables = getRecord(
      operation,
      "variables",
    );
    const packageRequest = getRecord(
      variables,
      "packageOfferRequest",
    );

    if (!variables || !packageRequest) {
      throw new Error(
        "Schauinsland GraphQL değişkenleri eksik.",
      );
    }

    const originalPagination = getRecord(
      packageRequest,
      "pagination",
    );

    operation.variables = {
      ...variables,
      packageOfferRequest: {
        ...packageRequest,
        pagination: {
          ...originalPagination,
          resultsPerPage: pageSize,
          showingResultsFrom: offset,
        },
      },
    };

    const body = JSON.stringify(
      Array.isArray(originalPayload)
        ? operations
        : operations[0],
    );

    const response = await client.post(
      captured.url,
      {
        data: body,
        headers,
        timeout: 45_000,
      },
    );

    if (response.status() !== 200) {
      throw new Error(
        `Schauinsland sayfa HTTP ${response.status()} ` +
          `(offset=${offset})`,
      );
    }

    const responseBody = await response.json();

    const results = Array.isArray(responseBody)
      ? responseBody
      : [responseBody];

    const result = asRecord(
      results[operationIndex] ??
        (operations.length === 1
          ? results[0]
          : null),
    );

    const errors = result?.errors;

    if (
      !result ||
      (Array.isArray(errors) && errors.length > 0)
    ) {
      throw new Error(
        `Schauinsland GraphQL sayfa hatası: ${offset}`,
      );
    }

    const data = getRecord(result, "data");
    const productOffers = getRecord(
      data,
      "productOffers",
    );
    const pagePagination = getRecord(
      productOffers,
      "pagination",
    );
    const hotels = productOffers?.hotels;

    if (
      pagePagination?.resultsTotal !== total ||
      !Array.isArray(hotels)
    ) {
      throw new Error(
        "Schauinsland pagination toplamı değişti.",
      );
    }

    appendOfferIds(hotels);
    allHotels.push(...hotels);

    console.log(
      "[SCHAUINSLAND] Additional page:",
      {
        offset,
        receivedCount,
        resultsTotal: total,
      },
    );
  }

  if (receivedCount !== total) {
    throw new Error(
      `Schauinsland teklif listesi eksik: ` +
        `${receivedCount}/${total}`,
    );
  }

  return {
    ...first,
    data: {
      ...firstData,
      productOffers: {
        ...firstProductOffers,
        hotels: allHotels,
      },
    },
  };
}


function buildSchauinslandUrl(
  pageUrl: string,
  nights: number,
): string {
  const url = new URL(pageUrl);

  url.searchParams.set("nodes", "1030");
  url.searchParams.set("bookingType", "HOTEL_ONLY");
  url.searchParams.set("travellers", "25-1_25-2");
  url.searchParams.set("minD", String(nights));
  url.searchParams.set("maxD", String(nights));
  url.searchParams.set("pdp.activeTab", "offers");

  return url.toString();
}

export async function collectSchauinslandLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];

const hotelConfig =
  SCHAUINSLAND_HOTEL_CONFIG[scope.hotelKey];

if (
  !hotelConfig ||
  scope.currency !== hotelConfig.currency
) {
    return buildManualReviewQuotes(
      provider,
      scope,
      "https://www.schauinsland-reisen.de/",
      "Schauinsland için otel kimliği veya EUR kapsamı doğrulanmadı.",
    );
  }

  for (const window of scope.windows) {
const sourceHint = buildSchauinslandUrl(
  hotelConfig.pageUrl,
  window.nights,
);

    let handle:
      | Awaited<ReturnType<typeof createPatchrightBrowserPage>>
      | undefined;

    try {
      handle = await createPatchrightBrowserPage({
        profilePath: `./.benchmark-state/schauinsland-${scope.id}`,
        headless: false,
        market: "de",
      });

      const page = handle.page;

      let capturedGraphqlRequest:
  | {
      url: string;
      body: string;
      headers: Record<string, string>;
    }
  | undefined;

      // GraphQL isteğini sayfa açılmadan önce yakala.
      await page.route("**/api/graphql", async (route) => {
        const request = route.request();

        if (request.method() !== "POST") {
          await route.continue();
          return;
        }

        let updatedPostData: string | undefined;

        try {
          const payload = request.postDataJSON();

          const operations = Array.isArray(payload)
            ? payload
            : [payload];

          let modified = false;

          const updatedOperations = operations.map(
            (operation) => {
              if (
                operation?.operationName !== "getOfferList"
              ) {
                return operation;
              }

              const packageRequest =
                operation.variables?.packageOfferRequest;

                console.log("[SCHAUINSLAND] Pagination request:", {
  hotel: scope.hotelName,
  pagination: packageRequest?.pagination,
  sortingOrder: packageRequest?.sortingOrder,
});

              const productSearch =
                packageRequest?.productSearch;

              if (
                !productSearch ||
                productSearch.bookingType !== "HOTEL_ONLY" ||
                !productSearch.hotelFilter?.references
  ?.hotelCodes?.includes(hotelConfig.giataId)
              ) {
                return operation;
              }

              modified = true;

              return {
                ...operation,
                variables: {
                  ...operation.variables,
                  packageOfferRequest: {
  ...packageRequest,

  pagination: {
    ...packageRequest.pagination,
    resultsPerPage: 50,
    showingResultsFrom: 0,
  },

  productSearch: {
    ...productSearch,
                      travelPeriod: {
                        ...productSearch.travelPeriod,
                        departureDateTime: {
                          ...productSearch.travelPeriod
                            ?.departureDateTime,
                          dateRangeFilter: {
                            minDate: window.checkIn,
                          },
                        },
                        returnDateTime: {
                          ...productSearch.travelPeriod
                            ?.returnDateTime,
                          dateRangeFilter: {
                            maxDate: window.checkOut,
                          },
                        },
                        minDuration: window.nights,
                        maxDuration: window.nights,
                      },
                    },
                  },
                },
              };
            },
          );

          if (modified) {
            updatedPostData = JSON.stringify(
              Array.isArray(payload)
                ? updatedOperations
                : updatedOperations[0],
            );

            console.log(
              "[SCHAUINSLAND] Exact date filter:",
              {
                hotel: scope.hotelName,
                checkIn: window.checkIn,
                checkOut: window.checkOut,
                nights: window.nights,
              },
            );
          }
        } catch (error) {
          console.log(
            "[SCHAUINSLAND] Request inspection:",
            error instanceof Error
              ? error.message
              : String(error),
          );
        }

       
if (updatedPostData !== undefined) {
  capturedGraphqlRequest = {
    url: request.url(),
    body: updatedPostData,
    headers: request.headers(),
  };
}

await route.continue(
  updatedPostData !== undefined
    ? { postData: updatedPostData }
    : undefined,
);

      });

      // Yalnızca doğru getOfferList isteğini bekle.

const offerResponsePromise = page.waitForResponse(
  (response) => {
    const request = response.request();

    if (
      new URL(response.url()).pathname !== "/api/graphql" ||
      request.method() !== "POST"
    ) {
      return false;
    }

    try {
      const payload = request.postDataJSON();

      const operations = Array.isArray(payload)
        ? payload
        : [payload];

      return operations.some((operation) => {
        const search =
          operation?.variables?.packageOfferRequest
            ?.productSearch;

        return (
          operation?.operationName === "getOfferList" &&
          search?.bookingType === "HOTEL_ONLY" &&
          search?.hotelFilter?.references
  ?.hotelCodes?.includes(hotelConfig.giataId) &&
          search?.travellersFilter?.length === 2
        );
      });
    } catch {
      return false;
    }
  },
  { timeout: 45_000 },
);


      // Navigasyon.
      const navigation = await page.goto(sourceHint, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      if (!navigation || navigation.status() !== 200) {
        throw new Error(
          `Schauinsland navigasyon HTTP ${navigation?.status() ?? "unknown"}`,
        );
      }

   // GraphQL teklif yanıtını doğrula.
      const offerResponse = await offerResponsePromise;

      if (offerResponse.status() !== 200) {
        throw new Error(
          `Schauinsland GraphQL HTTP ${offerResponse.status()}`,
        );
      }

      const responseJson = await offerResponse.json();

      // GraphQL batch yanıtları için.
      const results = Array.isArray(responseJson)
        ? responseJson
        : [responseJson];

      const requestPayload =
        offerResponse.request().postDataJSON();

      const operations = Array.isArray(requestPayload)
        ? requestPayload
        : [requestPayload];

      const offerIndex = operations.findIndex(
        (operation) =>
          operation?.operationName === "getOfferList",
      );

      if (offerIndex < 0) {
        throw new Error(
          "Schauinsland getOfferList yanıtı bulunamadı.",
        );
      }

      const offerResult =
        results[offerIndex] ??
        (operations.length === 1 ? results[0] : undefined);

const productOffers = offerResult?.data?.productOffers;

console.log("[SCHAUINSLAND] Pagination response:", {
  hotel: scope.hotelName,
  pagination: productOffers?.pagination,
  hotelCount: productOffers?.hotels?.length ?? 0,
  offerCount:
    productOffers?.hotels?.reduce(
      (
        total: number,
        hotel: { offers?: unknown[] },
      ) => total + (hotel.offers?.length ?? 0),
      0,
    ) ?? 0,
});

        console.log("[SCHAUINSLAND] GraphQL diagnostics:", {
  responseCount: results.length,
  operationCount: operations.length,
  offerIndex,
  hasOfferResult: Boolean(offerResult),
  dataKeys: Object.keys(offerResult?.data ?? {}),
  errors: offerResult?.errors?.map(
    (error: { message?: string }) => ({
      message: error.message,
    }),
  ),
});

      if (!offerResult || offerResult.errors?.length) {
        throw new Error(
          "Schauinsland GraphQL teklif yanıtı hatalı.",
        );
      }


if (!capturedGraphqlRequest) {
  throw new Error(
    "Schauinsland GraphQL istek bilgileri yakalanamadı.",
  );
}

const completeOfferResult =
  await fetchSchauinslandRemainingPages(
    page.request,
    capturedGraphqlRequest,
    offerResult,
  );

const parsedOffers = parseSchauinslandOffers(
  completeOfferResult,
  {
    hotelId: hotelConfig.giataId,
    checkIn: window.checkIn,
    checkOut: window.checkOut,
    nights: window.nights,
  },
);



console.table(
  parsedOffers.map((offer) => ({
    hotel: scope.hotelName,
    code: JSON.stringify(offer.roomCode),
    room: offer.roomName,
    board: offer.boardCode,
    productCode: offer.productCode,
    travelType: offer.travelType,
    totalPrice: offer.totalPrice,
  })),
);




const completeProductOffers = getRecord(
  getRecord(
    asRecord(completeOfferResult),
    "data",
  ),
  "productOffers",
);

const completePagination = getRecord(
  completeProductOffers,
  "pagination",
);

console.log("[SCHAUINSLAND] Complete pagination:", {
  hotel: scope.hotelName,
  resultsTotal: completePagination?.resultsTotal,
  parsedOffers: parsedOffers.length,
});


      if (parsedOffers.length === 0) {
  warnings.push(
    `Schauinsland / ${scope.hotelName} / ${window.checkIn}: ` +
      "Seçilen tarihler için doğrulanmış SLR teklifi bulunamadı.",
  );
}

      console.log("[SCHAUINSLAND] Collection:", {
        hotel: scope.hotelName,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        verifiedOffers: parsedOffers.length,
      });

      const collectedAt = new Date().toISOString();


const matchedOffers = buildSchauinslandCollectedOffers(
  parsedOffers,
  provider,
  scope,
  window,
  sourceHint,
  collectedAt,
);


      offers.push(...matchedOffers);

      // Her benchmark oda kategorisi için en ucuz
      // uygun teklifi seç.
      for (const room of scope.rooms) {

const best = selectSchauinslandBestOffer(
  matchedOffers,
  room.id,
  getSchauinslandBoardCode(scope.requiredBoard),
);


        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: best?.price ?? null,
          currency: scope.currency,
          status: best ? "available" : "manual-review",
          dataMode: "live",
          captureMethod: "automated",
          observedAt: collectedAt,
          sourceHint,
          offerDescription: best?.roomName,
          roomFeatures: best?.roomFeatures,
          terms: best?.terms,
          offerConditions: best
            ? `${best.terms.board}; Schauinsland Reisen; ${window.nights} gece; 1 oda / 2 yetişkin; EUR toplam fiyat; iptal ve vergi koşulları ayrıca doğrulanmalı.`
            : undefined,
          reason: best
            ? undefined
            : "Bu oda kategorisi için doğrulanmış Schauinsland eşleşmesi bulunamadı.",
        });
      }
    } catch (error) {
      console.error("[SCHAUINSLAND] Collection failed:", {
  hotel: scope.hotelName,
  checkIn: window.checkIn,
  checkOut: window.checkOut,
  nights: window.nights,
  error:
    error instanceof Error
      ? error.message
      : String(error),
});

      const reason =
        error instanceof Error
          ? error.message.split("\n")[0]
          : "Schauinsland fiyatları doğrulanamadı.";

      warnings.push(
        `Schauinsland / ${scope.hotelName} / ${window.checkIn}: ${reason}`,
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

  return { quotes, offers, warnings };
}
