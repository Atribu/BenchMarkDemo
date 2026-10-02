import test from "node:test";
import assert from "node:assert/strict";
import records from "../data/manual-observations.json";
import {
  mergeManualObservations,
  MANUAL_FRESHNESS_MS,
} from "../src/lib/benchmark/manual-observations";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import { buildBenchmarkResult } from "../src/lib/benchmark/engine";
import { benchmarkCsv } from "../src/lib/benchmark/export";
import { runBenchmarkJob } from "../src/lib/ota/run-benchmark";
import { buildManualReviewQuotes } from "../src/lib/ota/live-helpers";
import { formatDateTime } from "../src/lib/utils/format";
import type { ProviderQuote } from "../src/lib/benchmark/types";

const window = {
  id: "verified-window",
  label: "9-14 October",
  checkIn: "2026-10-09",
  checkOut: "2026-10-14",
  nights: 5,
};
const scopes = REPORT_SCOPES.map((scope) => ({
  ...scope,
  windows: [window],
  rooms: scope.rooms.map((room) => ({
    ...room,
    referenceRates: { [window.id]: 2000 },
  })),
}));
const providers = OTA_PROVIDERS.filter((provider) =>
  ["expedia", "onthebeach"].includes(provider.key),
);
const observed = Date.parse(records[0].observedAt);
const now = observed + 60_000;
const failed: ProviderQuote = {
  providerKey: "expedia",
  scopeKey: "beach-eu",
  roomId: "superior-land",
  windowId: window.id,
  currency: "EUR",
  price: null,
  status: "manual-review",
  dataMode: "live",
  sourceHint: "",
  reason: "Access unavailable",
};

test("four verified observations supplement failed collectors with provenance", () => {
  const result = mergeManualObservations(
    [failed],
    scopes,
    providers,
    records,
    now,
  );
  assert.equal(result.quotes.length, 4);
  assert.deepEqual(
    result.quotes.map((quote) => quote.price),
    [1823, 1944, 1419.36, 1500.02],
  );
  assert.ok(
    result.quotes.every(
      (quote) =>
        quote.status === "available" &&
        quote.captureMethod === "manual-browser" &&
        quote.observedAt === records[0].observedAt &&
        quote.offerConditions &&
        quote.sourceHint.startsWith("https:"),
    ),
  );
  assert.equal(result.quotes[2].currency, "GBP");
  assert.match(result.warnings[0], /4 hücre/);
});

test("manual observations cannot leak to other dates, rooms, hotels or party configurations", () => {
  const invalid = [
    null,
    {},
    { ...records[0], hotelKey: "miramare-queen" },
    { ...records[0], scopeKey: "queen-eu" },
    { ...records[0], checkIn: "2026-10-10" },
    { ...records[0], checkOut: "2026-10-15" },
    { ...records[0], roomId: "standard-land" },
    { ...records[0], roomName: "Superior Sea View" },
    { ...records[0], roomName: "Superior Room" },
    { ...records[0], currency: "GBP" },
    { ...records[0], adults: 1 },
    { ...records[0], children: 1 },
    { ...records[0], rooms: 2 },
    { ...records[0], hotelOnly: false },
    { ...records[0], priceBasis: "per-person" },
  ];
  assert.equal(
    mergeManualObservations([], scopes, providers, invalid, now).quotes.length,
    0,
  );
  const wrongNights = scopes.map((scope) => ({
    ...scope,
    windows: [{ ...window, nights: 1 }],
  }));
  assert.equal(
    mergeManualObservations([], wrongNights, providers, records, now).quotes
      .length,
    0,
  );
});

test("manual observations require selected compatible provider and scope", () => {
  assert.equal(
    mergeManualObservations([], scopes, [], records, now).quotes.length,
    0,
  );
  assert.equal(
    mergeManualObservations([], [], providers, records, now).quotes.length,
    0,
  );
  const expedia = providers.filter((provider) => provider.key === "expedia");
  assert.equal(
    mergeManualObservations([], scopes, expedia, records, now).quotes.length,
    2,
  );
  assert.equal(
    mergeManualObservations(
      [],
      scopes,
      expedia.map((provider) => ({ ...provider, supportedScopes: [] })),
      records,
      now,
    ).quotes.length,
    0,
  );
});

test("manual observations reject invalid price, timestamp and untrusted source URL", () => {
  const invalid = [
    ...[0, -1, NaN, Infinity, "1823", null].map((price) => ({
      ...records[0],
      price,
    })),
    ...["bad-date", new Date(now + 1).toISOString()].map((observedAt) => ({
      ...records[0],
      observedAt,
    })),
    ...[
      "bad-url",
      "http://www.expedia.de/",
      "https://expedia.de.evil.example/",
      "https://evil.example/",
      "https://user:secret@expedia.de/",
      "javascript:alert(1)",
    ].map((sourceUrl) => ({ ...records[0], sourceUrl })),
  ];
  assert.equal(
    mergeManualObservations([], scopes, providers, invalid, now).quotes.length,
    0,
  );
});

test("most recent manual observation wins regardless of record ordering", () => {
  const newer = {
    ...records[0],
    price: 1900,
    observedAt: new Date(now).toISOString(),
  };
  for (const ordered of [
    [newer, records[0]],
    [records[0], newer],
  ]) {
    assert.equal(
      mergeManualObservations([], scopes, providers, ordered, now).quotes[0]
        .price,
      1900,
    );
  }
});

test("current automated availability and sold-out results take precedence", () => {
  for (const quote of [
    { ...failed, status: "available" as const, price: 1800 },
    { ...failed, status: "sold_out" as const },
  ]) {
    const result = mergeManualObservations(
      [quote],
      scopes,
      providers,
      [records[0]],
      now,
    );
    assert.deepEqual(result.quotes, [quote]);
    assert.deepEqual(result.warnings, []);
  }
  for (const quote of [
    { ...failed, status: "available" as const, price: 0 },
    {
      ...failed,
      status: "available" as const,
      price: 1800,
      currency: "GBP" as const,
    },
  ])
    assert.equal(
      mergeManualObservations([quote], scopes, providers, [records[0]], now)
        .quotes[0].captureMethod,
      "manual-browser",
    );
});

test("24-hour-old observations remain visible but are excluded from comparisons", () => {
  const fresh = mergeManualObservations(
    [],
    scopes,
    providers,
    records,
    observed + MANUAL_FRESHNESS_MS - 1,
  );
  assert.ok(fresh.quotes.every((quote) => quote.status === "available"));
  const stale = mergeManualObservations(
    [],
    scopes,
    providers,
    records,
    observed + MANUAL_FRESHNESS_MS,
  );
  assert.ok(
    stale.quotes.every(
      (quote) => quote.status === "manual-review" && quote.price !== null,
    ),
  );
  const report = buildBenchmarkResult({
    mode: "live",
    scopes,
    providers,
    ...stale,
  });
  assert.equal(report.summary.availableRateCount, 0);
  assert.equal(report.summary.parityRiskCount, 0);
  assert.deepEqual(report.summary.cheapestProviderWins, []);
  assert.ok(
    report.scopes
      .flatMap((scope) =>
        scope.windows.flatMap((window) =>
          window.rows.flatMap((row) => row.entries),
        ),
      )
      .every((entry) => entry.differencePct === null),
  );
});

test("report and CSV retain manual provenance and original conditions", () => {
  const result = mergeManualObservations([], scopes, providers, records, now);
  const report = buildBenchmarkResult({
    mode: "live",
    scopes,
    providers,
    ...result,
  });
  assert.equal(report.summary.availableRateCount, 4);
  const entry = report.scopes[0].windows[0].rows[0].entries[0];
  assert.equal(entry.captureMethod, "manual-browser");
  assert.equal(entry.observedAt, records[0].observedAt);
  assert.equal(entry.offerConditions, records[0].conditions);
  const csv = benchmarkCsv(report);
  assert.equal(csv.split('"ELLE KONTROL / ANLIK DEĞİL"').length - 1, 4);
  assert.ok(csv.includes(records[0].observedAt));
  assert.ok(csv.includes(records[0].conditions));
  assert.ok(csv.includes(records[0].sourceUrl));
});

test("demo reports never use saved real observations", async () => {
  const report = await runBenchmarkJob({
    mode: "mock",
    scopeKeys: ["beach-eu", "beach-uk"],
    providerKeys: ["expedia", "onthebeach"],
    customWindow: { checkIn: window.checkIn, checkOut: window.checkOut },
  });
  const entries = report.scopes.flatMap((scope) =>
    scope.windows.flatMap((window) =>
      window.rows.flatMap((row) => row.entries),
    ),
  );
  assert.ok(entries.length > 0);
  assert.ok(
    entries.every(
      (entry) =>
        entry.dataMode === "mock" &&
        entry.captureMethod !== "manual-browser" &&
        !entry.observedAt,
    ),
  );
});

test("a failed live query never fills prices from saved browser observations", async () => {
  const saved = records.find((record) => record.providerKey === "onthebeach")!;
  let calls = 0;
  const report = await runBenchmarkJob(
    {
      mode: "live",
      scopeKeys: ["beach-uk"],
      providerKeys: ["onthebeach"],
      customWindow: { checkIn: saved.checkIn, checkOut: saved.checkOut },
    },
    async (provider, scope) => {
      calls++;
      return buildManualReviewQuotes(
        provider,
        scope,
        saved.sourceUrl,
        "Current query blocked",
        "Current query blocked",
      );
    },
  );
  assert.equal(calls, 1);
  const entries = report.scopes.flatMap((scope) =>
    scope.windows.flatMap((window) =>
      window.rows.flatMap((row) => row.entries),
    ),
  );
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.scrapedPrice === null));
  assert.ok(entries.every((entry) => entry.captureMethod !== "manual-browser"));
  assert.ok(entries.every((entry) => entry.reason === "Current query blocked"));
  assert.equal(report.summary.availableRateCount, 0);
  assert.equal(report.summary.coveragePct, 0);
  assert.equal(report.browserOffers, undefined);
});

test("displayed verification time always uses Istanbul timezone", () => {
  assert.match(formatDateTime(records[0].observedAt), /03:11/);
});
