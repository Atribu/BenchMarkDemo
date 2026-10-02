import test from "node:test";
import assert from "node:assert/strict";
import {
  collectHolidayCheckSecondary,
  holidayCheckSeller,
} from "../src/lib/ota/holidaycheck-secondary";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import type { CollectedOffer, ProviderQuote } from "../src/lib/benchmark/types";
import { buildBenchmarkResult } from "../src/lib/benchmark/engine";
import { benchmarkCsv } from "../src/lib/benchmark/export";
import { buildHolidayCheckHotelOnlyUrl } from "../src/lib/ota/live-holidaycheck";
import { HOLIDAYCHECK_HOTEL_CONFIG } from "../src/lib/ota/live-config";
import { buildPriceSummary } from "../src/lib/benchmark/price-summary";

const window = {
  id: "test",
  label: "23-28 Oct",
  checkIn: "2026-10-23",
  checkOut: "2026-10-28",
  nights: 5,
};
const scope = {
  ...REPORT_SCOPES.find((scope) => scope.id === "beach-eu")!,
  windows: [window],
};
const uk = {
  ...REPORT_SCOPES.find((scope) => scope.id === "beach-uk")!,
  windows: [window],
};
const queen = {
  ...REPORT_SCOPES.find((scope) => scope.id === "queen-eu")!,
  windows: [window],
};
const hc = OTA_PROVIDERS.find((provider) => provider.key === "holidaycheck")!;
const providers = OTA_PROVIDERS.filter((provider) =>
  ["booking", "expedia"].includes(provider.key),
);
function quote(patch: Partial<ProviderQuote> = {}): ProviderQuote {
  return {
    providerKey: "booking",
    scopeKey: scope.id,
    roomId: scope.rooms[0].id,
    windowId: window.id,
    price: null,
    currency: "EUR",
    status: "manual-review",
    dataMode: "live",
    sourceHint: "https://www.booking.com/",
    ...patch,
  };
}
function offer(patch: Partial<CollectedOffer> = {}): CollectedOffer {
  return {
    id: "hc:1",
    providerKey: "holidaycheck",
    scopeKey: scope.id,
    windowId: window.id,
    checkIn: window.checkIn,
    checkOut: window.checkOut,
    nights: 5,
    rooms: 1,
    adults: 2,
    price: 1500,
    currency: "EUR",
    roomName: "Superior Land View",
    roomFeatures: { category: "superior", view: "land", balcony: "unknown" },
    terms: {
      board: "All Inclusive",
      cancellation: "Belirtilmedi",
      taxes: "Belirtilmedi",
      operator: "Booking.com",
      availability: "Müsaitlik kontrolü gerekiyor",
    },
    sourceHint: buildHolidayCheckHotelOnlyUrl(
      HOLIDAYCHECK_HOTEL_CONFIG[scope.hotelKey]!.pageUrl,
      window.checkIn,
      window.checkOut,
    )!,
    observedAt: "2026-10-02T12:00:00Z",
    matchReason: "Balkon bilinmiyor",
    ...patch,
  };
}
const args = {
  scopes: [scope],
  catalog: REPORT_SCOPES,
  providers,
  quotes: [quote()],
  holidayCheckProvider: hc,
};

test("TUI source failure reuses exact TUI-labelled HolidayCheck totals without claiming direct success", async () => {
  const tuiProviders = OTA_PROVIDERS.filter(
    (provider) => provider.key === "tui",
  );
  const tuiQuote = quote({ providerKey: "tui" });
  const tuiOffer = offer({
    terms: { ...offer().terms, operator: "TUI" },
    price: 1456,
  });
  const { secondaryOffers } = await collectHolidayCheckSecondary({
    ...args,
    providers: tuiProviders,
    quotes: [tuiQuote],
    existing: { "beach-eu": { quotes: [], offers: [tuiOffer], warnings: [] } },
    collect: async () => {
      throw new Error("Must reuse existing result");
    },
  });
  assert.equal(secondaryOffers.length, 1);
  assert.equal(secondaryOffers[0].advertisedProviderKey, "tui");
  const report = {
    ...buildBenchmarkResult({
      mode: "live",
      scopes: [scope, uk],
      providers: tuiProviders,
      quotes: [tuiQuote],
      warnings: [],
    }),
    secondaryOffers,
  };
  const cards = buildPriceSummary(report);
  assert.equal(cards[0].source, "HolidayCheck üzerinden");
  assert.equal(cards[0].price, 1456);
  assert.equal(cards[0].currency, "EUR");
  assert.equal(report.summary.availableRateCount, 0);
});

test("a EUR secondary offer remains EUR in both market summaries with distinct card identities", () => {
  const report = {
    ...buildBenchmarkResult({
      mode: "live",
      scopes: [scope, uk],
      providers: providers.filter((p) => p.key === "booking"),
      quotes: [],
      warnings: [],
    }),
    secondaryOffers: [
      {
        ...offer(),
        providerKey: "holidaycheck" as const,
        advertisedProviderKey: "booking" as const,
        source: "holidaycheck" as const,
        hotelKey: scope.hotelKey,
        hotelName: scope.hotelName,
      },
    ],
  };
  const cards = buildPriceSummary(report);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].currency, "EUR");
  assert.equal(cards[1].currency, "EUR");
  assert.notEqual(cards[0].scopeKey, cards[1].scopeKey);
});

test("secondary seller identification is exact, not fuzzy or substring based", () => {
  assert.equal(holidayCheckSeller(" Booking.com "), "booking");
  assert.equal(holidayCheckSeller("EXPEDIA"), "expedia");
  assert.equal(holidayCheckSeller(" TUI "), "tui");
  for (const name of [
    undefined,
    "Booking",
    "Booking.com special",
    "Expedia Partner",
    "Not Expedia",
    "TUI special",
    "HolidayCheck Reisen",
  ])
    assert.equal(holidayCheckSeller(name), null);
});

test("secondary lookup keeps EUR and requested dates for UK searches without changing direct quotes", async () => {
  const quotes = [quote({ scopeKey: uk.id, currency: "GBP" })];
  const result = await collectHolidayCheckSecondary({
    ...args,
    scopes: [uk],
    quotes,
    collect: async (provider, sourceScope) => {
      assert.equal(provider.key, "holidaycheck");
      assert.equal(sourceScope.currency, "EUR");
      assert.equal(sourceScope.id, scope.id);
      assert.deepEqual(sourceScope.windows, [window]);
      return { quotes: [], warnings: [], offers: [offer()] };
    },
  });
  assert.equal(result.secondaryOffers.length, 1);
  assert.equal(result.secondaryOffers[0].advertisedProviderKey, "booking");
  assert.equal(result.secondaryOffers[0].providerKey, "holidaycheck");
  assert.equal(result.secondaryOffers[0].currency, "EUR");
  assert.equal(result.secondaryOffers[0].source, "holidaycheck");
  assert.equal(quotes[0].price, null);
  assert.equal(quotes[0].status, "manual-review");
});

test("a selected HolidayCheck result is reused once across providers and requested markets", async () => {
  const first = offer();
  const expedia = offer({
    id: "hc:2",
    terms: { ...first.terms, operator: "Expedia" },
  });
  const result = await collectHolidayCheckSecondary({
    ...args,
    scopes: [scope, uk],
    quotes: [
      quote(),
      quote({ providerKey: "expedia" }),
      quote({ scopeKey: uk.id, currency: "GBP" }),
    ],
    existing: {
      "beach-eu": { quotes: [], warnings: [], offers: [first, first, expedia] },
    },
    collect: async () => {
      throw new Error("Duplicate network query");
    },
  });
  assert.equal(result.secondaryOffers.length, 2);
  assert.ok(!result.warnings.some((warning) => warning.includes("Duplicate")));
});

test("missing provider selection, demo quotes, successful and sold-out direct results do not trigger fallback", async () => {
  for (const quotes of [
    [],
    [quote({ dataMode: "mock" })],
    [quote({ status: "available", price: 1500 })],
    [quote({ status: "sold_out" })],
    [quote({ providerKey: "loveholidays" })],
  ]) {
    let calls = 0;
    const result = await collectHolidayCheckSecondary({
      ...args,
      quotes,
      collect: async () => {
        calls++;
        return { quotes: [], warnings: [] };
      },
    });
    assert.equal(calls, 0);
    assert.deepEqual(result.secondaryOffers, []);
  }
  const unselected = await collectHolidayCheckSecondary({
    ...args,
    providers: [],
    collect: async () => {
      throw new Error("Must not fetch");
    },
  });
  assert.deepEqual(unselected.warnings, []);
});

test("secondary data cannot leak between sellers, hotels, dates, currencies, guests or source URLs", async () => {
  const invalid = [
    offer({ terms: { ...offer().terms, operator: "Expedia" } }),
    offer({ scopeKey: "queen-eu" }),
    offer({ windowId: "other" }),
    offer({ checkIn: "2026-10-24" }),
    offer({ checkOut: "2026-10-29" }),
    offer({ nights: 6 }),
    offer({ adults: 3 }),
    offer({ rooms: 2 }),
    offer({ currency: "GBP" }),
    offer({ price: NaN }),
    offer({ price: 0 }),
    offer({ price: Infinity }),
    offer({ sourceHint: "https://example.com/" }),
    offer({ providerKey: "expedia" }),
    offer({ observedAt: "unknown" }),
  ];
  const result = await collectHolidayCheckSecondary({
    ...args,
    existing: { "beach-eu": { quotes: [], warnings: [], offers: invalid } },
  });
  assert.deepEqual(result.secondaryOffers, []);
});

test("a failed selected source is not blindly retried and failure stays separate from sold out", async () => {
  const result = await collectHolidayCheckSecondary({
    ...args,
    existing: {
      "beach-eu": {
        quotes: [quote({ providerKey: "holidaycheck" })],
        warnings: ["challenge"],
      },
    },
    collect: async () => {
      throw new Error("Repeated");
    },
  });
  assert.equal(result.secondaryOffers.length, 0);
  assert.ok(!result.warnings.some((warning) => warning.includes("Repeated")));
});

test("one source hotel failing does not discard the other hotel's secondary prices", async () => {
  const result = await collectHolidayCheckSecondary({
    ...args,
    scopes: [scope, queen],
    quotes: [quote(), quote({ scopeKey: queen.id })],
    collect: async (_provider, sourceScope) => {
      if (sourceScope.id === queen.id) throw new Error("Connection failed");
      return { quotes: [], offers: [offer()], warnings: [] };
    },
  });
  assert.equal(result.secondaryOffers.length, 1);
  assert.ok(
    result.warnings.some((warning) => warning.includes("Connection failed")),
  );
});

test("secondary prices are exported with their real source and do not populate direct cells or coverage", async () => {
  const { secondaryOffers } = await collectHolidayCheckSecondary({
    ...args,
    existing: { "beach-eu": { quotes: [], offers: [offer()], warnings: [] } },
  });
  const report = {
    ...buildBenchmarkResult({
      mode: "live",
      scopes: [scope],
      providers,
      quotes: args.quotes,
      warnings: [],
    }),
    secondaryOffers,
  };
  assert.equal(report.summary.availableRateCount, 0);
  assert.equal(report.summary.coveragePct, 0);
  assert.deepEqual(report.summary.cheapestProviderWins, []);
  assert.ok(
    report.scopes[0].windows[0].rows.every((row) =>
      row.entries.every((entry) => entry.scrapedPrice === null),
    ),
  );
  const csv = benchmarkCsv(report);
  assert.match(csv, /Booking.com \(HolidayCheck üzerinden\)/);
  assert.match(csv, /DOĞRUDAN OTA DOĞRULAMASI DEĞİL/);
  assert.match(csv, /"EUR";"1500";"EK KAYNAK"/);
});
