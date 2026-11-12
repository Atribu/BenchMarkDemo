import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import {
  buildDertourSourceUrl,
  collectDertourLiveQuotes,
  DERTOUR_HOTEL_CONFIG,
  parseDertourOffers,
} from "../src/lib/ota/live-dertour";

const window = {
  id: "2026-11-18_2026-11-23",
  label: "18–23 Kasım 2026",
  checkIn: "2026-11-18",
  checkOut: "2026-11-23",
  nights: 5,
};

function offer(overrides: Record<string, unknown> = {}) {
  return {
    offerId: "offer-land",
    productCode: "AYT13007B",
    tourOperator: "DER",
    price: { currencyCode: "EUR", amount: 1456 },
    travellers: [
      { id: 1, type: "ADULT", age: 30 },
      { id: 2, type: "ADULT", age: 30 },
    ],
    hotelStayPeriod: {
      from: window.checkIn,
      to: window.checkOut,
      duration: window.nights,
    },
    room: {
      travelPeriod: {
        from: window.checkIn,
        to: window.checkOut,
        duration: window.nights,
      },
      name: "Doppelzimmer Superior Landblick",
      operatorCode: "DSL",
      price: { currencyCode: "EUR", amount: 1456 },
    },
    hotel: {
      id: "1116XL",
      giataId: 4893,
      name: "Miramare Beach Hotel",
      country2Lc: "TR",
    },
    board: {
      name: "Alles Inklusive plus",
      type: "ALL_INCL_PLUS",
      code: ["GT06-AIP"],
    },
    offerType: "HOTEL",
    ...overrides,
  };
}

function html(offers: unknown[], params: Record<string, unknown> = {}) {
  const nextData = {
    props: {
      pageProps: {
        __cache: {
          offers: {
            spec: { url: "/api/hotel/get-offers" },
            params: {
              body: {
                hotel: {
                  duration: "exact",
                  fromDate: window.checkIn,
                  toDate: window.checkOut,
                  id: { cid: "1116XL", giataId: 4893 },
                  tenant: "DERTOUR",
                  numberOfAdults: 2,
                  tourOperatorCodes: ["DER", "ITS"],
                  priceMode: "TOTAL_PRICE",
                  ...params,
                },
              },
            },
            result: {
              success: true,
              data: {
                rooms: offers.map((item) => ({
                  boards: [{ offer: item }],
                })),
              },
            },
          },
        },
      },
    },
  };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`;
}

test("DERTOUR builds an exact hotel-only URL for DER and ITS", () => {
  assert.deepEqual(DERTOUR_HOTEL_CONFIG["miramare-beach"].coreId, "1116XL");
  const url = new URL(
    buildDertourSourceUrl(
      DERTOUR_HOTEL_CONFIG["miramare-beach"],
      window.checkIn,
      window.checkOut,
    ),
  );
  assert.equal(url.origin, "https://www.dertour.de");
  assert.equal(url.pathname, "/hotel/miramare-beach-1116XL");
  assert.equal(url.searchParams.get("travelType"), "hotelOnly");
  assert.equal(url.searchParams.get("duration"), "exact");
  assert.equal(url.searchParams.get("adults"), "2");
  assert.equal(url.searchParams.get("priceMode"), "total");
  assert.deepEqual(url.searchParams.getAll("tourOperator"), ["DER", "ITS"]);
});

test("DERTOUR parser accepts only exact two-adult EUR hotel totals", () => {
  const valid = offer();
  const wrongOperator = offer({ offerId: "other", tourOperator: "VTOE" });
  const packageOffer = offer({ offerId: "package", offerType: "PACKAGE" });
  const parsed = parseDertourOffers(html([valid, wrongOperator, packageOffer]), {
    coreId: "1116XL",
    checkIn: window.checkIn,
    checkOut: window.checkOut,
    nights: window.nights,
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].price, 1456);
  assert.equal(parsed[0].roomName, "Doppelzimmer Superior Landblick");
  assert.equal(parsed[0].operator, "DER");

  assert.throws(
    () =>
      parseDertourOffers(html([valid], { fromDate: "2026-11-19" }), {
        coreId: "1116XL",
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
      }),
    /sorgu kapsamı/,
  );
});

test("DERTOUR collector maps verified Miramare room aliases", async () => {
  const sea = offer({
    offerId: "offer-sea",
    tourOperator: "ITS",
    price: { currencyCode: "EUR", amount: 1594 },
    room: {
      travelPeriod: {
        from: window.checkIn,
        to: window.checkOut,
        duration: window.nights,
      },
      name: "Doppelzimmer Superior Meerblick",
      operatorCode: "DSM",
      price: { currencyCode: "EUR", amount: 1594 },
    },
  });
  const scope = {
    ...REPORT_SCOPES.find((item) => item.id === "beach-eu")!,
    windows: [window],
  };
  const provider = OTA_PROVIDERS.find((item) => item.key === "dertour")!;
  const result = await collectDertourLiveQuotes(
    provider,
    scope,
    async () =>
      new Response(html([offer(), sea]), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );
  const land = result.quotes.find((quote) => quote.roomId === "superior-land");
  const seaQuote = result.quotes.find((quote) => quote.roomId === "superior-sea");
  assert.equal(land?.price, 1456);
  assert.equal(seaQuote?.price, 1594);
  assert.equal(result.offers?.find((item) => item.price === 1594)?.terms.operator, "ITS");
});
