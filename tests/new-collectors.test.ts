import test from "node:test";
import assert from "node:assert/strict";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import {
  buildLoveholidaysUrl,
  parseLoveholidaysQuotes,
  parseLoveholidaysOffers,
  collectLoveholidaysLiveQuotes,
  type LoveholidaysSnapshot,
} from "../src/lib/ota/live-loveholidays";
import {
  buildBookingUrl,
  parseBookingQuotes,
  type BookingSnapshot,
} from "../src/lib/ota/live-booking";
import {
  parseGoogleHotelPrices,
  type GoogleHotelsSnapshot,
} from "../src/lib/ota/live-google-hotels";
import { buildBenchmarkResult } from "../src/lib/benchmark/engine";
import type { createBrowserPage } from "../src/lib/ota/live-helpers";

const eu = REPORT_SCOPES.find((scope) => scope.id === "beach-eu")!;
const uk = REPORT_SCOPES.find((scope) => scope.id === "beach-uk")!;
const queen = REPORT_SCOPES.find((scope) => scope.id === "queen-eu")!;
const love = OTA_PROVIDERS.find((provider) => provider.key === "loveholidays")!;
const booking = OTA_PROVIDERS.find((provider) => provider.key === "booking")!;
const tui = OTA_PROVIDERS.find((provider) => provider.key === "tui")!;
const window = {
  id: "test-window",
  label: "16-21 Oct",
  checkIn: "2026-10-16",
  checkOut: "2026-10-21",
  nights: 5,
};

// Public room-only UI observed on 2 Oct 2026. These are parser fixtures,
// not a claim that the automated browser can currently access the site.
const loveDe: LoveholidaysSnapshot = {
  url: buildLoveholidaysUrl(eu, window),
  hotelName: "Miramare Beach",
  checkInLabel: "16.10.2026",
  nightsLabel: "5 Nächte",
  occupancyLabel: "1 Zimmer, 2 Erw.",
  offers: [
    {
      name: "Superior-Standardzimmer mit Blick ins Grüne",
      priceText: "340 € pro Nacht\n1.698 € insgesamt",
      description: "All inclusive\nHotel und Flug 1.878 € insgesamt",
    },
    {
      name: "Superior-Standardzimmer mit seitlichem Meerblick",
      priceText: "352 € pro Nacht\n1.758 € insgesamt",
      description: "All inclusive",
    },
    {
      name: "Superior-Standardzimmer mit Meerblick",
      priceText: "364 € pro Nacht\n1.818 € insgesamt",
      description: "All inclusive",
    },
  ],
};
const loveEn: LoveholidaysSnapshot = {
  url: buildLoveholidaysUrl(uk, window),
  hotelName: "Miramare Beach",
  checkInLabel: "Fri 16 Oct 2026",
  nightsLabel: "5 nights",
  occupancyLabel: "1 Room, 2 Adults",
  offers: [
    {
      name: "Superior Double Room with Balcony and Land View",
      priceText: "£320 per night\n£1,598 total",
      description: "All inclusive\nHotel and flights £1,900 total",
    },
  ],
};

test("Loveholidays collector returns unmatched offers instead of losing them in its DOM snapshot array", async () => {
  let closes = 0;
  let navigations = 0;
  const textLocator = (text: string) => ({
    innerText: async () => text,
    filter() {
      return this;
    },
    last() {
      return this;
    },
    getByRole() {
      return this;
    },
  });
  const card = {
    getByRole(role: string) {
      return textLocator(
        role === "heading"
          ? "Standard Zimmer"
          : "323 € pro Nacht / 1.613 € insgesamt",
      );
    },
    innerText: async () =>
      "All inclusive Nicht erstattungsfähig Hotel + Flug 2.000 €",
  };
  const page = {
    setDefaultTimeout() {},
    async goto() {
      if (++navigations > 1) throw new Error("Second window unavailable");
      return { status: () => 200 };
    },
    url: () => buildLoveholidaysUrl(queen, window),
    locator: () => ({ innerText: async () => "", all: async () => [] }),
    getByRole(_role: string, options: { name?: string | RegExp }) {
      const name = options.name;
      if (name === queen.hotelName) return textLocator(queen.hotelName);
      if (name === "Zimmer") return textLocator("1 Zimmer, 2 Erw.");
      if (!(name instanceof RegExp))
        throw new Error(`Unexpected locator: ${String(name)}`);
      if (name.test("Reject non-essential") || name.test("Show more"))
        return { isVisible: async () => false };
      if (name.test("Room option 1"))
        return {
          first: () => ({ waitFor: async () => {} }),
          all: async () => [card],
        };
      if (name.test("Check-in date")) return textLocator("16.10.2026");
      if (name.test("How long")) return textLocator("5 Nächte");
      throw new Error(`Unexpected locator: ${String(name)}`);
    },
  };
  const factory: typeof createBrowserPage = async () =>
    ({
      page,
      close: async () => {
        closes++;
      },
    }) as unknown as Awaited<ReturnType<typeof createBrowserPage>>;
  const result = await collectLoveholidaysLiveQuotes(
    love,
    {
      ...queen,
      windows: [
        window,
        {
          ...window,
          id: "next",
          checkIn: "2026-10-23",
          checkOut: "2026-10-28",
        },
      ],
    },
    factory,
  );
  assert.equal(result.offers?.length, 1);
  assert.equal(result.offers?.[0].price, 1613);
  assert.equal(result.offers?.[0].matchedRoomId, undefined);
  assert.equal(result.quotes.length, 4);
  assert.ok(result.quotes.every((quote) => quote.price === null));
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("Second window unavailable"),
    ),
  );
  assert.equal(closes, 1);
});

test("Loveholidays preserves room totals but requires balcony evidence for Beach mapping", () => {
  const de = parseLoveholidaysQuotes(love, eu, window, loveDe);
  assert.deepEqual(
    de.map((quote) => quote.price),
    [null, null],
  );
  const offers = parseLoveholidaysOffers(love, eu, window, loveDe);
  assert.deepEqual(
    offers.map((offer) => offer.price),
    [1698, 1758, 1818],
  );
  assert.ok(offers.every((offer) => !offer.matchedRoomId && offer.observedAt));
  assert.equal(offers[1].roomFeatures.view, "partial-sea");
  assert.equal(
    parseLoveholidaysQuotes(love, uk, window, loveEn)[0].price,
    1598,
  );
  assert.ok(de.every((quote) => quote.captureMethod === "automated"));
});

test("Loveholidays Queen 23-28 Oct browser sample retains prices without guessing generic room views", () => {
  // Browser observation on 2 Oct 2026, not a successful background-collector run.
  const dates = { ...window, checkIn: "2026-10-23", checkOut: "2026-10-28" };
  const snapshot: LoveholidaysSnapshot = {
    url: buildLoveholidaysUrl(queen, dates),
    hotelName: "Miramare Queen",
    checkInLabel: "23.10.2026",
    nightsLabel: "5 Nächte",
    occupancyLabel: "1 Zimmer, 2 Erw.",
    offers: [
      {
        name: "Standard Zimmer",
        priceText: "Ab 272 € pro Nacht / 1.356 € insgesamt",
        description: "All inclusive Nicht erstattungsfähig",
      },
      {
        name: "Standard Zimmer",
        priceText: "Ab 302 € pro Nacht / 1.507 € insgesamt",
        description:
          "All inclusive Flexible Hoteländerungen Jetzt sichern ab 302 €",
      },
      {
        name: "Suite mit Blick auf die Landschaft",
        priceText: "Ab 407 € pro Nacht / 2.034 € insgesamt",
        description: "All inclusive Nicht erstattungsfähig",
      },
    ],
  };
  const offers = parseLoveholidaysOffers(love, queen, dates, snapshot);
  assert.deepEqual(
    offers.map((offer) => offer.price),
    [1356, 1507, 2034],
  );
  assert.equal(offers[0].terms.cancellation, "İadesiz");
  assert.match(offers[1].terms.cancellation, /ücretsiz iptal anlamına gelmez/);
  assert.ok(offers.every((offer) => !offer.matchedRoomId));
  assert.ok(
    parseLoveholidaysQuotes(love, queen, dates, snapshot).every(
      (quote) => quote.price === null,
    ),
  );
});

test("Loveholidays refuses mismatched dates, hotel, duration, guests, URL and package paths", () => {
  for (const patch of [
    { checkInLabel: "17.10.2026" },
    { hotelName: "Miramare Queen" },
    { nightsLabel: "6 Nächte" },
    { occupancyLabel: "1 Zimmer, 3 Erw." },
    { url: loveDe.url.replace("371656", "123456") },
    { url: loveDe.url.replace("rooms=2", "rooms=3") },
    { url: loveDe.url.replace("2026-10-16", "2027-10-16") },
    { url: loveDe.url.replace("/hotels/l/", "/holidays/") },
  ])
    assert.throws(() =>
      parseLoveholidaysQuotes(love, eu, window, { ...loveDe, ...patch }),
    );
  assert.equal(
    new URL(buildLoveholidaysUrl(queen, window)).searchParams.get("masterId"),
    "371430",
  );
});

test("Loveholidays Queen uses its verified identity and hotel-only total, not flights or family rooms", () => {
  const queenUk = REPORT_SCOPES.find((scope) => scope.id === "queen-uk")!;
  // Queen Hotel Only page observed on 2 Oct 2026 for 16-21 Oct, 1 room / 2 adults.
  const quotes = parseLoveholidaysQuotes(love, queenUk, window, {
    ...loveEn,
    url: buildLoveholidaysUrl(queenUk, window),
    hotelName: "Miramare Queen",
    offers: [
      {
        name: "Standard Room with Land View",
        priceText: "From £220 per night / £1,098 total",
        description:
          "All inclusive · Non-refundable · Hotel + flights from £1,278 total",
      },
      {
        name: "Family Room with Garden View",
        priceText: "From £232 per night / £1,158 total",
        description: "All inclusive",
      },
      {
        name: "Standard Room with Partial Sea View",
        priceText: "From £232 per night / £1,158 total",
        description:
          "All inclusive · Non-refundable · Hotel + flights from £1,338 total",
      },
    ],
  });
  assert.deepEqual(
    quotes.map((quote) => quote.price),
    [1098, null],
  );
  assert.ok(
    quotes.every(
      (quote) => quote.scopeKey === "queen-uk" && quote.currency === "GBP",
    ),
  );
});

test("Loveholidays refuses nightly-only, wrong-currency and incompatible room amounts", () => {
  for (const priceText of [
    "340 € pro Nacht",
    "£1,698 total",
    "0 € insgesamt",
    "Preis auf Anfrage",
  ])
    assert.ok(
      parseLoveholidaysQuotes(love, eu, window, {
        ...loveDe,
        offers: loveDe.offers.map((offer) => ({ ...offer, priceText })),
      }).every((quote) => quote.price === null),
    );
  for (const name of [
    "Superior-Eckzimmer mit Meerblick",
    "Deluxe Superior Sea View",
    "Superior Familienzimmer Meerblick",
  ])
    assert.ok(
      parseLoveholidaysQuotes(love, eu, window, {
        ...loveDe,
        offers: [{ ...loveDe.offers[2], name }],
      }).every((quote) => quote.price === null),
    );
});

test("Loveholidays handles singular nights and unpadded English calendar days", () => {
  const oneNight = {
    ...window,
    checkIn: "2026-10-09",
    checkOut: "2026-10-10",
    nights: 1,
  };
  const snapshot = {
    ...loveEn,
    url: buildLoveholidaysUrl(uk, oneNight),
    checkInLabel: "Fri 9 Oct 2026",
    nightsLabel: "1 night",
  };
  assert.equal(
    parseLoveholidaysQuotes(love, uk, oneNight, snapshot)[0].price,
    1598,
  );
});

// Synthetic Booking DOM contract. Live room-table access is not yet verified.
const bookingSnapshot: BookingSnapshot = {
  url: buildBookingUrl(eu, window),
  hotelName: "Miramare Beach Hotel - Ultra All Inclusive",
  checkIn: window.checkIn,
  checkOut: window.checkOut,
  occupancy: "2 adults · 0 children · 1 room",
  stayLabel: "Price for 5 nights",
  rows: [
    {
      name: "Superior Double Room with Land View",
      priceText: "€1,500",
      conditions: "All inclusive",
      selectable: true,
    },
    {
      name: "Superior Double Room with Sea View",
      priceText: "€1,700",
      conditions: "All inclusive",
      selectable: true,
    },
  ],
};

test("Booking reads selectable room totals, not hotel starting prices", () => {
  assert.deepEqual(
    parseBookingQuotes(booking, eu, window, bookingSnapshot).map(
      (quote) => quote.price,
    ),
    [1500, 1700],
  );
  const queenUrl = new URL(buildBookingUrl(queen, window));
  assert.match(queenUrl.pathname, /miramare-queen\.en-gb\.html$/);
  assert.equal(queenUrl.searchParams.get("group_children"), "0");
});

test("Booking requires independent date, party, property, currency and total verification", () => {
  for (const patch of [
    { hotelName: "Miramare Beach Annex" },
    { checkIn: "2026-10-17" },
    { checkOut: "2026-10-22" },
    { occupancy: "2 adults · 1 child · 1 room" },
    { stayLabel: "Price for 1 night" },
    {
      url: bookingSnapshot.url.replace(
        "selected_currency=EUR",
        "selected_currency=GBP",
      ),
    },
    { url: bookingSnapshot.url.replace("group_adults=2", "group_adults=3") },
    {
      url: bookingSnapshot.url.replace(
        "miramare-beach-hotel-side",
        "another-hotel",
      ),
    },
    { url: "https://www.booking.com/index.en-gb.html?tr_redirected=1" },
  ])
    assert.throws(() =>
      parseBookingQuotes(booking, eu, window, { ...bookingSnapshot, ...patch }),
    );
});

test("Booking rejects non-selectable, ambiguous, nightly and mixed-currency amounts", () => {
  for (const priceText of [
    "From €1,500",
    "€300 per night",
    "€1,900 €1,500",
    "£1,500",
    "€0",
    "Contact hotel",
  ])
    assert.ok(
      parseBookingQuotes(booking, eu, window, {
        ...bookingSnapshot,
        rows: bookingSnapshot.rows.map((row) => ({ ...row, priceText })),
      }).every(
        (quote) => quote.price === null && quote.status === "manual-review",
      ),
    );
  assert.ok(
    parseBookingQuotes(booking, eu, window, {
      ...bookingSnapshot,
      rows: bookingSnapshot.rows.map((row) => ({ ...row, selectable: false })),
    }).every((quote) => quote.price === null),
  );
});

const tuiDestination = new URL(
  "https://www.tui.com/hotel/suchen/angebote/hotel/4893/offer/",
);
tuiDestination.search = new URLSearchParams({
  startDate: window.checkIn,
  endDate: window.checkOut,
  duration: "5",
  travellers: "2",
  searchScope: "HOTEL",
}).toString();
const clickUrl = (destination: string) =>
  `https://www.google.com/travel/lodging/clk?${new URLSearchParams({ pcurl: destination })}`;
const googleSnapshot: GoogleHotelsSnapshot = {
  url: "https://www.google.com/travel/search?q=Miramare+Beach+Side&hl=en",
  hotelName: "Miramare Beach Hotel",
  checkInLabel: "Fri, Oct 16",
  checkOutLabel: "Wed, Oct 21",
  adults: 2,
  children: 0,
  priceDisplay: "Stay total",
  offers: [
    {
      provider: "TUI.com",
      priceText: "€1,458",
      href: clickUrl(tuiDestination.toString()),
    },
  ],
};

test("Google Hotels returns separately labelled hotel-level observations only", () => {
  const prices = parseGoogleHotelPrices(
    eu,
    window,
    [tui, booking],
    googleSnapshot,
  );
  assert.equal(prices.length, 1);
  assert.equal(prices[0].price, 1458);
  assert.equal(prices[0].source, "google-hotels");
  assert.equal(prices[0].providerKey, "tui");
  assert.ok(!("roomId" in prices[0]));
  const report = {
    ...buildBenchmarkResult({
      mode: "live",
      scopes: [{ ...eu, windows: [window] }],
      providers: [tui],
      quotes: [],
      warnings: [],
    }),
    hotelPrices: prices,
  };
  assert.equal(report.summary.availableRateCount, 0);
  assert.equal(report.summary.coveragePct, 0);
});

test("Google Hotels verifies visible date, party and total controls", () => {
  for (const patch of [
    { checkInLabel: "Sat, Oct 17" },
    { checkOutLabel: "Thu, Oct 22" },
    { adults: 1 },
    { children: 1 },
    { priceDisplay: "Nightly total" },
    { hotelName: "Miramare Queen" },
    { url: "https://example.com/travel/search" },
  ])
    assert.throws(() =>
      parseGoogleHotelPrices(eu, window, [tui], {
        ...googleSnapshot,
        ...patch,
      }),
    );
});

test("Google Hotels verifies the OTA link's actual year, property and hotel-only request", () => {
  for (const [key, value] of [
    ["startDate", "2027-10-16"],
    ["endDate", "2027-10-21"],
    ["duration", "6"],
    ["travellers", "3"],
    ["searchScope", "PACKAGE"],
  ]) {
    const bad = new URL(tuiDestination);
    bad.searchParams.set(key, value);
    assert.deepEqual(
      parseGoogleHotelPrices(eu, window, [tui], {
        ...googleSnapshot,
        offers: [
          { ...googleSnapshot.offers[0], href: clickUrl(bad.toString()) },
        ],
      }),
      [],
    );
  }
  for (const href of [
    clickUrl(tuiDestination.toString().replace("4893", "4894")),
    clickUrl(
      tuiDestination.toString().replace("www.tui.com", "unrelated.example"),
    ),
    "https://www.google.com/travel/lodging/clk",
  ])
    assert.deepEqual(
      parseGoogleHotelPrices(eu, window, [tui], {
        ...googleSnapshot,
        offers: [{ ...googleSnapshot.offers[0], href }],
      }),
      [],
    );
});

test("Google Hotels excludes ambiguous price lines and unselected providers", () => {
  for (const priceText of ["€292 per night", "€1,458 €1,500", "£1,458", "€0"])
    assert.deepEqual(
      parseGoogleHotelPrices(eu, window, [tui], {
        ...googleSnapshot,
        offers: [{ ...googleSnapshot.offers[0], priceText }],
      }),
      [],
    );
  assert.deepEqual(
    parseGoogleHotelPrices(eu, window, [booking], googleSnapshot),
    [],
  );
});
