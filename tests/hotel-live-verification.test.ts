import test from "node:test";
import assert from "node:assert/strict";
import type {
  CollectionAttempt,
  CollectionValidationCheck,
  ValidationStage,
} from "../src/lib/benchmark/types";
import type { HotelKey, ScopeKey } from "../src/lib/hotels/catalog";
import type { HotelStore } from "../src/lib/hotels/file-store";
import { parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";
import { recordLiveCollectorEvidence } from "../src/lib/hotels/live-verification";
import { createHotelDraft, type ManagedHotelRecord } from "../src/lib/hotels/model";
import type { DynamicHotelRuntimeManifest } from "../src/lib/hotels/runtime-manifest";

const stages: ValidationStage[] = [
  "source_access",
  "hotel_identity",
  "stay_dates",
  "occupancy",
  "raw_offers",
  "room_mapping",
  "board",
  "price",
  "currency",
];

function activeHotel(): ManagedHotelRecord {
  const marketId = parseRuntimeScopeKey("example-eu");
  return {
    ...createHotelDraft({
      id: "hotel_01",
      key: "example-resort",
      name: "Example Resort",
      shortCode: "ER",
      location: { countryCode: "TR", city: "Antalya" },
      createdBy: "creator",
      now: "2026-11-05T09:00:00.000Z",
    }),
    status: "active",
    markets: [
      {
        id: marketId,
        label: "Example Europe",
        marketLabel: "Europe",
        currency: "EUR",
      },
    ],
    channelMappings: [
      {
        id: "mapping_00000000000040008000000000000001",
        providerKey: "booking",
        marketId,
        status: "configured",
        externalHotelId: "example-123",
        roomAliases: { "standard-land": ["Standard Land View"] },
        configurationCheckedAt: "2026-11-05T09:30:00.000Z",
      },
    ],
  };
}

function memoryStore(initial: ManagedHotelRecord[]) {
  let hotels: readonly ManagedHotelRecord[] = initial;
  const store: HotelStore = {
    async load() {
      return hotels;
    },
    async update(mutate) {
      const result = mutate(hotels);
      hotels = result.hotels;
      return result.result;
    },
  };
  return { store, hotels: () => hotels };
}

function manifest(): DynamicHotelRuntimeManifest {
  return {
    hotelId: "hotel_01",
    hotelKey: "example-resort",
    scopes: [
      {
        id: parseRuntimeScopeKey("example-eu") as ScopeKey,
        label: "Example Europe",
        hotelKey: "example-resort" as HotelKey,
        hotelName: "Example Resort",
        marketLabel: "Europe",
        currency: "EUR",
        windows: [],
        rooms: [],
      },
    ],
    collectorConfigs: {},
  };
}

function attempt(
  overrides: Partial<CollectionAttempt> = {},
): CollectionAttempt {
  const validationChecks: CollectionValidationCheck[] = stages.map(
    (stage) => ({ stage, state: "passed", evidence: "derived" }),
  );
  return {
    id: "booking::example-eu::2026-12-10_2026-12-15",
    providerKey: "booking",
    scopeKey: "example-eu" as ScopeKey,
    hotelKey: "example-resort" as HotelKey,
    windowId: "2026-12-10_2026-12-15",
    status: "completed",
    startedAt: "2026-11-07T10:00:00.000Z",
    completedAt: "2026-11-07T10:00:05.000Z",
    rawOfferCount: 1,
    acceptedOfferCount: 1,
    validationChecks,
    ...overrides,
  };
}

test("a complete dynamic collector result records live verification evidence", async () => {
  const state = memoryStore([activeHotel()]);
  const count = await recordLiveCollectorEvidence({
    store: state.store,
    manifests: [manifest()],
    attempts: [attempt()],
  });

  assert.equal(count, 1);
  assert.equal(
    state.hotels()[0].channelMappings[0].liveVerifiedAt,
    "2026-11-07T10:00:05.000Z",
  );
  assert.equal(
    state.hotels()[0].channelMappings[0].lastLiveCheckAt,
    "2026-11-07T10:00:05.000Z",
  );
  assert.equal(
    state.hotels()[0].channelMappings[0].lastLiveCheckSucceeded,
    true,
  );
  assert.equal(state.hotels()[0].version, 1);
});

test("timeouts and incomplete validation never create live evidence", async () => {
  const state = memoryStore([activeHotel()]);
  const incompleteChecks = stages.map((stage) => ({
    stage,
    state: stage === "hotel_identity" ? "unknown" as const : "passed" as const,
    evidence: "derived" as const,
  }));
  const count = await recordLiveCollectorEvidence({
    store: state.store,
    manifests: [manifest()],
    attempts: [
      attempt({
        status: "failed",
        errorCode: "timeout",
        acceptedOfferCount: 0,
      }),
      attempt({ validationChecks: incompleteChecks }),
    ],
  });

  assert.equal(count, 1);
  assert.equal(state.hotels()[0].channelMappings[0].liveVerifiedAt, undefined);
  assert.equal(
    state.hotels()[0].channelMappings[0].lastLiveCheckSucceeded,
    false,
  );
});

test("a newer failed check is visible without erasing the last successful timestamp", async () => {
  const state = memoryStore([activeHotel()]);
  await recordLiveCollectorEvidence({
    store: state.store,
    manifests: [manifest()],
    attempts: [attempt()],
  });
  await recordLiveCollectorEvidence({
    store: state.store,
    manifests: [manifest()],
    attempts: [
      attempt({
        status: "failed",
        errorCode: "timeout",
        acceptedOfferCount: 0,
        completedAt: "2026-11-07T11:00:05.000Z",
      }),
    ],
  });

  const mapping = state.hotels()[0].channelMappings[0];
  assert.equal(mapping.liveVerifiedAt, "2026-11-07T10:00:05.000Z");
  assert.equal(mapping.lastLiveCheckAt, "2026-11-07T11:00:05.000Z");
  assert.equal(mapping.lastLiveCheckSucceeded, false);
});

test("static or unrelated scope results cannot verify a dynamic mapping", async () => {
  const state = memoryStore([activeHotel()]);
  const count = await recordLiveCollectorEvidence({
    store: state.store,
    manifests: [manifest()],
    attempts: [attempt({ scopeKey: "beach-eu" as ScopeKey })],
  });

  assert.equal(count, 0);
  assert.equal(state.hotels()[0].channelMappings[0].liveVerifiedAt, undefined);
});
