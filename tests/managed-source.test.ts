import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectSerpApiHotelPrices,
  parseSerpApiHotelPrices,
} from "../src/lib/ota/live-serpapi";
import { reserveSerpApiRequest } from "../src/lib/ota/serpapi-budget";
import { GOOGLE_HOTEL_IDS } from "../src/lib/ota/google-hotel-config";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import { buildBenchmarkResult } from "../src/lib/benchmark/engine";
import { buildPriceSummary } from "../src/lib/benchmark/price-summary";
import { benchmarkCsv } from "../src/lib/benchmark/export";

const window = {
  id: "test",
  label: "Test",
  checkIn: "2026-10-23",
  checkOut: "2026-10-28",
  nights: 5,
};
const scope = {
  ...REPORT_SCOPES.find((item) => item.id === "beach-eu")!,
  windows: [window],
};
const providers = OTA_PROVIDERS.filter((item) =>
  ["booking", "expedia", "hotelbeds"].includes(item.key),
);
const now = Date.parse("2026-10-02T12:00:00Z");

// Synthetic contract fixtures, never captured or presented as actual OTA prices.
function fixture() {
  return {
    search_metadata: {
      status: "Success",
      created_at: new Date(now).toISOString(),
    },
    search_parameters: {
      engine: "google_hotels",
      check_in_date: window.checkIn,
      check_out_date: window.checkOut,
      currency: "EUR",
      gl: "de",
      adults: 2,
      children: 0,
      property_token: GOOGLE_HOTEL_IDS[scope.hotelKey],
    },
    name: scope.hotelName,
    type: "hotel",
    property_token: GOOGLE_HOTEL_IDS[scope.hotelKey],
    prices: [
      {
        source: "Booking.com",
        num_guests: 2,
        link: "https://www.google.com/travel/clk?test=1",
        total_rate: { lowest: "€1,200", extracted_lowest: 1200 },
      },
    ],
  };
}
const parse = (data: unknown) =>
  parseSerpApiHotelPrices(scope, window, providers, data, now);

test("managed source accepts selected, exact seller hotel totals with explicit provenance", () => {
  const data = fixture();
  data.prices.push({
    ...data.prices[0],
    total_rate: { lowest: "€1,300", extracted_lowest: 1300 },
  });
  const [rate] = parse(data);
  assert.equal(rate.price, 1200);
  assert.equal(rate.providerKey, "booking");
  assert.equal(rate.collectedVia, "serpapi");
  assert.equal(rate.currency, "EUR");
  assert.equal(rate.windowId, window.id);
  assert.equal(parseSerpApiHotelPrices(scope, window, [], data, now).length, 0);
  const withoutEcho = fixture();
  Reflect.deleteProperty(withoutEcho.search_parameters, "property_token");
  assert.equal(parse(withoutEcho).length, 1);
});

test("wrong hotel, dates, party, market, currency and stale data fail closed", () => {
  for (const patch of [
    { check_in_date: "2026-10-24" },
    { check_out_date: "2026-10-29" },
    { adults: 1 },
    { children: 1 },
    { gl: "tr" },
    { currency: "GBP" },
    { engine: "google" },
    { property_token: "other" },
  ]) {
    const data = fixture();
    Object.assign(data.search_parameters, patch);
    assert.throws(() => parse(data));
  }
  for (const patch of [
    { name: "Miramare Queen" },
    { property_token: "other" },
    { type: "vacation rental" },
    { error: "failure" },
  ])
    assert.throws(() => parse({ ...fixture(), ...patch }));
  for (const age of [16 * 60_000, -61_000]) {
    const data = fixture();
    data.search_metadata.created_at = new Date(now - age).toISOString();
    assert.throws(() => parse(data));
  }
});

test("unknown sellers, nightly prices, bad amounts and untrusted URLs are never rates", () => {
  for (const patch of [
    { source: "Booking.com special" },
    { source: "Hotelbeds" },
    { num_guests: 1 },
    { num_rooms: 2 },
    {
      total_rate: undefined,
      rate_per_night: { lowest: "€1,200", extracted_lowest: 1200 },
    },
    { total_rate: { lowest: "£1,200", extracted_lowest: 1200 } },
    { total_rate: { lowest: "€1,201", extracted_lowest: 1200 } },
    {
      total_rate: {
        lowest: "€1,200 per person + flight",
        extracted_lowest: 1200,
      },
    },
    { total_rate: { lowest: "€0", extracted_lowest: 0 } },
    { total_rate: { lowest: "€1,200", extracted_lowest: NaN } },
    { link: "http://www.booking.com/" },
    { link: "https://www.booking.com.evil.test/" },
    { link: "https://www.google.com/url?q=https://evil.test" },
    { link: "https://serpapi.com/search?api_key=secret" },
    { link: "https://www.booking.com/?api_key=secret" },
  ]) {
    const data = fixture();
    Object.assign(data.prices[0], patch);
    assert.deepEqual(parse(data), [], JSON.stringify(patch));
  }
});

test("one managed request uses exact dates, market and fresh results; secrets never enter report", async () => {
  let reservations = 0,
    requests = 0;
  const result = await collectSerpApiHotelPrices(scope, providers, {
    key: "test-secret",
    now: () => now,
    reserve: async () => {
      reservations++;
    },
    fetch: async (input, init) => {
      requests++;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://serpapi.com");
      assert.equal(url.searchParams.get("check_in_date"), window.checkIn);
      assert.equal(url.searchParams.get("check_out_date"), window.checkOut);
      assert.equal(
        url.searchParams.get("property_token"),
        GOOGLE_HOTEL_IDS[scope.hotelKey],
      );
      assert.equal(url.searchParams.get("no_cache"), "true");
      assert.equal(url.searchParams.get("api_key"), "test-secret");
      assert.equal(init?.redirect, "error");
      return Response.json(fixture());
    },
  });
  assert.equal(reservations, 1);
  assert.equal(requests, 1);
  assert.equal(result.hotelPrices.length, 1);
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});

test("missing key and exhausted quota never make network calls", async () => {
  let calls = 0;
  const deps = {
    key: "",
    now: () => now,
    reserve: async () => {
      calls++;
    },
    fetch: async () => {
      calls++;
      throw new Error("Unexpected fetch");
    },
  };
  assert.match(
    (await collectSerpApiHotelPrices(scope, providers, deps)).warnings.join(),
    /anahtarı eksik/,
  );
  assert.equal(calls, 0);
  const quota = await collectSerpApiHotelPrices(scope, providers, {
    ...deps,
    key: "key",
    reserve: async () => {
      throw new Error("quota");
    },
  });
  assert.equal(calls, 0);
  assert.equal(quota.hotelPrices.length, 0);
  assert.match(quota.warnings.join(), /sınırı/);
});

test("upstream errors and oversized responses do not leak keys or produce sold-out rates", async () => {
  for (const fetch of [
    async () => {
      throw new Error("https://serpapi.com?api_key=hidden-secret");
    },
    async () => new Response("hidden-secret", { status: 401 }),
    async () => new Response("hidden-secret", { status: 429 }),
    async () =>
      new Response("{}", { headers: { "content-length": "5000000" } }),
    async () => Response.json({ error: "hidden-secret" }),
  ]) {
    const result = await collectSerpApiHotelPrices(scope, providers, {
      key: "hidden-secret",
      now: () => now,
      reserve: async () => {},
      fetch,
    });
    assert.equal(result.hotelPrices.length, 0);
    assert.ok(result.warnings.length);
    assert.ok(!JSON.stringify(result).includes("hidden-secret"));
  }
});

test("persistent budget stops at 20 daily / 200 monthly and rolls over without deleting history", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "benchmark-budget-"));
  try {
    for (let day = 1; day <= 10; day++) {
      const date = new Date(
        `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`,
      );
      for (let n = 0; n < 20; n++) await reserveSerpApiRequest(dir, date);
      await assert.rejects(reserveSerpApiRequest(dir, date), /sınırı/);
    }
    await assert.rejects(
      reserveSerpApiRequest(dir, new Date("2026-10-11T12:00:00Z")),
      /sınırı/,
    );
    await reserveSerpApiRequest(dir, new Date("2026-11-01T12:00:00Z"));
    const usage = JSON.parse(
      await readFile(path.join(dir, "serpapi-usage.json"), "utf8"),
    );
    assert.equal(usage.monthCount, 1);
    assert.equal(usage.dayCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt and locked usage counters fail closed, rather than resetting quota", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "benchmark-budget-"));
  try {
    await writeFile(path.join(dir, "serpapi-usage.json"), "invalid");
    await assert.rejects(reserveSerpApiRequest(dir), /doğrulanamadı/);
    await mkdir(path.join(dir, "serpapi-budget.lock"));
    await assert.rejects(reserveSerpApiRequest(dir), /meşgul/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summary and CSV expose meta prices without inventing matched rooms or hiding missing OTAs", () => {
  const report = {
    ...buildBenchmarkResult({
      mode: "live",
      scopes: [scope],
      providers,
      quotes: [],
      warnings: [],
    }),
    hotelPrices: parse(fixture()),
  };
  const summary = buildPriceSummary(report);
  assert.equal(summary.length, providers.length);
  assert.equal(
    summary.find((item) => item.providerKey === "booking")?.price,
    1200,
  );
  assert.equal(
    summary.find((item) => item.providerKey === "booking")?.source,
    "Google Hotels / SerpAPI",
  );
  assert.equal(
    summary.find((item) => item.providerKey === "expedia")?.price,
    null,
  );
  assert.equal(report.summary.availableRateCount, 0);
  assert.ok(
    report.scopes[0].windows[0].rows.every((row) =>
      row.entries.every((entry) => entry.scrapedPrice === null),
    ),
  );
  const csv = benchmarkCsv(report);
  assert.match(csv, /Google Hotels \/ SerpAPI/);
  assert.match(csv, /OTEL BAŞLANGIÇ TOPLAMI/);
  const metaLine = csv
    .split("\n")
    .find((line) => line.includes("Google Hotels / SerpAPI"))!;
  assert.equal(metaLine.split(";").length, 21);
});
