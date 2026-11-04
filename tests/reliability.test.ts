import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHotelReliabilitySummaries,
  summarizeProviderReliability,
} from "../src/lib/benchmark/reliability";
import type {
  BenchmarkCell,
  BenchmarkScopeResult,
  CollectionAttempt,
} from "../src/lib/benchmark/types";

function cell(
  overrides: Partial<BenchmarkCell> = {},
): BenchmarkCell {
  return {
    providerKey: "booking",
    providerName: "Booking.com",
    providerShortName: "Booking",
    scrapedPrice: null,
    referencePrice: null,
    differencePct: null,
    status: "manual-review",
    tone: "muted",
    dataMode: "live",
    sourceHint: "https://example.test",
    ...overrides,
  };
}

test("provider reliability separates resolved queries, review items and technical failures", () => {
  const attempt = (
    status: CollectionAttempt["status"],
    index: number,
  ): CollectionAttempt => ({
    id: `attempt-${index}`,
    providerKey: "booking",
    scopeKey: "beach-eu",
    hotelKey: "miramare-beach",
    windowId: `window-${index}`,
    status,
    startedAt: "2027-05-01T10:00:00.000Z",
    completedAt: "2027-05-01T10:00:01.000Z",
    rawOfferCount: 0,
    acceptedOfferCount: 0,
  });
  const summary = summarizeProviderReliability(
    { key: "booking", name: "Booking.com" },
    [
      cell({ status: "available", scrapedPrice: 1000 }),
      cell({
        status: "available",
        scrapedPrice: 1010,
        captureMethod: "manual-browser",
      }),
      cell({ status: "sold_out", errorCode: "no_inventory" }),
      cell({ errorCode: "room_mapping_failed" }),
      cell({ errorCode: "timeout" }),
    ],
    [
      attempt("completed", 1),
      attempt("partial", 2),
      attempt("failed", 3),
      attempt("not_run", 4),
    ],
  );

  assert.deepEqual(summary, {
    providerKey: "booking",
    providerName: "Booking.com",
    attemptedCount: 5,
    resolvedCount: 3,
    verifiedPriceCount: 1,
    manualPriceCount: 1,
    noInventoryCount: 1,
    reviewCount: 1,
    technicalFailureCount: 1,
    reliabilityPct: 60,
    level: "partial",
    errorCounts: {
      room_mapping_failed: 1,
      timeout: 1,
    },
    queryAttemptCount: 3,
    queryResponseCount: 2,
    queryCompletedCount: 1,
    queryPartialCount: 1,
    queryFailureCount: 1,
    queryNotRunCount: 1,
    queryReliabilityPct: 67,
    queryLevel: "partial",
  });
});

test("verified no-inventory results count as resolved without inflating price coverage", () => {
  const summary = summarizeProviderReliability(
    { key: "booking", name: "Booking.com" },
    [
      cell({ status: "sold_out", errorCode: "no_inventory" }),
      cell({ status: "sold_out", errorCode: "no_inventory" }),
    ],
  );

  assert.equal(summary.reliabilityPct, 100);
  assert.equal(summary.level, "strong");
  assert.equal(summary.verifiedPriceCount, 0);
  assert.equal(summary.noInventoryCount, 2);
});

test("a provider without attempted cells has weak zero reliability", () => {
  const summary = summarizeProviderReliability(
    { key: "booking", name: "Booking.com" },
    [],
  );

  assert.equal(summary.reliabilityPct, 0);
  assert.equal(summary.level, "weak");
});

test("hotel reliability combines the same hotel's market scopes without mixing hotels", () => {
  const scope = (
    id: BenchmarkScopeResult["id"],
    hotelKey: BenchmarkScopeResult["hotelKey"],
    hotelName: string,
    entries: BenchmarkCell[],
  ): BenchmarkScopeResult => ({
    id,
    label: id,
    hotelKey,
    hotelName,
    marketLabel: "Test",
    currency: "EUR",
    providers: [],
    windows: [
      {
        id: "window",
        label: "window",
        checkIn: "2027-05-10",
        checkOut: "2027-05-15",
        nights: 5,
        rows: [
          {
            roomId: "room",
            roomName: "Room",
            occupancyLabel: "2 adults",
            referencePrice: null,
            entries,
          },
        ],
      },
    ],
    stats: {
      parityRiskCount: 0,
      premiumCount: 0,
      missingCount: 0,
      averageSpreadPct: null,
    },
  });

  const summaries = buildHotelReliabilitySummaries([
    scope("beach-eu", "miramare-beach", "Miramare Beach", [
      cell({ status: "available", scrapedPrice: 1000 }),
    ]),
    scope("beach-uk", "miramare-beach", "Miramare Beach", [
      cell({ errorCode: "access_blocked" }),
    ]),
    scope("queen-eu", "miramare-queen", "Miramare Queen", [
      cell({ status: "sold_out", errorCode: "no_inventory" }),
    ]),
  ]);

  assert.equal(summaries.length, 2);
  assert.deepEqual(
    summaries.map((summary) => ({
      hotelKey: summary.hotelKey,
      attemptedCount: summary.attemptedCount,
      resolvedCount: summary.resolvedCount,
      technicalFailureCount: summary.technicalFailureCount,
      reliabilityPct: summary.reliabilityPct,
    })),
    [
      {
        hotelKey: "miramare-beach",
        attemptedCount: 2,
        resolvedCount: 1,
        technicalFailureCount: 1,
        reliabilityPct: 50,
      },
      {
        hotelKey: "miramare-queen",
        attemptedCount: 1,
        resolvedCount: 1,
        technicalFailureCount: 0,
        reliabilityPct: 100,
      },
    ],
  );
});
