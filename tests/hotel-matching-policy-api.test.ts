import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHotelMatchingPolicyRouteHandlers } from "../app/api/hotels/[id]/matching-policy/route-handlers";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";
import { createHotelDraft } from "../src/lib/hotels/model";

async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "hotel-matching-policy-api-"),
  );
  const store = createFileHotelStore(directory);
  await store.update(() => ({
    hotels: [
      {
        ...createHotelDraft({
          id: "hotel_01",
          key: "example-resort",
          name: "Example Resort",
          shortCode: "ER",
          location: { countryCode: "TR", city: "Antalya" },
          createdBy: "creator",
          now: "2026-11-05T09:00:00.000Z",
        }),
        rooms: [
          {
            id: "standard-land",
            name: "Standart Kara Manzaralı",
            occupancy: { rooms: 1, adults: 2, children: 0 },
          },
          {
            id: "standard-sea",
            name: "Standart Deniz Manzaralı",
            occupancy: { rooms: 1, adults: 2, children: 0 },
          },
        ],
        channelMappings: [
          {
            id: "mapping_01",
            providerKey: "booking",
            marketId: parseRuntimeScopeKey("example-eu"),
            status: "verified" as const,
            externalHotelId: "example-123",
            roomAliases: {
              "standard-land": ["Standard Land View"],
              "standard-sea": ["Standard Sea View"],
            },
            verifiedAt: "2026-11-05T09:30:00.000Z",
          },
        ],
      },
    ],
    result: undefined,
  }));
  return {
    directory,
    store,
    handlers: createHotelMatchingPolicyRouteHandlers({
      store,
      now: () => new Date("2026-11-05T10:00:00.000Z"),
    }),
  };
}

function context(id = "hotel_01") {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(
  method: string,
  body: unknown,
  id = "hotel_01",
  origin?: string,
) {
  return new Request(`http://localhost/api/hotels/${id}/matching-policy`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validPolicy = {
  version: 1,
  category: "standard",
  requireBalcony: false,
  roomByView: {
    land: "standard-land",
    garden: "standard-land",
    sea: "standard-sea",
  },
};

test("matching policy API stores only references to existing rooms", async () => {
  const { directory, handlers, store } = await fixture();
  try {
    const response = await handlers.PUT(
      jsonRequest("PUT", validPolicy),
      context(),
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.matchingPolicy, {
      category: "standard",
      requireBalcony: false,
      roomByView: {
        land: "standard-land",
        garden: "standard-land",
        sea: "standard-sea",
      },
    });
    assert.equal(payload.hotel.version, 2);
    assert.equal(payload.hotel.audit.updatedBy, "local-development");
    assert.equal(payload.hotel.channelMappings[0].status, "draft");
    assert.equal(payload.hotel.channelMappings[0].verifiedAt, undefined);
    assert.equal((await store.load())[0].matchingPolicy?.roomByView.sea, "standard-sea");

    const stale = await handlers.PUT(
      jsonRequest("PUT", validPolicy),
      context(),
    );
    assert.equal(stale.status, 409);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("matching policy rejects unknown rooms and views without writing", async () => {
  const { directory, handlers, store } = await fixture();
  try {
    const missingRoom = await handlers.PUT(
      jsonRequest("PUT", {
        ...validPolicy,
        roomByView: { land: "missing-room" },
      }),
      context(),
    );
    assert.equal(missingRoom.status, 409);

    const unknownView = await handlers.PUT(
      jsonRequest("PUT", {
        ...validPolicy,
        roomByView: { pool: "standard-land" },
      }),
      context(),
    );
    assert.equal(unknownView.status, 400);
    assert.equal((await store.load())[0].matchingPolicy, undefined);
    assert.equal((await store.load())[0].version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("matching policy can be removed and invalidates channel verification", async () => {
  const { directory, handlers, store } = await fixture();
  try {
    await handlers.PUT(jsonRequest("PUT", validPolicy), context());
    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({
        ...hotel,
        channelMappings: hotel.channelMappings.map((mapping) => ({
          ...mapping,
          status: "verified" as const,
          verifiedAt: "2026-11-05T10:15:00.000Z",
        })),
      })),
      result: undefined,
    }));
    const response = await handlers.DELETE(
      jsonRequest("DELETE", { version: 2 }),
      context(),
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.matchingPolicy, null);
    assert.equal(payload.hotel.matchingPolicy, undefined);
    assert.equal(payload.hotel.channelMappings[0].status, "draft");
    assert.equal(payload.hotel.version, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("matching policy API protects system and non-draft hotels", async () => {
  const { directory, handlers, store } = await fixture();
  try {
    const systemId = "system:miramare-beach";
    const system = await handlers.PUT(
      jsonRequest("PUT", validPolicy, systemId),
      context(systemId),
    );
    assert.equal(system.status, 403);

    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({ ...hotel, status: "ready" as const })),
      result: undefined,
    }));
    const ready = await handlers.PUT(
      jsonRequest("PUT", validPolicy),
      context(),
    );
    assert.equal(ready.status, 409);

    const injected = await handlers.PUT(
      jsonRequest("PUT", { ...validPolicy, status: "active" }),
      context(),
    );
    assert.equal(injected.status, 400);

    const crossOrigin = await handlers.PUT(
      jsonRequest("PUT", validPolicy, "hotel_01", "https://evil.test"),
      context(),
    );
    assert.equal(crossOrigin.status, 403);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
