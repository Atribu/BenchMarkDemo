import test from "node:test";
import assert from "node:assert/strict";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import {
  classifyRoom,
  matchOfferRoom,
  resolveRoomMatch,
  selectOfferQuotes,
  deduplicateOffers,
  offerConditions,
} from "../src/lib/ota/offer-matching";
import {
  parseHolidayCheckOffers,
  buildHolidayCheckHotelOnlyUrl,
  type HolidayCheckOffer,
} from "../src/lib/ota/live-holidaycheck";
import {
  buildLoveholidaysUrl,
  parseLoveholidaysOffers,
} from "../src/lib/ota/live-loveholidays";
import { buildBenchmarkResult } from "../src/lib/benchmark/engine";
import { benchmarkCsv } from "../src/lib/benchmark/export";

const window = {
  id: "audit",
  label: "23-28 Oct",
  checkIn: "2026-10-23",
  checkOut: "2026-10-28",
  nights: 5,
};
const beach = {
  ...REPORT_SCOPES.find((scope) => scope.id === "beach-eu")!,
  windows: [window],
};
const queen = {
  ...REPORT_SCOPES.find((scope) => scope.id === "queen-eu")!,
  windows: [window],
};
const portNature = {
  ...REPORT_SCOPES.find((scope) => scope.id === "port-nature-eu")!,
  windows: [window],
};
const syWindow = {
  id: "2027-05-10_2027-05-15",
  label: "10–15 Mayıs 2027",
  checkIn: "2027-05-10",
  checkOut: "2027-05-15",
  nights: 5,
};
const syHotels = {
  ...REPORT_SCOPES.find((scope) => scope.id === "sy-hotels-eu")!,
  windows: [syWindow],
};
const hc = OTA_PROVIDERS.find((provider) => provider.key === "holidaycheck")!;
const url =
  "https://www.holidaycheck.de/ho/angebote-hotel-miramare-beach/976607ee-0f98-365d-bdbf-f96af4b03a6d/hotelonly?_offer=departureDate:2026-10-23,duration:exactly,returnDate:2026-10-28,rooms:a-a";

// Sanitized service-field contract observed on 2 Oct 2026; prices are test inputs.
function raw(patch: Partial<HolidayCheckOffer> = {}): HolidayCheckOffer {
  return {
    travelkind: "hotelonly",
    hotelId: "976607ee-0f98-365d-bdbf-f96af4b03a6d",
    departureDate: { day: 23, month: 10, year: 2026 },
    returnDate: { formatted: "28.10.2026" },
    adults: 2,
    children: [],
    numberOfRooms: 1,
    room: { description: "Doppelzimmer Superior Landseite Balkon" },
    totalPrice: { amount: 1500, currency: "EUR" },
    mealTypeName: "All Inclusive Plus",
    tourOperator: { name: "Test Operator" },
    availability: { status: "AVAILABLE", checkNeeded: false },
    specials: [
      {
        specialType: "PERSONAL_CASH_BACK",
        discount: { amount: 100, currency: "EUR" },
        specialTexts: [
          { key: "description", text: "Nach der Reise; Bedingungen gelten." },
        ],
      },
      {
        specialType: "CANCELLATION",
        specialTexts: [
          { key: "label", text: "Kostengünstig stornierbar" },
          { key: "subLabel", text: "Im Stornofall: insgesamt 50 EUR" },
        ],
      },
    ],
    ...patch,
  };
}

test("strict room matching recognizes German names without confusing partial/full sea or missing balcony", () => {
  assert.equal(
    matchOfferRoom(beach, classifyRoom("DZ Superior Meerblick Balkon"))
      .matchedRoomId,
    "superior-sea",
  );
  assert.equal(
    matchOfferRoom(
      beach,
      classifyRoom("Superior Land View", "Balkon Gartenblick"),
    ).matchedRoomId,
    "superior-land",
  );
  for (const name of [
    "DZ Superior seitl. Meerblick Balkon",
    "Superior Side Sea View Balcony",
    "Superior Land View without Balcony",
    "Superior Land View",
    "Standard Room",
    "Superior Land or Sea View Balcony",
    "Superior Eckzimmer Meerblick Balkon",
    "Superior Family Sea View Balcony",
    "Economy Land View Balcony",
  ]) {
    assert.equal(
      matchOfferRoom(beach, classifyRoom(name)).matchedRoomId,
      undefined,
      name,
    );
  }
  assert.equal(classifyRoom("Superior ohne Balkon Landseite").balcony, "no");
  assert.equal(
    classifyRoom("Superior mit seitlichem Meerblick").view,
    "partial-sea",
  );
});

test("explicit economy aliases match only the complete configured room name", () => {
  assert.equal(
    resolveRoomMatch(
      beach,
      "Doppelzimmer Economy",
      { economy: ["Doppelzimmer Economy"] },
    ).matchedRoomId,
    "economy",
  );
  for (const roomName of [
    "Doppelzimmer Economy Meerblick",
    "Economy Family Room",
    "Superior Promo Land View",
    "Best Price Room",
  ]) {
    assert.equal(
      resolveRoomMatch(
        beach,
        roomName,
        { economy: ["Doppelzimmer Economy"] },
      ).matchedRoomId,
      undefined,
      roomName,
    );
  }
});

test("central room resolver rejects ambiguous and contradictory aliases", () => {
  const ambiguous = resolveRoomMatch(beach, "Shared Room", {
    economy: ["Shared Room"],
    corner: ["Shared Room"],
  });
  assert.equal(ambiguous.matchedRoomId, undefined);
  assert.match(ambiguous.matchReason, /birden fazla/);

  const partialAsFull = resolveRoomMatch(
    beach,
    "Superior Side Sea View Balcony",
    { "superior-sea": ["Superior Side Sea View Balcony"] },
  );
  assert.equal(partialAsFull.matchedRoomId, undefined);
  assert.match(partialAsFull.matchReason, /kısmi deniz/i);

  const balconyConflict = resolveRoomMatch(
    beach,
    "Superior Land View without Balcony",
    { "superior-land": ["Superior Land View without Balcony"] },
  );
  assert.equal(balconyConflict.matchedRoomId, undefined);
  assert.match(balconyConflict.matchReason, /Balkonsuz/);
});

test("central room resolver accepts verified variants without provider logic", () => {
  const economy = resolveRoomMatch(
    beach,
    "Superior Land View Best Price without Balcony",
    { economy: ["Superior Land View Best Price without Balcony"] },
  );
  assert.equal(economy.matchedRoomId, "economy");

  const exactSea = resolveRoomMatch(
    beach,
    "Superior-Standardzimmer mit Meerblick",
    { "superior-sea": ["Superior-Standardzimmer mit Meerblick"] },
  );
  assert.equal(exactSea.matchedRoomId, "superior-sea");
  assert.match(exactSea.matchReason, /kesin olarak/);
});

test("HolidayCheck maps the verified Beach economy name without relaxing generic variants", () => {
  const offers = parseHolidayCheckOffers(
    hc,
    beach,
    window,
    [
      raw({
        room: { name: "Doppelzimmer Economy" },
        totalPrice: { amount: 1296, currency: "EUR" },
      }),
      raw({
        room: { name: "Superior Promo Land View" },
        totalPrice: { amount: 1200, currency: "EUR" },
      }),
    ],
    url,
  );
  assert.equal(offers[0].matchedRoomId, "economy");
  assert.equal(offers[1].matchedRoomId, undefined);
  const economy = selectOfferQuotes(hc, beach, window, offers, url).find(
    (quote) => quote.roomId === "economy",
  );
  assert.equal(economy?.price, 1296);
});

test("HolidayCheck maps Port Nature live room labels through exact aliases", () => {
  const portUrl = buildHolidayCheckHotelOnlyUrl(
    "https://www.holidaycheck.de/hi/port-nature-luxury-resort-spa/6a10924b-2286-3a46-b5db-ad9802b8d226",
    window.checkIn,
    window.checkOut,
  )!;
  const roomCases = [
    ["Doppelzimmer", "standard-land", 1246],
    ["DZ seitl. Meerblick", "standard-side-sea", 1282],
    ["Doppelzimmer Meerblick", "standard-sea", 1406],
    ["FZ seitl. Meerblick", "family", 1918],
  ] as const;
  const offers = parseHolidayCheckOffers(
    hc,
    portNature,
    window,
    roomCases.map(([name, , amount]) =>
      raw({
        hotelId: "6a10924b-2286-3a46-b5db-ad9802b8d226",
        room: { name },
        totalPrice: { amount, currency: "EUR" },
      }),
    ),
    portUrl,
  );

  assert.deepEqual(
    offers.map((offer) => [offer.roomName, offer.matchedRoomId, offer.price]),
    roomCases,
  );
});

test("HolidayCheck maps explicit SY Hotels supplier names without accepting generic rooms", () => {
  const syUrl = buildHolidayCheckHotelOnlyUrl(
    "https://www.holidaycheck.de/hi/sy-luxury-belek/3c0937bc-b1d6-42a8-9280-0644000c2a43",
    syWindow.checkIn,
    syWindow.checkOut,
  )!;
  const roomCases = [
    [
      "Doppelzimmer Deluxe Landseite Klimaanlage Dusche Balkon",
      "deluxe-land",
    ],
    ["Double Standard Room Pool View", "deluxe-pool"],
    ["Deluxe Shallow Pool Room - 1 Queen Bed", "deluxe-shallow-pool"],
    ["Deluxe Room With Swim Up Pool And Terrace", "deluxe-swim-up"],
    [
      "Deluxe Family Room With Swim Up Pool And Terrace",
      "deluxe-family-swim-up",
    ],
  ] as const;
  const genericRooms = [
    "DOUBLE DELUXE ROOM",
    "Doppelzimmer",
    "DELUXE DOPPEL ZIMMER MIT TERRASSE",
    "Doppelzimmer Best Price Landseite Klimaanlage Dusche Balkon",
  ];
  const makeSyOffer = (name: string, amount: number): HolidayCheckOffer =>
    raw({
      hotelId: "3c0937bc-b1d6-42a8-9280-0644000c2a43",
      departureDate: { day: 10, month: 5, year: 2027 },
      returnDate: { formatted: "15.05.2027" },
      room: { name },
      totalPrice: { amount, currency: "EUR" },
    });
  const offers = parseHolidayCheckOffers(
    hc,
    syHotels,
    syWindow,
    [
      ...roomCases.map(([name], index) => makeSyOffer(name, 900 + index)),
      ...genericRooms.map((name, index) => makeSyOffer(name, 800 + index)),
    ],
    syUrl,
  );

  assert.deepEqual(
    offers.slice(0, roomCases.length).map((offer) => [
      offer.roomName,
      offer.matchedRoomId,
    ]),
    roomCases,
  );
  assert.ok(
    offers.slice(roomCases.length).every((offer) => !offer.matchedRoomId),
  );
});

test("Queen accepts explicit standard/double views but not superior or partial-sea upgrades", () => {
  assert.equal(
    matchOfferRoom(queen, classifyRoom("Doppelzimmer mit Gartenblick"))
      .matchedRoomId,
    "standard-land",
  );
  assert.equal(
    matchOfferRoom(queen, classifyRoom("Doppelzimmer Meerblick")).matchedRoomId,
    "standard-sea",
  );
  for (const name of [
    "Superior Meerblick",
    "Standard Room",
    "DZ seitl. Meerblick",
    "Doppelzimmer Economy Landseite",
  ])
    assert.equal(
      matchOfferRoom(queen, classifyRoom(name)).matchedRoomId,
      undefined,
    );
});

test("sea-facing and garden-building locations do not prove a room view", () => {
  for (const name of [
    "Doppelzimmer Meerseite Balkon",
    "Standard Room Garden Building",
    "Standard Room Sea Facing",
    "Standard Room without Sea View",
  ])
    assert.equal(
      matchOfferRoom(queen, classifyRoom(name)).matchedRoomId,
      undefined,
      name,
    );
  assert.equal(classifyRoom("DZ Teilmeerblick").view, "partial-sea");
  assert.equal(
    matchOfferRoom(queen, classifyRoom("Standardzimmer Meerblick"))
      .matchedRoomId,
    "standard-sea",
  );
});

test("HolidayCheck preserves gross total, original board, operator and paid-cancellation conditions", () => {
  const [offer] = parseHolidayCheckOffers(hc, beach, window, [raw()], url);
  assert.equal(offer.price, 1500);
  assert.equal(offer.matchedRoomId, "superior-land");
  assert.equal(offer.terms.board, "All Inclusive Plus");
  assert.equal(offer.terms.operator, "Test Operator");
  assert.equal(offer.terms.cashback?.amount, 100);
  assert.match(offer.terms.cancellation, /50 EUR/);
  assert.doesNotMatch(offer.terms.cancellation, /Ücretsiz/);
  assert.match(offerConditions(offer.terms), /toplamdan düşülmedi/);
  assert.ok(offer.observedAt);
});

test("HolidayCheck missing conditions are explicit, not inferred as refundable or taxes included", () => {
  const [offer] = parseHolidayCheckOffers(
    hc,
    beach,
    window,
    [
      raw({
        mealTypeName: undefined,
        specials: [],
        availability: { checkNeeded: true, status: "UNKNOWN" },
      }),
    ],
    url,
  );
  assert.equal(offer.terms.board, "Belirtilmedi");
  assert.equal(offer.terms.cancellation, "Belirtilmedi");
  assert.equal(offer.terms.cashback, undefined);
  assert.match(offer.terms.availability, /kontrolü gerekiyor/);
  assert.match(offer.terms.taxes, /doğrulanmadı/);
});

test("HolidayCheck rejects wrong hotel, dates, party, package, currency and invalid totals even as alternatives", () => {
  const invalid: Partial<HolidayCheckOffer>[] = [
    { hotelId: "other" },
    { hotelId: undefined },
    { adults: 3 },
    { children: [5] },
    { children: undefined },
    { numberOfRooms: 2 },
    { departureDate: "2026-10-24" },
    { returnDate: "2026-10-29" },
    { travelkind: "package" },
    { totalPrice: { amount: 1500, currency: "GBP" } },
    { totalPrice: { amount: 0, currency: "EUR" } },
    { totalPrice: { amount: NaN, currency: "EUR" } },
    { totalPrice: { amount: Infinity, currency: "EUR" } },
    { availability: { status: "UNAVAILABLE" } },
  ];
  for (const patch of invalid)
    assert.deepEqual(
      parseHolidayCheckOffers(hc, beach, window, [raw(patch)], url),
      [],
      JSON.stringify(patch),
    );
});

test("HolidayCheck cheapest economy, unknown and partial rooms survive without replacing the exact room", () => {
  const offers = parseHolidayCheckOffers(
    hc,
    beach,
    window,
    [
      raw(),
      raw({
        room: { name: "Superior Land View Best Price without Balcony" },
        totalPrice: { amount: 1000, currency: "EUR" },
      }),
      raw({
        room: { name: "DZ Superior seitl. Meerblick Balkon" },
        totalPrice: { amount: 1100, currency: "EUR" },
      }),
      raw({
        room: { name: "Standard Zimmer" },
        totalPrice: { amount: 900, currency: "EUR" },
      }),
    ],
    url,
  );
  assert.equal(offers.length, 4);
  const quotes = selectOfferQuotes(hc, beach, window, offers, url);
  assert.deepEqual(
    quotes.map((quote) => quote.price),
    [null, null, 1500, null],
  );
  assert.match(quotes[1].reason!, /Alternatif/);
});

test("deduplication keeps distinct operators and cancellation/board terms", () => {
  const offers = parseHolidayCheckOffers(
    hc,
    beach,
    window,
    [
      raw(),
      raw(),
      raw({ mealTypeName: "All Inclusive" }),
      raw({ tourOperator: { name: "Another Operator" } }),
      raw({
        cancellationInformation: { freeCancellationUntilISO: "2026-10-10" },
        specials: [],
      }),
    ],
    url,
  );
  assert.equal(offers.length, 4);
  assert.equal(deduplicateOffers([...offers, ...offers]).length, 4);
});

test("alternative offers are exported separately and never inflate room coverage or live parity", () => {
  const offers = parseHolidayCheckOffers(
    hc,
    beach,
    window,
    [
      raw(),
      raw({
        room: { name: "Standard Zimmer" },
        totalPrice: { amount: 900, currency: "EUR" },
      }),
      raw({ mealTypeName: "All Inclusive" }),
    ],
    url,
  );
  const report = buildBenchmarkResult({
    mode: "live",
    warnings: [],
    scopes: [beach],
    providers: [hc],
    offers,
    quotes: selectOfferQuotes(hc, beach, window, offers, url),
  });
  assert.equal(report.summary.availableRateCount, 1);
  assert.equal(report.summary.expectedRateCount, 4);
  assert.equal(report.summary.alternativeOfferCount, 2);
  assert.equal(report.summary.coveragePct, 25);
  assert.deepEqual(report.summary.cheapestProviderWins, []);
  assert.equal(report.summary.parityRiskCount, 0);
  assert.equal(report.scopes[0].windows[0].alternativeOffers?.[0].price, 900);
  const csv = benchmarkCsv(report);
  assert.match(csv, /ALTERNATİF TEKLİF \/ ODA KAPSAMASINA DAHİL DEĞİL/);
  assert.match(csv, /Standard Zimmer/);
  assert.match(csv, /toplamdan düşülmedi/);
  assert.equal(csv.split("\r\n").length, 7);
});

test("engine excludes invalid or unselected alternatives at its report boundary", () => {
  const [offer] = parseHolidayCheckOffers(hc, beach, window, [raw()], url);
  const offers = [
    { ...offer, currency: "GBP" as const },
    { ...offer, checkIn: "2026-10-24" },
    { ...offer, checkOut: "2026-10-29" },
    { ...offer, rooms: 2 },
    { ...offer, adults: 3 },
    { ...offer, nights: 6 },
    { ...offer, price: NaN },
    { ...offer, scopeKey: "queen-eu" as const },
    { ...offer, windowId: "other" },
    { ...offer, providerKey: "tui" as const },
  ];
  const report = buildBenchmarkResult({
    mode: "live",
    warnings: [],
    scopes: [beach],
    providers: [hc],
    offers,
    quotes: [],
  });
  assert.equal(report.summary.alternativeOfferCount, 0);
});

test("HolidayCheck source link includes exact dates, hotel-only and one room with two adults", () => {
  assert.equal(
    buildHolidayCheckHotelOnlyUrl(
      "https://www.holidaycheck.de/hi/hotel-miramare-beach/976607ee-0f98-365d-bdbf-f96af4b03a6d",
      window.checkIn,
      window.checkOut,
    ),
    url,
  );
});

test("Loveholidays generic German room is retained as an alternative with raw total and no guessed view", () => {
  const love = OTA_PROVIDERS.find(
    (provider) => provider.key === "loveholidays",
  )!;
  const offers = parseLoveholidaysOffers(love, queen, window, {
    url: buildLoveholidaysUrl(queen, window),
    hotelName: queen.hotelName,
    checkInLabel: "23.10.2026",
    nightsLabel: "5 Nächte",
    occupancyLabel: "1 Zimmer, 2 Erw.",
    offers: [
      {
        name: "Standard Zimmer",
        priceText: "323 € pro Nacht / 1.613 € insgesamt",
        description:
          "All inclusive Nicht erstattungsfähig Hotel + Flug 2.000 €",
      },
    ],
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 1613);
  assert.equal(offers[0].matchedRoomId, undefined);
  assert.equal(offers[0].roomFeatures.view, "unknown");
  assert.equal(offers[0].terms.cancellation, "İadesiz");
});
