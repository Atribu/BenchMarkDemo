import test from "node:test";
import assert from "node:assert/strict";

import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import type {
  CollectedOffer,
  ProviderCollectionResult,
  ProviderQuote,
} from "../src/lib/benchmark/types";
import { normalizeProviderCollectionResult } from "../src/lib/ota/collection-contract";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";

const provider = OTA_PROVIDERS.find((item) => item.key === "booking")!;
const originalScope = REPORT_SCOPES.find((item) => item.id === "beach-eu")!;
const scope = { ...originalScope, windows: [originalScope.windows[0]] };
const window = scope.windows[0];

function validQuote(overrides: Partial<ProviderQuote> = {}): ProviderQuote {
  return {
    providerKey: provider.key,
    scopeKey: scope.id,
    roomId: scope.rooms[0].id,
    windowId: window.id,
    price: 1000,
    currency: scope.currency,
    status: "available",
    dataMode: "live",
    sourceHint: "https://example.test",
    offerId: "offer-1",
    ...overrides,
  };
}

function validOffer(overrides: Partial<CollectedOffer> = {}): CollectedOffer {
  return {
    id: "offer-1",
    providerKey: provider.key,
    scopeKey: scope.id,
    windowId: window.id,
    checkIn: window.checkIn,
    checkOut: window.checkOut,
    nights: window.nights,
    rooms: 1,
    adults: 2,
    price: 1000,
    currency: scope.currency,
    roomName: scope.rooms[0].name,
    roomFeatures: {
      category: "standard",
      view: "land",
      balcony: "unknown",
    },
    terms: {
      board: "All Inclusive",
      cancellation: "unknown",
      taxes: "unknown",
      availability: "available",
    },
    sourceHint: "https://example.test",
    observedAt: "2027-05-01T10:00:00.000Z",
    matchedRoomId: scope.rooms[0].id,
    matchReason: "Exact alias",
    ...overrides,
  };
}

function normalize(result: ProviderCollectionResult) {
  return normalizeProviderCollectionResult({
    provider,
    scope,
    result,
    executed: true,
    startedAt: "2027-05-01T10:00:00.000Z",
    completedAt: "2027-05-01T10:00:01.000Z",
    durationMs: 1000,
  });
}

test("collection contract produces the same diagnostics for every collector result", () => {
  const result = normalize({
    quotes: [validQuote()],
    offers: [validOffer()],
    warnings: [],
  });

  assert.equal(result.attempts?.length, 1);
  assert.equal(result.diagnostics?.schemaVersion, 1);
  assert.equal(result.diagnostics?.quoteCount, 1);
  assert.equal(result.diagnostics?.rawOfferCount, 1);
  assert.equal(result.diagnostics?.acceptedOfferCount, 1);
  assert.equal(result.diagnostics?.quoteStatusCounts.available, 1);
  assert.equal(result.diagnostics?.attemptStatusCounts.completed, 1);
  assert.equal(result.diagnostics?.validationEvidenceCounts.derived, 9);
  assert.deepEqual(result.diagnostics?.contractIssues, []);
});

test("collection contract rejects quotes, offers and telemetry owned by another source", () => {
  const result = normalize({
    quotes: [
      validQuote(),
      validQuote({ providerKey: "expedia", offerId: "foreign" }),
    ],
    offers: [validOffer({ scopeKey: "queen-eu" })],
    attempts: [
      {
        id: "foreign-attempt",
        providerKey: "expedia",
        scopeKey: scope.id,
        hotelKey: scope.hotelKey,
        windowId: window.id,
        status: "completed",
        startedAt: "2027-05-01T10:00:00.000Z",
        completedAt: "2027-05-01T10:00:01.000Z",
        rawOfferCount: 1,
        acceptedOfferCount: 1,
      },
    ],
    warnings: [],
  });

  assert.equal(result.quotes.length, 1);
  assert.equal(result.offers?.length, 0);
  assert.equal(result.attempts?.length, 1);
  assert.deepEqual(result.diagnostics?.contractIssues, [
    "Geçersiz quote sahipliği elendi.",
    "Geçersiz teklif sahipliği elendi.",
    "Geçersiz sorgu telemetrisi elendi.",
  ]);
  assert.equal(result.warnings.length, 3);
});

test("collector evidence overrides only its stage and keeps the common funnel complete", () => {
  const result = normalize({
    quotes: [validQuote()],
    warnings: [],
    attempts: [
      {
        id: "collector-attempt",
        providerKey: provider.key,
        scopeKey: scope.id,
        hotelKey: scope.hotelKey,
        windowId: window.id,
        status: "completed",
        startedAt: "2027-05-01T10:00:00.000Z",
        completedAt: "2027-05-01T10:00:00.500Z",
        durationMs: 500,
        rawOfferCount: 1,
        acceptedOfferCount: 1,
        validationChecks: [
          {
            stage: "hotel_identity",
            state: "passed",
            evidence: "collector",
            detail: "Exact property id",
          },
        ],
      },
    ],
  });

  assert.equal(result.attempts?.[0].durationMs, 500);
  assert.equal(result.attempts?.[0].validationChecks?.length, 9);
  assert.equal(result.diagnostics?.validationEvidenceCounts.collector, 1);
  assert.equal(result.diagnostics?.validationEvidenceCounts.derived, 8);
});
