import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRoomSuggestionRouteHandlers } from "../app/api/hotels/[id]/channel-mappings/[mappingId]/room-suggestions/route-handlers";
import type { HotelKey, ScopeKey } from "../src/lib/benchmark/types";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { parseRuntimeHotelId, parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";
import { createHotelDraft, type ManagedHotelRecord } from "../src/lib/hotels/model";
import { assignDiscoveredRoomNames } from "../src/lib/hotels/room-alias-discovery";

function hotel(): ManagedHotelRecord {
  return {
    ...createHotelDraft({
      id: "hotel_01",
      key: "example-resort",
      name: "Example Resort",
      shortCode: "ER",
      location: { countryCode: "TR", city: "Antalya" },
      createdBy: "tester",
      now: "2026-11-10T09:00:00.000Z",
    }),
    markets: [{ id: parseRuntimeScopeKey("example-eu"), label: "Example Avrupa", marketLabel: "Avrupa", currency: "EUR" }],
    rooms: [
      { id: "superior-land", name: "Superior Kara", occupancy: { rooms: 1, adults: 2, children: 0 } },
      { id: "superior-sea", name: "Superior Deniz", occupancy: { rooms: 1, adults: 2, children: 0 } },
    ],
    matchingPolicy: {
      category: "superior",
      requireBalcony: false,
      roomByView: { land: "superior-land", sea: "superior-sea" },
    },
    channelMappings: [{
      id: parseRuntimeHotelId("mapping_01"),
      providerKey: "booking",
      marketId: parseRuntimeScopeKey("example-eu"),
      status: "draft",
      externalHotelId: "12345",
      pageUrl: "https://www.booking.com/hotel/tr/example-resort.html",
      roomAliases: {},
    }],
  };
}

const scope = {
  id: parseRuntimeScopeKey("example-eu") as unknown as ScopeKey,
  label: "Example Avrupa",
  hotelKey: "example-resort" as HotelKey,
  hotelName: "Example Resort",
  marketLabel: "Avrupa",
  currency: "EUR" as const,
  windows: [],
  rooms: [
    { id: "superior-land", name: "Superior Kara", occupancyLabel: "1 oda · 2 yetişkin", referenceRates: {} },
    { id: "superior-sea", name: "Superior Deniz", occupancyLabel: "1 oda · 2 yetişkin", referenceRates: {} },
  ],
};

test("discovered OTA names are assigned only when room semantics are safe", () => {
  const result = assignDiscoveredRoomNames(hotel(), scope, [
    "Superior Room Land View",
    "Superior Room Sea View",
    "Superior Side Sea View",
    "Economy Land View",
  ]);
  assert.deepEqual(result.aliasesByRoom, {
    "superior-land": ["Superior Room Land View"],
    "superior-sea": ["Superior Room Sea View"],
  });
  assert.deepEqual(result.unassigned, ["Superior Side Sea View", "Economy Land View"]);
});

test("room suggestion route returns collector suggestions without mutating the hotel", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "room-suggestions-"));
  const store = createFileHotelStore(directory);
  await store.update(() => ({ hotels: [hotel()], result: undefined }));
  let released = false;
  const handlers = createRoomSuggestionRouteHandlers({
    store,
    acquire: () => () => { released = true; },
    discover: async () => ({
      aliasesByRoom: { "superior-sea": ["Superior Room Sea View"] },
      unassigned: [],
      warnings: [],
    }),
  });
  try {
    const response = await handlers.POST(
      new Request("http://localhost/api/hotels/hotel_01/channel-mappings/mapping_01/room-suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkIn: "2027-05-10", checkOut: "2027-05-15" }),
      }),
      { params: Promise.resolve({ id: "hotel_01", mappingId: "mapping_01" }) },
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).aliasesByRoom, {
      "superior-sea": ["Superior Room Sea View"],
    });
    assert.equal(released, true);
    assert.deepEqual((await store.load())[0].channelMappings[0].roomAliases, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
