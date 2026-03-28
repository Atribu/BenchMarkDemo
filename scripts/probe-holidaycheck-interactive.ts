import { createBrowserPage } from "../src/lib/ota/live-helpers";

const HOTELONLY_URL =
  "https://www.holidaycheck.de/ho/angebote-hotel-miramare-beach/976607ee-0f98-365d-bdbf-f96af4b03a6d/hotelonly?_offer=departureDate:2026-05-10,duration:exactly,returnDate:2026-05-15,rooms:a-a";

async function main() {
  const { browser, page } = await createBrowserPage({
    market: "de",
    browserChannel: "chrome",
    useStealth: true
  });

  const apiResponses: Array<{ url: string; status: number }> = [];
  let allOffersSample: unknown = null;

  page.on("response", (response) => {
    const url = response.url();

    if (url.includes("holidaycheck.de/api/")) {
      apiResponses.push({
        url,
        status: response.status()
      });
    }

    if (url.includes("holidaycheck.de/api/all-offers-service") && response.status() === 200) {
      response
        .json()
        .then((json) => {
          allOffersSample = json;
        })
        .catch(() => undefined);
    }
  });

  try {
    await page.goto(HOTELONLY_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.waitForTimeout(7000);

    const payload = await page.evaluate(() => {
      const state = (window as { __FLUXIBLE_STATE__?: unknown }).__FLUXIBLE_STATE__;
      const stores =
        state &&
        typeof state === "object" &&
        "dispatcher" in state &&
        (state as { dispatcher?: { stores?: Record<string, unknown> } }).dispatcher?.stores
          ? (state as { dispatcher: { stores: Record<string, unknown> } }).dispatcher.stores
          : {};
      const search = stores.SearchParamsStore as
        | {
            defaultSearchSettings?: {
              travelkind?: string;
              hotelonly?: {
                departureDate?: string | Date;
                returnDate?: string | Date;
                duration?: string;
              };
            };
            userSearchSettings?: unknown;
          }
        | undefined;
      const offers = stores.HotelOfferStore as
        | {
            isLoading?: boolean;
            hasError?: boolean;
            offers?: Array<{
              travelkind?: string;
              type?: string;
              totalPrice?: { amount?: number; currency?: string };
              departureDate?: unknown;
              returnDate?: unknown;
              stayStartDate?: unknown;
              stayEndDate?: unknown;
              room?: { description?: string; name?: string };
              rooms?: Array<{ description?: string; name?: string }>;
            }>;
          }
        | undefined;
      const offerLikeStores = Object.entries(stores)
        .filter(([, value]) => {
          if (!value || typeof value !== "object") {
            return false;
          }

          const record = value as Record<string, unknown>;

          return (
            Array.isArray(record.offers) ||
            Array.isArray(record.offerGroups) ||
            Array.isArray(record.offerCards) ||
            Array.isArray(record.items)
          );
        })
        .map(([key, value]) => {
          const record = value as Record<string, unknown>;

          return {
            key,
            offersLength: Array.isArray(record.offers) ? record.offers.length : null,
            offerGroupsLength: Array.isArray(record.offerGroups)
              ? record.offerGroups.length
              : null,
            offerCardsLength: Array.isArray(record.offerCards)
              ? record.offerCards.length
              : null,
            itemsLength: Array.isArray(record.items) ? record.items.length : null
          };
        });
      const offerPriceTexts = Array.from(
        document.querySelectorAll("[data-testid='offer-total-price'], [data-testid='offer-price']")
      )
        .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0)
        .slice(0, 10);
      const offerCardSnippets = Array.from(
        document.querySelectorAll("[data-testid*='offer'], article, .offer-box, .offer-card")
      )
        .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => /€|eur|zimmer|meerblick|landseite/i.test(text))
        .slice(0, 5);
      const offerCardHtml = Array.from(
        document.querySelectorAll("[data-testid*='offer'], article, .offer-box, .offer-card")
      )
        .map((element) => element.outerHTML)
        .filter((html) => /€|Zimmerdetails|Zur Buchung|Preisdetails/i.test(html))
        .slice(0, 2);

      return {
        title: document.title,
        url: window.location.href,
        bodySnippet: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 800),
        storeKeys: Object.keys(stores),
        search: {
          defaultTravelkind: search?.defaultSearchSettings?.travelkind ?? null,
          hotelonlyDefaults: search?.defaultSearchSettings?.hotelonly ?? null,
          userSearchSettings: search?.userSearchSettings ?? null
        },
        offerLikeStores,
        dom: {
          offerPriceTexts,
          offerCardSnippets,
          offerCardHtml
        },
        offers: {
          isLoading: offers?.isLoading ?? null,
          hasError: offers?.hasError ?? null,
          count: offers?.offers?.length ?? 0,
          sample:
            offers?.offers?.slice(0, 5).map((offer) => ({
              travelkind: offer.travelkind ?? offer.type ?? null,
              totalPrice: offer.totalPrice?.amount ?? null,
              departureDate: offer.departureDate ?? null,
              returnDate: offer.returnDate ?? null,
              stayStartDate: offer.stayStartDate ?? null,
              stayEndDate: offer.stayEndDate ?? null,
              room:
                offer.room?.description ??
                offer.room?.name ??
                offer.rooms?.[0]?.description ??
                offer.rooms?.[0]?.name ??
                null
            })) ?? []
        }
      };
    });

    console.log(
      JSON.stringify(
        {
          payload,
          allOffersSample,
          apiResponses: apiResponses
            .filter(
              (response, index, list) =>
                list.findIndex(
                  (item) => item.url === response.url && item.status === response.status
                ) === index
            )
            .slice(0, 30)
        },
        null,
        2
      )
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
