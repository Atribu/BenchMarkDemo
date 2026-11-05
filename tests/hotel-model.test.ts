import test from "node:test";
import assert from "node:assert/strict";
import {
  createHotelDraft,
  type ManagedHotelRecord,
} from "../src/lib/hotels/model";
import { parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";

test("a user-created hotel always starts as an isolated draft", () => {
  const hotel = createHotelDraft({
    id: "hotel_01",
    key: "example-resort",
    name: "Example Resort",
    shortCode: "ER",
    location: {
      countryCode: "TR",
      city: "Antalya",
      region: "Belek",
    },
    websiteUrl: "https://example.com",
    createdBy: "admin@example.com",
    now: "2026-11-05T09:00:00.000Z",
  });

  assert.equal(hotel.source, "user");
  assert.equal(hotel.status, "draft");
  assert.equal(hotel.version, 1);
  assert.deepEqual(hotel.markets, []);
  assert.deepEqual(hotel.rooms, []);
  assert.deepEqual(hotel.channelMappings, []);
  assert.equal(hotel.matchingPolicy, undefined);
  assert.deepEqual(hotel.audit, {
    createdBy: "admin@example.com",
    createdAt: "2026-11-05T09:00:00.000Z",
    updatedBy: "admin@example.com",
    updatedAt: "2026-11-05T09:00:00.000Z",
  });
});

test("managed hotel model keeps markets, rooms and channel mappings separate", () => {
  const hotel: ManagedHotelRecord = {
    ...createHotelDraft({
      id: "hotel_02",
      key: "example-beach",
      name: "Example Beach",
      shortCode: "EB",
      location: { countryCode: "TR", city: "Antalya" },
      createdBy: "admin@example.com",
      now: "2026-11-05T09:00:00.000Z",
    }),
    markets: [
      {
        id: parseRuntimeScopeKey("example-beach-eu"),
        label: "Example Beach Avrupa Benchmark",
        marketLabel: "Avrupa",
        currency: "EUR",
        requiredBoard: "all-inclusive",
      },
    ],
    rooms: [
      {
        id: "standard-land",
        name: "Standart Kara Manzaralı",
        occupancy: { rooms: 1, adults: 2, children: 0 },
      },
    ],
    matchingPolicy: {
      category: "standard",
      requireBalcony: false,
      roomByView: { land: "standard-land" },
    },
    channelMappings: [
      {
        id: "mapping_01",
        providerKey: "booking",
        marketId: parseRuntimeScopeKey("example-beach-eu"),
        status: "draft",
        roomAliases: {
          "standard-land": ["Standard Room with Land View"],
        },
      },
    ],
  };

  assert.equal(hotel.markets[0].currency, "EUR");
  assert.equal(hotel.rooms[0].occupancy.adults, 2);
  assert.equal(hotel.channelMappings[0].status, "draft");
  assert.equal(hotel.status, "draft");
});
