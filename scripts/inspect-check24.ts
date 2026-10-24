
import { chromium } from "patchright";
import {
  parseCheck24OldAllOffers, parseCheck24NewRecommendations, parseCheck24NewAllOffers,
} from "../src/lib/ota/check24-parser";

import {
  getCheck24BeachBestOffers, matchCheck24BeachRoom
} from "../src/lib/ota/check24-room-mapping";

const HOTEL_URL =
  "https://hotels.check24.de/accommodation/" +
  "miramare-beach-hotel-ultra-all-inclusive-" +
  "019ab52846f67e3fa61a67dc9422e9de" +
  "?checkinDate=2026-10-31" +
  "&checkoutDate=2026-11-05" +
  "&occupancy=%5BA%7CA%5D";


async function main() {

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
});


  const context = await browser.newContext({
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  const requests: Array<{
    method: string;
    status: number;
    url: string;
    contentType: string;
  }> = [];

  let watchRoomInteractions = false;

page.on("response", (response) => {
  if (!watchRoomInteractions) return;

  const url = new URL(response.url());

  if (
    url.hostname !== "hotels.check24.de" ||
    !url.pathname.startsWith("/api/")
  ) {
    return;
  }

  console.log("[CHECK24 ROOM API]", {
    method: response.request().method(),
    status: response.status(),
    path: url.pathname,
    parameters: [...url.searchParams.keys()],
  });
});

  const inspectedEndpoints = new Set<string>();

  let newOffersResponseCount = 0;

page.on("response", async (response) => {
  const url = response.url();

  if (!url.startsWith("http")) return;

  const parsedUrl = new URL(url);
  const contentType =
    response.headers()["content-type"] ?? "";

  if (
    contentType.includes("json") ||
    /offer|price|search|availability/i.test(url)
  ) {
    requests.push({
      method: response.request().method(),
      status: response.status(),
      url,
      contentType,
    });
  }

  const path = parsedUrl.pathname;

  const isNewOffersApi =
    parsedUrl.hostname === "hotels.check24.de" &&
    path === "/api/offers";


if (
  isNewOffersApi &&
  response.status() === 200
) {
  try {
    const data = await response.json();
    const offers = data?.offers;


if (offers?.status === 2) {
  const allOffers = parseCheck24NewAllOffers(data);


const eligibleOffers = allOffers.filter(
  (offer) =>
    offer.roomOccupancy === "[A|A]" &&
    offer.currency === "EUR" &&
    offer.mealType === "MEAL_TYPE_ALL_INCLUSIVE",
);

const beachRoomCandidates = eligibleOffers
  .map((offer) => ({
    offer,
    roomId: matchCheck24BeachRoom(offer),
  }))
  .filter(
    (entry) => entry.roomId !== null,
  );

const bestByRoom = new Map<
  string,
  (typeof beachRoomCandidates)[number]["offer"]
>();

for (const entry of beachRoomCandidates) {
  if (!entry.roomId) continue;

  const previous = bestByRoom.get(entry.roomId);

  if (
    !previous ||
    entry.offer.totalPrice < previous.totalPrice
  ) {
    bestByRoom.set(entry.roomId, entry.offer);
  }
}

console.log("\n[CHECK24 NEW] Beach room candidates:");

console.table(
  [...bestByRoom.entries()].map(
    ([roomId, offer]) => ({
      roomId,
      sourceRoom: offer.roomName,
      category: offer.roomCategoryName,
      supplier: offer.supplierName,
      price: offer.totalPrice,
    }),
  ),
);


  const allInclusiveOffers = allOffers.filter(
    (offer) =>
      offer.mealType ===
      "MEAL_TYPE_ALL_INCLUSIVE",
  );

  console.log(
    "\n[CHECK24 NEW] Completed search:",
    {
      totalParsed: allOffers.length,
      allInclusive: allInclusiveOffers.length,
    },
  );

  console.table(
    allInclusiveOffers
      .slice()
      .sort(
        (a, b) => a.totalPrice - b.totalPrice,
      )
      .slice(0, 30)
      .map((offer) => ({
        room: offer.roomName,
        category: offer.roomCategoryName,
        supplier: offer.supplierName,
        price: offer.totalPrice,
        currency: offer.currency,
      })),
  );
}


    newOffersResponseCount++;

    const recommendationCount =
      offers?.recommendation?.offers?.length ?? 0;

    const freeCancellationCount =
      offers?.freeCancelableRecommendation
        ?.offers?.length ?? 0;

    console.log(
      `[CHECK24 NEW] Response #${newOffersResponseCount}`,
      {
        status: offers?.status,
        searchId: offers?.searchId,
        roomCategoriesFitting:
          offers?.roomCategoriesFitting?.length ?? 0,
        recommendationCount,
        freeCancellationCount,
      },
    );
  } catch (error) {
    console.error(
      "[CHECK24 NEW] Response inspection failed:",
      error,
    );
  }
}


  const isOldOffersApi =
    parsedUrl.hostname === "hotel.check24.de" &&
    (
      path.endsWith("/clustered_offers.json") ||
      path.endsWith("/best_offer.json")
    );

  if (
    (!isNewOffersApi && !isOldOffersApi) ||
    response.status() !== 200 ||
    inspectedEndpoints.has(path)
  ) {
    return;
  }

  inspectedEndpoints.add(path);

  try {
    const json: unknown = await response.json();


if (
  isOldOffersApi &&
  path.endsWith("/clustered_offers.json")
) {
  const root = json as Record<string, any>;


const parsedOffers = parseCheck24OldAllOffers(
  json,
  5,
);

const bestRooms = getCheck24BeachBestOffers(
  parsedOffers,
  5,
);

console.log("\n[CHECK24] Beach room matching:");

console.table(
  Object.entries(bestRooms).map(
    ([roomId, offer]) => ({
      roomId,
      sourceRoom: offer.roomName,
      supplier: offer.supplierName,
      price: offer.totalPrice,
      currency: offer.currency,
    }),
  ),
);

const recommendationOffers = parsedOffers.filter(
  (offer) => offer.source === "recommendation",
);

const alternativeOffers = parsedOffers.filter(
  (offer) => offer.source === "rate",
);

console.log("\n[CHECK24] Parser results:", {
  totalParsed: parsedOffers.length,
  recommendations: recommendationOffers.length,
  alternatives: alternativeOffers.length,
});

console.table(
  parsedOffers
    .slice()
    .sort((a, b) => a.totalPrice - b.totalPrice)
    .slice(0, 20)
    .map((offer) => ({
      room: offer.roomName,
      supplier: offer.supplierName,
      occupancy: offer.roomOccupancy,
      board: offer.mealType,
      price: offer.totalPrice,
      currency: offer.currency,
      source: offer.source,
    })),
);


  console.log("\n[CHECK24 OLD] Search status:", {
    state: root.status?.state,
    offersCount: root.status?.offersCount,
    offersFilteredCount:
      root.status?.offersFilteredCount,
    searchRoomConfiguration:
      root.status?.searchRoomConfiguration,
    isExpired: root.status?.isExpired,
  });

  const roomRates = Array.isArray(root.roomRates)
    ? root.roomRates
    : [];

  console.log(
    "\n[CHECK24 OLD] Room category summary:",
  );

  console.table(
    roomRates.map((room: any) => ({
      roomId: room.roomId,
      category: room.roomCategoryTitle,
      providerRoomName:
        room.roomInformation?.providerRoomName,
      rateCount: room.rates?.length ?? 0,
      totalResults: room.totalResults,
    })),
  );

  // Sadece ilk iki kategoriyi inceleyelim.
  for (const room of roomRates.slice(0, 2)) {
    const recommended = room.recommendation;

    console.log(
      "\n[CHECK24 OLD] Recommended rate:",
      JSON.stringify(
        recommended
          ? {
              roomCategory:
                room.roomCategoryTitle,
              providerRoomName:
                room.roomInformation
                  ?.providerRoomName,
              offerUuid:
                recommended.offerUuid,
              roomOccupancy:
                recommended.roomOccupancy,
              mealType:
                recommended.mealType,
              price:
                recommended.price,
              priceStructure: {
                numberOfNights:
                  recommended.priceStructure
                    ?.numberOfNights,
                effectiveTotal:
                  recommended.priceStructure
                    ?.effectiveTotal,
                inclusiveTaxesAndFees:
                  recommended.priceStructure
                    ?.inclusiveTaxesAndFees,
              },
              supplier:
                recommended.supplier,
              providerId:
                recommended.providerId,
            }
          : null,
        null,
        2,
      ),
    );

    console.log(
      "\n[CHECK24 OLD] First rate:",
      JSON.stringify(
        room.rates?.[0]
          ? {
              roomRateId:
                room.rates[0].roomRateId,
              searchRoomConfigurationMatch:
                room.rates[0]
                  .searchRoomConfigurationMatch,
              rateKeys:
                Object.keys(
                  room.rates[0].rate ?? {},
                ),
              rate:
                room.rates[0].rate
                  ? {
                      roomOccupancy:
                        room.rates[0].rate
                          .roomOccupancy,
                      mealType:
                        room.rates[0].rate
                          .mealType,
                      price:
                        room.rates[0].rate.price,
                      supplier:
                        room.rates[0].rate
                          .supplier,
                    }
                  : null,
            }
          : null,
        null,
        2,
      ),
    );
  }
}



if (isNewOffersApi) {
  const root = json as Record<string, any>;
  const offersData = root?.offers;

   const categories = Array.isArray(
    offersData?.roomCategoriesFitting,
  )
    ? offersData.roomCategoriesFitting
    : [];

  console.log("\n[CHECK24 NEW] Room offer groups:");

  console.table(
    categories.map((category: any) => ({
      room: category.roomCategoryName,
      groups:
        category.characteristicsGroupsFitting?.length ?? 0,
      firstGroupKeys: Object.keys(
        category.characteristicsGroupsFitting?.[0] ?? {},
      ).join(", "),
    })),
  );

  const seaRoom = categories.find((category: any) =>
    /meerblick/i.test(category.roomCategoryName ?? ""),
  );

  if (seaRoom) {
    console.log(
      "\n[CHECK24 NEW] Sea room group sample:",
      JSON.stringify(
        seaRoom.characteristicsGroupsFitting?.[0] ?? null,
        null,
        2,
      ).slice(0, 8000),
    );
  }

  const parsedOffers =
  parseCheck24NewRecommendations(json);

console.log("\n[CHECK24 NEW] Parser results:", {
  totalParsed: parsedOffers.length,
});

console.table(
  parsedOffers.map((offer) => ({
    room: offer.roomName,
    supplier: offer.supplierName,
    occupancy: offer.roomOccupancy,
    meal: offer.mealType,
    price: offer.totalPrice,
    currency: offer.currency,
  })),
);

  const recommended =
    offersData?.recommendation?.offers?.[0];

  const freeCancelable =
    offersData?.freeCancelableRecommendation
      ?.offers?.[0];

  function summarizeOffer(offer: any) {
    if (!offer) return null;

    return {
      offerId: offer.offerId,
      supplier: offer.supplier,
      supplierKey: offer.supplierKey,
      roomName: offer.roomName,
      roomCategoryName: offer.roomCategoryName,
      roomCategoryId: offer.roomCategoryId,
      mealType: offer.mealType,
      roomConfig: offer.roomConfig,
      quantity: offer.quantity,
      totalPrice:
        offer.priceComposition?.totalPrice,
      cancellationPolicies:
        offer.cancellationPolicies,
    };
  }

  if (recommended || freeCancelable) {
    console.log(
      "\n[CHECK24] Recommended offer:",
      JSON.stringify(
        summarizeOffer(recommended),
        null,
        2,
      ),
    );

    console.log(
      "\n[CHECK24] Free cancellation offer:",
      JSON.stringify(
        summarizeOffer(freeCancelable),
        null,
        2,
      ),
    );

    console.log(
      "\n[CHECK24] Room categories:",
      JSON.stringify(
        offersData?.roomCategoriesFitting?.map(
          (room: any) => ({
            id: room.roomCategoryId,
            name: room.roomCategoryName,
            minSize: room.squareMetersMin,
            maxSize: room.squareMetersMax,
          }),
        ),
        null,
        2,
      ),
    );
  }
}


    console.log("\n[CHECK24] Offers API:");
    console.log("Host:", parsedUrl.hostname);
    console.log("Path:", path);

    console.log(
      "Search parameters:",
      Object.fromEntries(
        [...parsedUrl.searchParams.entries()].filter(
          ([key]) =>
            /date|occupancy|accommodation|sort/i.test(key),
        ),
      ),
    );

    function inspectStructure(
      value: unknown,
      depth = 0,
    ): unknown {
      if (depth >= 5) {
        return Array.isArray(value)
          ? `Array(${value.length})`
          : typeof value;
      }

      if (Array.isArray(value)) {
        return {
          type: "array",
          length: value.length,
          firstItem:
            value.length > 0
              ? inspectStructure(value[0], depth + 1)
              : null,
        };
      }

      if (
        value !== null &&
        typeof value === "object"
      ) {
        const record = value as Record<string, unknown>;

        return Object.fromEntries(
          Object.entries(record)
            .slice(0, 25)
            .map(([key, child]) => [
              key,
              inspectStructure(child, depth + 1),
            ]),
        );
      }

      return typeof value;
    }

    console.log(
      "[CHECK24] JSON structure:",
      JSON.stringify(
        inspectStructure(json),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      "[CHECK24] Offers inspection failed:",
      error instanceof Error ? error.message : error,
    );
  }
});



  try {
    const response = await page.goto(HOTEL_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    console.log("HTTP:", response?.status());
    console.log("Final URL:", page.url());
    console.log("Title:", await page.title());

    // Sayfanın ek ağ isteklerine fırsat tanı.
   await page.waitForTimeout(12000);

if (page.url().startsWith("https://hotels.check24.de/")) {
  console.log(
    "\n[CHECK24] Şimdi tarayıcıda diğer oda tiplerini aç.",
  );

  watchRoomInteractions = true;

  await page.waitForTimeout(30000);

  watchRoomInteractions = false;
}

    
console.log("\nCHECK24 API candidates:");

console.table(
  requests.map((request) => {
    const url = new URL(request.url);

    return {
      method: request.method,
      status: request.status,
      host: url.hostname,
      path: url.pathname,
      query: url.search.slice(0, 100),
      contentType: request.contentType,
    };
  }),
);


    console.log("\nPage text preview:");
    const bodyText = await page.locator("body").innerText();

    console.log(bodyText.slice(0, 5000));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
