import test from "node:test";
import assert from "node:assert/strict";

import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import type {
  ProviderCollectionResult,
  ProviderQuote,
} from "../src/lib/benchmark/types";
import { buildCollectionAttempts } from "../src/lib/ota/collection-attempts";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import { buildValidationFunnel } from "../src/lib/benchmark/validation-funnel";

const provider = OTA_PROVIDERS.find((item) => item.key === "booking")!;
const originalScope = REPORT_SCOPES.find((item) => item.id === "beach-eu")!;
const scope = { ...originalScope, windows: [originalScope.windows[0]] };
const window = scope.windows[0];

function quote(
  roomId: string,
  overrides: Partial<ProviderQuote> = {},
): ProviderQuote {
  return {
    providerKey: provider.key,
    scopeKey: scope.id,
    roomId,
    windowId: window.id,
    price: null,
    currency: scope.currency,
    status: "manual-review",
    dataMode: "live",
    sourceHint: "https://example.test",
    ...overrides,
  };
}

function attempts(result: ProviderCollectionResult, executed = true) {
  return buildCollectionAttempts({
    provider,
    scope,
    result,
    executed,
    startedAt: "2027-05-01T10:00:00.000Z",
    completedAt: "2027-05-01T10:00:01.000Z",
    durationMs: 1000,
  });
}

test("one failed channel-window run remains one attempt regardless of room count", () => {
  const result = attempts({
    quotes: scope.rooms.map((room) =>
      quote(room.id, {
        errorCode: "timeout",
        reason: "Request timed out",
      }),
    ),
    warnings: [],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].status, "failed");
  assert.equal(result[0].errorCode, "timeout");
  assert.equal(result[0].acceptedOfferCount, 0);
  assert.equal(
    result[0].validationChecks?.find(
      (check) => check.stage === "source_access",
    )?.state,
    "failed",
  );
});

test("a successful channel-window run records accepted room results once", () => {
  const result = attempts({
    quotes: scope.rooms.map((room, index) =>
      quote(room.id, {
        status: "available",
        price: 1000 + index,
        offerId: `offer-${index}`,
      }),
    ),
    warnings: [],
  });

  assert.equal(result[0].status, "completed");
  assert.equal(result[0].acceptedOfferCount, scope.rooms.length);
  assert.equal(result[0].durationMs, 1000);
  assert.equal(
    result[0].validationChecks?.find(
      (check) => check.stage === "room_mapping",
    )?.state,
    "passed",
  );
});

test("room mapping candidates are partial while unsupported combinations are not run", () => {
  const partial = attempts({
    quotes: scope.rooms.map((room) =>
      quote(room.id, { errorCode: "room_mapping_failed" }),
    ),
    warnings: [],
    offers: [
      {
        id: "raw-offer",
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
        roomName: "Unknown Room",
        roomFeatures: {
          category: "unknown",
          view: "unknown",
          balcony: "unknown",
        },
        terms: {
          board: "unknown",
          cancellation: "unknown",
          taxes: "unknown",
          availability: "available",
        },
        sourceHint: "https://example.test",
        observedAt: "2027-05-01T10:00:00.000Z",
        matchReason: "Room mapping failed",
      },
    ],
  });
  const notRun = attempts(
    {
      quotes: scope.rooms.map((room) =>
        quote(room.id, { errorCode: "hotel_mapping_missing" }),
      ),
      warnings: [],
    },
    false,
  );

  assert.equal(partial[0].status, "partial");
  assert.equal(partial[0].rawOfferCount, 1);
  assert.equal(notRun[0].status, "not_run");
});

test("verified empty inventory is visible without failing later funnel stages", () => {
  const result = attempts({
    quotes: scope.rooms.map((room) =>
      quote(room.id, {
        status: "sold_out",
        errorCode: "no_inventory",
      }),
    ),
    warnings: [],
  });
  const checks = new Map(
    result[0].validationChecks?.map((check) => [check.stage, check.state]),
  );

  assert.equal(result[0].status, "completed");
  assert.equal(checks.get("source_access"), "passed");
  assert.equal(checks.get("raw_offers"), "empty");
  assert.equal(checks.get("room_mapping"), "not_applicable");
  assert.equal(checks.get("price"), "not_applicable");
});

test("validation funnel aggregates passed, failed, empty and unknown evidence", () => {
  const failed = attempts({
    quotes: scope.rooms.map((room) =>
      quote(room.id, { errorCode: "timeout" }),
    ),
    warnings: [],
  });
  const empty = attempts({
    quotes: scope.rooms.map((room) =>
      quote(room.id, {
        status: "sold_out",
        errorCode: "no_inventory",
      }),
    ),
    warnings: [],
  });
  const funnel = buildValidationFunnel([...failed, ...empty]);
  const source = funnel.find((stage) => stage.stage === "source_access")!;
  const offers = funnel.find((stage) => stage.stage === "raw_offers")!;

  assert.equal(source.passedCount, 1);
  assert.equal(source.failedCount, 1);
  assert.equal(offers.emptyCount, 1);
  assert.equal(offers.unknownCount, 1);
});
