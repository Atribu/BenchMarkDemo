
import { chromium } from "patchright";

const HOTELS = [
  {
    name: "Miramare Queen Hotel",
    url: "https://www.schauinsland-reisen.de/hotel/4894-miramare-queen-hotel",
  },
];

async function main() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
  });

  try {
    for (const hotel of HOTELS) {
      const page = await browser.newPage();

      const url = new URL(hotel.url);

      url.searchParams.set("nodes", "1030");
      url.searchParams.set("bookingType", "HOTEL_ONLY");
      url.searchParams.set("travellers", "25-1_25-2");
      url.searchParams.set("minD", "5");
url.searchParams.set("maxD", "5");
      url.searchParams.set("pdp.activeTab", "offers");

      const apiRequests = new Set<string>();

page.on("response", async (response) => {
  const type = response.request().resourceType();

  if (type !== "fetch" && type !== "xhr") return;

  const responseUrl = new URL(response.url());

  if (!responseUrl.hostname.endsWith("schauinsland-reisen.de")) {
    return;
  }

  if (response.status() === 200) {
    apiRequests.add(responseUrl.pathname);
  }

  if (responseUrl.pathname !== "/api/graphql") {
    return;
  }

  const request = response.request();

  try {
    const payload = request.postDataJSON();

    const operations = Array.isArray(payload)
      ? payload
      : [payload];


    const json = await response.json();

    const results = Array.isArray(json) ? json : [json];

if (!operations.some((operation) => operation?.operationName === "getOfferList")) {
  return;
}

for (let i = 0; i < operations.length; i++) {
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];

    if (operation?.operationName !== "getOfferList") {
      continue;
    }

    const result = results[i] ?? results[0];

    const hotelResults = result?.data?.productOffers?.hotels ?? [];

    const allOffers = hotelResults.flatMap(
      (hotelResult: any) => hotelResult.offers ?? [],
    );

    const schauinslandOffers = allOffers.filter(
      (offer: any) => offer.tourOperator?.code === "SLR",
    );

    console.log("\n[SCHAUINSLAND] Offer list:", {
      hotel: hotel.name,
      totalOffers: allOffers.length,
      schauinslandOffers: schauinslandOffers.length,
    });

    // İstek değişkenlerinin yapısı:
    // Oturum ve kimlik bilgilerini yazdırmıyoruz.

const packageRequest = operation.variables?.packageOfferRequest;


const productSearch = packageRequest?.productSearch;

console.log("[SCHAUINSLAND] Exact search criteria:", {
  hotel: hotel.name,
  bookingType: productSearch?.bookingType,
  hotelCodes: productSearch?.hotelFilter?.references?.hotelCodes,
  travellers: productSearch?.travellersFilter,
  departureDate:
    productSearch?.travelPeriod?.departureDateTime
      ?.dateRangeFilter,
  returnDate:
    productSearch?.travelPeriod?.returnDateTime
      ?.dateRangeFilter,
  minDuration: productSearch?.travelPeriod?.minDuration,
  maxDuration: productSearch?.travelPeriod?.maxDuration,
  tourOperatorCodes:
    productSearch?.brandFilter?.tourOperatorCodes,
});




console.log("[SCHAUINSLAND] Package request keys:",
  Object.keys(packageRequest ?? {}),
);


    console.log("[SCHAUINSLAND] Offer samples:");

    console.table(
      schauinslandOffers.map((offer: any) => ({
        hotelId: offer.hotelContentId?.giataId,
        operator: offer.tourOperator?.code,
        checkIn: offer.offerStart?.date,
        checkOut: offer.offerEnd?.date,
        nights: offer.lengthOfStay,
        room: offer.rooms?.room?.[0]?.providerDescription,
        roomCode: offer.rooms?.room?.[0]?.opCode,
roomTypeCode: offer.rooms?.room?.[0]?.codes?.[0]?.code,
        board: offer.rooms?.room?.[0]?.board?.label,
        total: offer.price?.amount,
        perPerson: offer.price?.perPersonAmount,
        currency: offer.price?.currency,
        soldOut: offer.soldOut,
      })),
    );
  }
}


    console.log("[SCHAUINSLAND] GraphQL response structure:", {
      hotel: hotel.name,
      results: results.map((result) => ({
        dataKeys: Object.keys(result?.data ?? {}),
        hasErrors: Array.isArray(result?.errors) &&
          result.errors.length > 0,
      })),
    });
  } catch (error) {
    console.log("[SCHAUINSLAND] GraphQL inspection failed:", {
      hotel: hotel.name,
      reason:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
});


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

    const updatedOperations = operations.map((operation) => {
      if (operation?.operationName !== "getOfferList") {
        return operation;
      }

      const packageRequest =
        operation.variables?.packageOfferRequest;

      const productSearch = packageRequest?.productSearch;

      if (!productSearch || productSearch.bookingType !== "HOTEL_ONLY") {
        return operation;
      }

      modified = true;

      return {
        ...operation,
        variables: {
          ...operation.variables,
          packageOfferRequest: {
            ...packageRequest,
            productSearch: {
              ...productSearch,
              travelPeriod: {
                ...productSearch.travelPeriod,
                departureDateTime: {
                  ...productSearch.travelPeriod?.departureDateTime,
                  dateRangeFilter: {
                    minDate: "2026-10-29",
                  },
                },
                returnDateTime: {
                  ...productSearch.travelPeriod?.returnDateTime,
                  dateRangeFilter: {
                    maxDate: "2026-11-03",
                  },
                },
                minDuration: 5,
                maxDuration: 5,
              },
            },
          },
        },
      };
    });

    if (modified) {
      updatedPostData = JSON.stringify(
        Array.isArray(payload)
          ? updatedOperations
          : updatedOperations[0],
      );

      console.log(
        "[SCHAUINSLAND] Applying exact date filter",
      );
    }
  } catch (error) {
    console.log(
      "[SCHAUINSLAND] Request modification skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (updatedPostData !== undefined) {
    await route.continue({ postData: updatedPostData });
  } else {
    await route.continue();
  }
});


      console.log(`\n[SCHAUINSLAND] Checking: ${hotel.name}`);

      try {
      const response = await page.goto(url.toString(), {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});

// Cookiebot görünürse isteğe bağlı çerezleri reddet.
const rejectCookies = page.getByRole("button", {
  name: "Alle Ablehnen",
  exact: true,
});

if (await rejectCookies.isVisible().catch(() => false)) {
  await rejectCookies.click();

  console.log("[SCHAUINSLAND] Optional cookies rejected");
}

// Otelin gerçekten yüklendiğini doğrula.
await page
  .getByText(hotel.name, { exact: true })
  .first()
  .waitFor({
    state: "visible",
    timeout: 30_000,
  });

        // Teşhis amaçlı kısa gözlem süresi.
        console.log(
  "[SCHAUINSLAND] Tarihleri tarayıcıdan seçip tekliflerin yenilenmesini bekle.",
);

await page.waitForTimeout(8000);

        const body = await page.locator("body").innerText();

        console.log("[SCHAUINSLAND] Result:", {
          hotel: hotel.name,
          status: response?.status(),
          finalUrl: page.url(),
          title: await page.title(),
          hotelVisible: true,
          offerSectionVisible: /Angebote/i.test(body),
          apiPaths: [...apiRequests],
        });
      } catch (error) {
        console.error("[SCHAUINSLAND] Failed:", {
          hotel: hotel.name,
          url: page.url(),
          reason:
            error instanceof Error
              ? error.message.split("\n")[0]
              : String(error),
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
