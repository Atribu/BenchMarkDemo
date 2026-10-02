import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  parsePriceFromText,
  resolveProviderLiveConfig,
} from "../src/lib/ota/live-helpers";
import { hasCompatibleView } from "../src/lib/ota/room-matching";
import { __hotelbedsInternal as hotelbeds } from "../src/lib/ota/live-hotelbeds";
import { collectTuiLiveQuotes } from "../src/lib/ota/live-tui";
import { __ukOtaInternal as ukOta } from "../src/lib/ota/live-uk-ota";
import {
  nightCount,
  parseBenchmarkRequest,
  todayInIstanbul,
} from "../src/lib/benchmark/request";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import { buildBenchmarkResult } from "../src/lib/benchmark/engine";
import { benchmarkCsv } from "../src/lib/benchmark/export";
import type { CurrencyCode, ProviderQuote } from "../src/lib/benchmark/types";

const priceCases: [string, CurrencyCode, number | null][] = [
  ["£1,466", "GBP", 1466],
  ["1.466 €", "EUR", 1466],
  ["EUR 1.466,50", "EUR", 1466.5],
  ["£1,466.50", "GBP", 1466.5],
  ["1 466,50 EUR", "EUR", 1466.5],
  ["1\u202f466,50 €", "EUR", 1466.5],
  ["€1466", "EUR", 1466],
  ["GBP 1,234,567.89", "GBP", 1234567.89],
  ["€0", "EUR", null],
  ["£1,23,456", "GBP", null],
  ["$1,466", "EUR", null],
  ["£1,466", "EUR", null],
  ["1.466 €", "GBP", null],
];
for (const [input, currency, expected] of priceCases)
  test(`price: ${input} / ${currency}`, () =>
    assert.equal(parsePriceFromText(input, currency), expected));

test("view matching rejects generic and opposite views, accepts German aliases", () => {
  assert.equal(
    hasCompatibleView("standard-land", "Standard Room Sea View"),
    false,
  );
  assert.equal(hasCompatibleView("standard-land", "Standard Room"), false);
  assert.equal(
    hasCompatibleView("superior-sea", "Superior Garden View"),
    false,
  );
  assert.equal(
    hasCompatibleView("superior-land", "Superior Doppelzimmer Landseite"),
    true,
  );
  assert.equal(
    hasCompatibleView("superior-sea", "Superior seitlicher Meerblick"),
    true,
  );
  assert.equal(hasCompatibleView("superior-land", "Land or Sea View"), false);
});

test("Hotelbeds handles gzip and uncompressed JSON", () => {
  const data = { hotels: { hotels: [], total: 0 } };
  const buffer = Buffer.from(JSON.stringify(data));
  assert.deepEqual(
    hotelbeds.decodeHotelbedsResponse(gzipSync(buffer), "gzip"),
    data,
  );
  assert.deepEqual(hotelbeds.decodeHotelbedsResponse(buffer), data);
  assert.throws(() =>
    hotelbeds.decodeHotelbedsResponse(Buffer.from("not json")),
  );
});

test("Hotelbeds excludes net rates, recheck rates and opposite-view rooms", () => {
  assert.equal(hotelbeds.parseRatePrice({ net: "900" }), null);
  assert.equal(
    hotelbeds.parseRatePrice({ net: "900", sellingRate: "1100" }),
    1100,
  );
  assert.equal(hotelbeds.parseRatePrice({ sellingRate: "-5" }), null);
  const rooms = [
    {
      name: "Standard Room Sea View",
      rates: [{ sellingRate: "800", rateType: "BOOKABLE" }],
    },
    {
      name: "Standard Land View",
      rates: [
        { net: "700", rateType: "BOOKABLE" },
        { sellingRate: "850", rateType: "RECHECK" },
        { sellingRate: "1000", rateType: "BOOKABLE" },
      ],
    },
  ];
  assert.equal(
    hotelbeds.findRoomCandidate(
      rooms,
      ["Standard Room", "Standard Land View"],
      "standard-land",
    )?.rate.sellingRate,
    "1000",
  );
});

function tuiOffer(name: string, amount: number, giataCode = "4893") {
  return {
    arrivalDate: "2026-05-10",
    departureDate: "2026-05-15",
    duration: 5,
    currency: "EUR",
    hotel: { giataCode },
    price: { amount },
    travellers: [{ age: 30 }, { age: 30 }],
    rooms: [{ roomName: name, supplierRoomId: name }],
    board: { boardName: "All inclusive" },
    cancellationTerms: { freeCancellation: false, date: "" },
    hasCityTax: false,
  };
}
const tuiProvider = OTA_PROVIDERS.find((provider) => provider.key === "tui")!;

test("TUI sea-view offer cannot be assigned to the generic land alias", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      roomTypes: [
        {
          offers: [tuiOffer("Standard Room Sea View", 1300, "4894")],
        },
      ],
    }),
  );
  const scope = REPORT_SCOPES.find((scope) => scope.id === "queen-eu")!;
  const result = await collectTuiLiveQuotes(
    OTA_PROVIDERS.find((provider) => provider.key === "tui")!,
    { ...scope, windows: scope.windows.slice(0, 1) },
  );
  assert.equal(
    result.quotes.find((quote) => quote.roomId === "standard-land")?.status,
    "manual-review",
  );
  assert.equal(
    result.quotes.find((quote) => quote.roomId === "standard-sea")?.price,
    1300,
  );
});

test("TUI malformed success response is not sold out", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ message: "temporarily unavailable" }),
  );
  const scope = REPORT_SCOPES[0];
  const result = await collectTuiLiveQuotes(
    OTA_PROVIDERS.find((provider) => provider.key === "tui")!,
    { ...scope, windows: scope.windows.slice(0, 1) },
  );
  assert.ok(result.quotes.every((quote) => quote.status === "manual-review"));
});

test("TUI empty room types means no channel offer, not a connection error", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ roomTypes: [] }),
  );
  const scope = REPORT_SCOPES[0];
  const result = await collectTuiLiveQuotes(
    OTA_PROVIDERS.find((provider) => provider.key === "tui")!,
    { ...scope, windows: scope.windows.slice(0, 1) },
  );
  assert.ok(result.quotes.every((quote) => quote.status === "sold_out"));
  assert.ok(
    result.quotes.every((quote) => quote.reason?.includes("uçaksız teklif")),
  );
});

test("TUI requests hotel-only rooms and prefers exact land/sea over cheapest variants", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(
        String(input),
        "https://cloud.tui.com/osp/ao/ml/rooms-panel/rooms",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        hotelId: "4893",
        locale: "de-DE",
        market: "de",
        ages: "30,30",
        startDate: "2026-05-10",
        endDate: "2026-05-15",
        duration: "5",
        sourceSystem: "TRIPS",
      });
      return Response.json({
        roomTypes: [
          {
            offers: [
              tuiOffer("Superior Land View Best Price without Balcony", 1456),
            ],
          },
          {
            roomContent: [
              {
                roomCode: "Superior Land View",
                facilities: [{ text: "Balkon" }],
              },
            ],
            offers: [
              tuiOffer("Superior Land View", 1520),
              tuiOffer("Superior Land View", 1502),
            ],
          },
          { offers: [tuiOffer("Superior Side Sea View", 1560)] },
          {
            offers: [tuiOffer("Superior Sea View", 1604)],
            roomContent: [
              {
                roomCode: "Superior Sea View",
                facilities: [{ text: "Balkon" }],
              },
            ],
          },
        ],
      });
    },
  );
  const scope = {
    ...REPORT_SCOPES[0],
    windows: REPORT_SCOPES[0].windows.slice(0, 1),
  };
  const result = await collectTuiLiveQuotes(tuiProvider, scope);
  assert.deepEqual(
    result.quotes.map((quote) => quote.price),
    [1502, 1604],
  );
  assert.equal(
    result.quotes[1].offerDescription,
    "Superior Sea View · All inclusive",
  );
  assert.equal(
    new URL(result.quotes[0].sourceHint).searchParams.get("selectedDuration"),
    "5",
  );
  assert.equal(result.offers?.length, 5);
  assert.ok(
    result.offers?.find(
      (offer) => offer.price === 1456 && !offer.matchedRoomId,
    ),
  );
  assert.ok(
    result.offers?.find(
      (offer) =>
        offer.price === 1560 &&
        offer.roomFeatures.view === "partial-sea" &&
        !offer.matchedRoomId,
    ),
  );
  assert.equal(result.quotes[0].terms?.cancellation, "Ücretsiz iptal yok");
  assert.ok(result.quotes[0].observedAt);
});

test("TUI rejects per-person prices, wrong dates, hotel, currency and occupancy", async (t) => {
  const good = tuiOffer("Superior Land View", 1502);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      roomTypes: [
        {
          offers: [
            { ...good, price: undefined, pricePerPerson: { amount: 100 } },
            { ...good, departureDate: "2026-05-16" },
            { ...good, duration: 1 },
            { ...good, hotel: { giataCode: "4894" } },
            { ...good, currency: "GBP" },
            { ...good, travellers: [{ age: 30 }, { age: 12 }] },
            { ...good, rooms: [...good.rooms, ...good.rooms] },
            { ...good, price: { amount: 0 } },
          ],
        },
      ],
    }),
  );
  const result = await collectTuiLiveQuotes(tuiProvider, {
    ...REPORT_SCOPES[0],
    windows: REPORT_SCOPES[0].windows.slice(0, 1),
  });
  assert.ok(
    result.quotes.every(
      (quote) => quote.price === null && quote.status === "manual-review",
    ),
  );
  assert.deepEqual(result.offers, []);
});

test("TUI failure for a later window preserves earlier prices", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (calls++ > 0) return new Response("unavailable", { status: 503 });
    return Response.json({
      roomTypes: [
        {
          offers: [tuiOffer("Superior Land View", 1502)],
          roomContent: [
            {
              roomCode: "Superior Land View",
              facilities: [{ text: "Balkon" }],
            },
          ],
        },
      ],
    });
  });
  const result = await collectTuiLiveQuotes(tuiProvider, {
    ...REPORT_SCOPES[0],
    windows: REPORT_SCOPES[0].windows.slice(0, 2),
  });
  assert.equal(result.quotes.length, 4);
  assert.equal(result.quotes[0].price, 1502);
  assert.ok(
    result.quotes.slice(2).every((quote) => quote.status === "manual-review"),
  );
});

test("UK diagnostics distinguish broken URLs from access protection and generic promotions", () => {
  assert.match(ukOta.pageDiagnostic(404, "Not found", "Captcha"), /404/);
  assert.match(
    ukOta.pageDiagnostic(
      200,
      "On the Beach",
      "Sorry, we can't find that page.",
    ),
    /404/,
  );
  assert.match(
    ukOta.pageDiagnostic(403, "Access denied", "Verify you are human"),
    /erişim doğrulaması/,
  );
  assert.match(
    ukOta.pageDiagnostic(
      200,
      "On the Beach",
      "Challenge yourself to a holiday! 7 nights with flights £2600",
    ),
    /henüz tamamlanmadı/,
  );
  const scope = REPORT_SCOPES.find((scope) => scope.id === "beach-uk")!;
  assert.equal(
    ukOta.buildUkSearchUrl(
      OTA_PROVIDERS.find((provider) => provider.key === "onthebeach")!,
      scope,
      scope.windows[0],
    ),
    "https://www.onthebeach.co.uk/hotels/turkey/antalya/side/miramare-beach",
  );
});

const validRequest = {
  mode: "live",
  scopeKeys: ["beach-eu"],
  providerKeys: ["tui"],
  customWindow: { checkIn: "2026-10-10", checkOut: "2026-10-15" },
};
test("request validates dates and selectors without rejecting market fallbacks", () => {
  assert.deepEqual(
    parseBenchmarkRequest(validRequest, "2026-10-02"),
    validRequest,
  );
  for (const value of [
    null,
    [],
    {},
    { ...validRequest, providerKeys: "tui" },
    { ...validRequest, providerKeys: [] },
    { ...validRequest, providerKeys: ["unknown"] },
    { ...validRequest, mode: "invalid" },
    { ...validRequest, scopeKeys: ["unknown"] },
    { ...validRequest, customWindow: null },
    {
      ...validRequest,
      customWindow: { checkIn: "2026-02-30", checkOut: "2026-03-10" },
    },
  ]) {
    assert.throws(() => parseBenchmarkRequest(value, "2026-01-01"));
  }
  assert.throws(() => parseBenchmarkRequest(validRequest, "2026-10-11"));
  assert.deepEqual(
    parseBenchmarkRequest(
      { ...validRequest, scopeKeys: ["beach-uk"] },
      "2026-10-02",
    ).scopeKeys,
    ["beach-uk"],
  );
  assert.equal(
    parseBenchmarkRequest({ ...validRequest, mode: "mock" }, "2026-10-11").mode,
    "mock",
  );
});

test("date validation rejects normalized impossible dates and long windows", () => {
  assert.equal(nightCount("2026-02-30", "2026-03-05"), null);
  assert.equal(nightCount("2026-10-10", "2026-10-10"), null);
  assert.equal(nightCount("2026-10-15", "2026-10-10"), null);
  assert.equal(nightCount("2026-01-01", "2026-05-01"), null);
  assert.equal(nightCount("2028-02-28", "2028-03-01"), 2);
  assert.equal(todayInIstanbul(new Date("2026-10-01T22:00:00Z")), "2026-10-02");
});

function reportFor(quote: Partial<ProviderQuote> = {}) {
  const base = REPORT_SCOPES[0];
  const scope = {
    ...base,
    windows: base.windows.slice(0, 1),
    rooms: base.rooms.slice(0, 1),
  };
  return buildBenchmarkResult({
    mode: "live",
    warnings: [],
    scopes: [scope],
    providers: OTA_PROVIDERS.filter((provider) => provider.key === "tui"),
    quotes: [
      {
        providerKey: "tui",
        scopeKey: scope.id,
        roomId: scope.rooms[0].id,
        windowId: scope.windows[0].id,
        currency: "EUR",
        price: 1000,
        status: "available",
        dataMode: "live",
        sourceHint: "https://example.com/offer",
        ...quote,
      },
    ],
  });
}

test("engine excludes mismatched currency, nonpositive prices and manual-review from parity", () => {
  assert.equal(reportFor().summary.availableRateCount, 1);
  assert.equal(reportFor().summary.parityRiskCount, 0);
  assert.deepEqual(reportFor().summary.cheapestProviderWins, []);
  for (const quote of [
    { currency: "GBP" as const },
    { price: -5 },
    { price: NaN },
    { price: Infinity },
    { status: "manual-review" as const },
  ]) {
    const report = reportFor(quote);
    assert.equal(report.summary.availableRateCount, 0);
    assert.equal(report.summary.parityRiskCount, 0);
    assert.equal(
      report.scopes[0].windows[0].rows[0].entries[0].differencePct,
      null,
    );
  }
});

test("CSV includes context, escapes quotes and neutralizes formulas", () => {
  const report = reportFor({
    sourceHint: '=HYPERLINK("https://example.com")',
    reason: "API erişimi eksik",
    offerDescription: "Superior Sea View",
  });
  report.mode = "mock";
  const csv = benchmarkCsv(report);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("DEMO / GERÇEK DEĞİL"));
  assert.ok(csv.includes("Miramare Beach"));
  assert.ok(csv.includes("API erişimi eksik"));
  assert.ok(csv.includes("Superior Sea View"));
  assert.ok(!csv.includes("Referans"));
  assert.ok(!csv.includes("Fark (%)"));
  assert.ok(csv.includes(`'=HYPERLINK(""https://example.com"")`));
});

test("blank provider proxy inherits shared proxy; explicit stealth=false is respected", (t) => {
  const keys = [
    "OTA_PROXY_URL",
    "HOLIDAYCHECK_PROXY_URL",
    "HOLIDAYCHECK_USE_STEALTH",
  ];
  const original = keys.map((key) => process.env[key]);
  t.after(() =>
    keys.forEach((key, i) => {
      if (original[i] === undefined) delete process.env[key];
      else process.env[key] = original[i];
    }),
  );
  process.env.OTA_PROXY_URL = "http://localhost:9999";
  process.env.HOLIDAYCHECK_PROXY_URL = "";
  process.env.HOLIDAYCHECK_USE_STEALTH = "false";
  assert.equal(
    resolveProviderLiveConfig("holidaycheck").proxyUrl,
    "http://localhost:9999",
  );
  assert.equal(resolveProviderLiveConfig("holidaycheck").useStealth, false);
});
