import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOnTheBeachQuotes,
  parseOnTheBeachOffers,
  collectOnTheBeachLiveQuotes,
  type OnTheBeachSnapshot,
} from "../src/lib/ota/live-onthebeach";
import {
  buildExpediaUrl,
  parseExpediaQuotes,
  type ExpediaSnapshot,
} from "../src/lib/ota/live-expedia";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import type { createBrowserPage } from "../src/lib/ota/live-helpers";
import { buildBenchmarkResult } from "../src/lib/benchmark/engine";

const uk = REPORT_SCOPES.find((scope) => scope.id === "beach-uk")!;
const eu = REPORT_SCOPES.find((scope) => scope.id === "beach-eu")!;
const otb = OTA_PROVIDERS.find((provider) => provider.key === "onthebeach")!;
const expedia = OTA_PROVIDERS.find((provider) => provider.key === "expedia")!;
const window = {
  id: "window",
  label: "16-21 Oct",
  checkIn: "2026-10-16",
  checkOut: "2026-10-21",
  nights: 5,
};
const otbSnapshot: OnTheBeachSnapshot = {
  sourceUrl: "https://www.onthebeach.co.uk/hotel_searches/show/3168777245",
  hotelName: "Miramare Beach",
  checkInLabel: "Check-in Date 16 Oct 2026",
  returnLabel: "Return 21 Oct 2026",
  nights: 5,
  adults: 2,
  children: 0,
  infants: 0,
  rooms: 1,
  totalSelected: true,
  offers: [
    {
      roomName: "Double Or Twin Superior Land View Balcony",
      board: "All Inclusive",
      priceText: "£1,429\n.01\nper party",
    },
    {
      roomName: "Double Or Twin Superior Side Sea View Balcony",
      board: "All Inclusive",
      priceText: "£1,486\n.53\nper party",
    },
    {
      roomName: "Double Or Twin Superior Sea View With Balcony",
      board: "All Inclusive",
      priceText: "£1,524\n.87\nper party",
    },
  ],
};
const exUrl =
  "https://www.expedia.com/Side-Hotels-Miramare-Beach-Hotel.h12354286.Hotel-Information";
const exSnapshot: ExpediaSnapshot = {
  url: buildExpediaUrl(exUrl, eu, window.checkIn, window.checkOut),
  hotelName: "Miramare Beach Hotel",
  travellers: "Travellers, 2 travellers, 1 room",
  startLabel: "Start date, 16 Oct",
  endLabel: "End date, 21 Oct",
  currencyLabel: "EUR Germany",
  cards: [
    { name: "Superior Room Land view", text: "We are sold out", priceText: "" },
    {
      name: "Superior Room Sea View",
      text: "All-inclusive\nNon-refundable",
      priceText:
        "The previous price was €2,592\nThe current price is €1,883\nfor 5 nights, 1 room\n€377 per night\nincludes taxes & fees",
    },
  ],
};

test("On the Beach reads the party total including split pennies, preferring full sea view", () => {
  const quotes = parseOnTheBeachQuotes(otb, uk, window, otbSnapshot);
  assert.deepEqual(
    quotes.map((quote) => quote.price),
    [1429.01, 1524.87],
  );
  assert.ok(
    quotes.every(
      (quote) =>
        quote.captureMethod === "automated" &&
        quote.status === "available" &&
        quote.observedAt,
    ),
  );
  assert.match(quotes[1].offerDescription!, /Sea View With Balcony/);
});

test("On the Beach refuses wrong dates, hotel, currency, occupancy and non-total searches", () => {
  for (const patch of [
    { checkInLabel: "Check-in Date 6 Oct 2026" },
    { returnLabel: "Return 22 Oct 2026" },
    { hotelName: "Miramare Queen" },
    { nights: 6 },
    { adults: 1 },
    { children: 1 },
    { infants: 1 },
    { rooms: 2 },
    { totalSelected: false },
    { sourceUrl: "https://www.onthebeach.co.uk/holidays" },
    { sourceUrl: otbSnapshot.sourceUrl.replace("https:", "http:") },
    { sourceUrl: `${otbSnapshot.sourceUrl}/holiday-package` },
    {
      sourceUrl: otbSnapshot.sourceUrl.replace(".co.uk", ".co.uk.example.com"),
    },
  ])
    assert.throws(() =>
      parseOnTheBeachQuotes(otb, uk, window, { ...otbSnapshot, ...patch }),
    );
  assert.throws(() => parseOnTheBeachQuotes(otb, eu, window, otbSnapshot));
  assert.throws(() =>
    parseOnTheBeachQuotes(
      otb,
      uk,
      { ...window, checkIn: "2026-10-06" },
      otbSnapshot,
    ),
  );
});

test("On the Beach retains partial sea, economy, balcony-free and unknown rooms only as alternatives", () => {
  for (const roomName of [
    "Double Or Twin Superior Side Sea View Balcony",
    "Superior Economy Land View Balcony",
    "Superior Sea View No Balcony",
    "Superior Sea View",
    "Standard Room",
    "Superior Family Room Sea View Balcony",
  ]) {
    const snapshot = {
      ...otbSnapshot,
      offers: [{ ...otbSnapshot.offers[0], roomName }],
    };
    const offers = parseOnTheBeachOffers(otb, uk, window, snapshot);
    const quotes = parseOnTheBeachQuotes(otb, uk, window, snapshot);
    assert.equal(offers.length, 1, roomName);
    assert.equal(offers[0].price, 1429.01);
    assert.equal(offers[0].matchedRoomId, undefined, roomName);
    assert.ok(
      quotes.every((quote) => quote.price === null),
      roomName,
    );
  }
});

test("On the Beach rejects zero, deposits, mixed units and malformed totals before retaining offers", () => {
  for (const priceText of [
    "£0 per party",
    "£-100 per party",
    "Deposit £100 per party",
    "£100 per person / £200 per party",
    "£100 per night / £500 per party",
    "Was £2,000 Now £1,500 per party",
    "€100 per party",
    "£1,00 per party",
    "£1.234,56 per party",
    "£100 per party with flights",
  ]) {
    assert.equal(
      parseOnTheBeachOffers(otb, uk, window, {
        ...otbSnapshot,
        offers: [{ ...otbSnapshot.offers[0], priceText }],
      }).length,
      0,
      priceText,
    );
  }
});

test("On the Beach deduplicates identical offers without merging board differences", () => {
  const offers = parseOnTheBeachOffers(otb, uk, window, {
    ...otbSnapshot,
    offers: [
      otbSnapshot.offers[0],
      otbSnapshot.offers[0],
      { ...otbSnapshot.offers[0], board: "All Inclusive Plus" },
    ],
  });
  assert.equal(offers.length, 2);
  assert.equal(offers[0].terms.board, "All Inclusive");
  assert.equal(offers[1].terms.board, "All Inclusive Plus");
  assert.equal(new Set(offers.map((offer) => offer.id)).size, 2);
});

test("On the Beach Queen matches only explicit standard views and reports unknown balcony", () => {
  const queen = REPORT_SCOPES.find((scope) => scope.id === "queen-uk")!;
  const snapshot = {
    ...otbSnapshot,
    hotelName: queen.hotelName,
    offers: [
      { ...otbSnapshot.offers[0], roomName: "Double Room Garden View" },
      { ...otbSnapshot.offers[2], roomName: "Standard Room Sea View" },
    ],
  };
  const quotes = parseOnTheBeachQuotes(otb, queen, window, snapshot);
  assert.deepEqual(
    quotes.map((quote) => quote.price),
    [1429.01, 1524.87],
  );
  assert.ok(quotes.every((quote) => quote.roomFeatures?.balcony === "unknown"));
  assert.equal(quotes[0].roomFeatures?.view, "garden");
  assert.equal(quotes[1].roomFeatures?.view, "sea");
});

test("On the Beach Queen 23-28 Oct browser sample never maps side sea or family to standard sea", () => {
  // Browser observation on 2 Oct 2026; this fixture is not an automated live result.
  const queen = REPORT_SCOPES.find((scope) => scope.id === "queen-uk")!;
  const dates = { ...window, checkIn: "2026-10-23", checkOut: "2026-10-28" };
  const snapshot: OnTheBeachSnapshot = {
    ...otbSnapshot,
    sourceUrl:
      "https://www.onthebeach.co.uk/hotel_searches/show/3168777916?filters%5Bhotel_name%5D=Miramare%20Queen&ordering=popularity&pagination%5Bpage%5D=1",
    hotelName: "Miramare Queen",
    checkInLabel: "Check-in Date 23 Oct 2026",
    returnLabel: "Return 28 Oct 2026",
    offers: [
      {
        roomName: "Double Or Twin Land View Balcony",
        board: "All Inclusive",
        priceText: "£1,019\n.88\nper party",
      },
      {
        roomName: "Double Or Twin Side Sea View Balcony",
        board: "All Inclusive",
        priceText: "£1,085\n.82\nper party",
      },
      {
        roomName: "Family Accomodation Large Land View Balcony",
        board: "All Inclusive",
        priceText: "£1,085\n.82\nper party",
      },
    ],
  };
  const offers = parseOnTheBeachOffers(otb, queen, dates, snapshot);
  const quotes = parseOnTheBeachQuotes(otb, queen, dates, snapshot);
  assert.equal(offers.length, 3);
  assert.deepEqual(
    quotes.map((quote) => quote.price),
    [1019.88, null],
  );
  assert.equal(offers[1].roomFeatures.view, "partial-sea");
  assert.equal(offers[2].roomFeatures.category, "variant");
});

test("On the Beach alternatives enter the report without increasing matched-room coverage", () => {
  const scope = { ...uk, windows: [window] };
  const offers = parseOnTheBeachOffers(otb, scope, window, otbSnapshot);
  const quotes = parseOnTheBeachQuotes(otb, scope, window, otbSnapshot);
  const result = buildBenchmarkResult({
    scopes: [scope],
    providers: [otb],
    quotes,
    offers,
    mode: "live",
    warnings: [],
  });
  assert.equal(result.summary.availableRateCount, 2);
  assert.equal(result.summary.alternativeOfferCount, 1);
  assert.equal(quotes[1].roomFeatures?.view, "sea");
  assert.equal(quotes[1].terms?.board, "All Inclusive");
});

test("On the Beach collector keeps earlier offers when a later search fails and closes both browsers", async () => {
  let closes = 0;
  const factory: typeof createBrowserPage = async () =>
    ({
      page: {
        setDefaultTimeout() {},
        url: () => otbSnapshot.sourceUrl,
        locator: () => ({
          isVisible: async () => false,
          innerText: async () => "",
          all: async () => [],
        }),
      },
      close: async () => {
        closes++;
      },
    }) as unknown as Awaited<ReturnType<typeof createBrowserPage>>;
  const result = await collectOnTheBeachLiveQuotes(
    otb,
    { ...uk, windows: [window, { ...window, id: "second" }] },
    {
      createPage: factory,
      search: async (_page, _scope, requestedWindow) => {
        if (requestedWindow.id === "second")
          throw new Error("Second window failed");
        return otbSnapshot;
      },
    },
  );
  assert.equal(result.offers?.length, 3);
  assert.deepEqual(
    result.quotes.map((quote) => quote.price),
    [1429.01, 1524.87, null, null],
  );
  assert.match(result.warnings[0], /Second window failed/);
  assert.equal(closes, 2);
});

test("On the Beach rejects per-person, package currency and incompatible room prices", () => {
  for (const offers of [
    otbSnapshot.offers.map((offer) => ({
      ...offer,
      priceText: "£100 per person",
    })),
    otbSnapshot.offers.map((offer) => ({
      ...offer,
      priceText: "€100 per party",
    })),
    [
      {
        roomName: "Suite Superior Sea View",
        board: "All Inclusive",
        priceText: "£100 per party",
      },
    ],
  ])
    assert.ok(
      parseOnTheBeachQuotes(otb, uk, window, { ...otbSnapshot, offers }).every(
        (quote) => quote.price === null,
      ),
    );
});

test("Expedia uses regional sites and dates without reusing US currency defaults", () => {
  const de = new URL(
    buildExpediaUrl(exUrl, eu, window.checkIn, window.checkOut),
  );
  const gb = new URL(
    buildExpediaUrl(exUrl, uk, window.checkIn, window.checkOut),
  );
  assert.equal(de.hostname, "www.expedia.de");
  assert.equal(gb.hostname, "www.expedia.co.uk");
  assert.equal(gb.searchParams.get("currency"), "GBP");
  assert.equal(de.searchParams.get("rm1"), "a2");
  assert.equal(de.searchParams.get("chkin"), window.checkIn);
});

test("Expedia reads current stay total, never previous or nightly price, and records sold-out rooms", () => {
  const quotes = parseExpediaQuotes(expedia, eu, window, exSnapshot);
  assert.equal(quotes[0].price, null);
  assert.equal(quotes[0].status, "sold_out");
  assert.equal(quotes[1].price, 1883);
  assert.equal(quotes[1].captureMethod, "automated");
});

test("Expedia refuses redirected dates, wrong hotel, party and currency", () => {
  for (const patch of [
    { travellers: "Travellers, 12 travellers, 1 room" },
    { currencyLabel: "USD United States" },
    { hotelName: "Another Hotel" },
    { startLabel: "Start date, 17 Oct" },
    { endLabel: "End date, 22 Oct" },
    { url: exSnapshot.url.replace("chkin=2026-10-16", "chkin=2026-10-17") },
    { url: exSnapshot.url.replace("h12354286", "h12354488") },
    { url: exSnapshot.url.replace("https:", "http:") },
  ])
    assert.throws(() =>
      parseExpediaQuotes(expedia, eu, window, { ...exSnapshot, ...patch }),
    );
  assert.throws(() =>
    parseExpediaQuotes(
      expedia,
      eu,
      { ...window, checkIn: "2026-10-06" },
      {
        ...exSnapshot,
        url: exSnapshot.url.replace("chkin=2026-10-16", "chkin=2026-10-06"),
      },
    ),
  );
});

test("Expedia excludes incomplete totals and does not turn missing prices into sold out", () => {
  for (const priceText of [
    "The current price is €1,883\n€377 per night",
    "The previous price was €2,592\nfor 5 nights, 1 room",
    "The current price is £1,883\nfor 5 nights, 1 room",
    "The current price is €1,883\nfor 6 nights, 1 room",
  ])
    assert.equal(
      parseExpediaQuotes(expedia, eu, window, {
        ...exSnapshot,
        cards: [{ ...exSnapshot.cards[1], priceText }],
      })[1].status,
      "manual-review",
    );
});
