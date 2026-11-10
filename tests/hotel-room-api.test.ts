import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHotelRoomRouteHandlers } from "../app/api/hotels/[id]/rooms/route-handlers";
import { createHotelRoomDetailRouteHandlers } from "../app/api/hotels/[id]/rooms/[roomId]/route-handlers";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";
import { createHotelDraft } from "../src/lib/hotels/model";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hotel-room-api-"));
  const store = createFileHotelStore(directory);
  await store.update(() => ({
    hotels: [
      createHotelDraft({
        id: "hotel_01",
        key: "example-resort",
        name: "Example Resort",
        shortCode: "ER",
        location: { countryCode: "TR", city: "Antalya" },
        createdBy: "creator",
        now: "2026-11-05T09:00:00.000Z",
      }),
    ],
    result: undefined,
  }));
  const dependencies = {
    store,
    now: () => new Date("2026-11-05T10:00:00.000Z"),
  };
  return {
    directory,
    store,
    collection: createHotelRoomRouteHandlers(dependencies),
    detail: createHotelRoomDetailRouteHandlers(dependencies),
  };
}

function collectionContext(id = "hotel_01") {
  return { params: Promise.resolve({ id }) };
}

function detailContext(roomId: string, id = "hotel_01") {
  return { params: Promise.resolve({ id, roomId }) };
}

function jsonRequest(url: string, method: string, body: unknown, origin?: string) {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validRoom = {
  version: 1,
  id: "standard-land",
  name: " Standart Kara Manzaralı ",
  occupancy: { rooms: 1, adults: 2, children: 0 },
};

async function addRoom(
  collection: ReturnType<typeof createHotelRoomRouteHandlers>,
) {
  return collection.POST(
    jsonRequest(
      "http://localhost/api/hotels/hotel_01/rooms",
      "POST",
      validRoom,
    ),
    collectionContext(),
  );
}

test("room API adds a structured room type to a draft hotel", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const response = await addRoom(collection);
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.room.id, "standard-land");
    assert.equal(payload.room.name, "Standart Kara Manzaralı");
    assert.deepEqual(payload.room.occupancy, {
      rooms: 1,
      adults: 2,
      children: 0,
    });
    assert.equal(payload.hotel.version, 2);
    assert.equal(payload.hotel.status, "draft");
    assert.equal(
      response.headers.get("location"),
      "/api/hotels/hotel_01/rooms/standard-land",
    );
    assert.equal((await store.load())[0].rooms.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("room API adds multiple rooms atomically with one version change", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const duplicateBatch = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/rooms",
        "POST",
        {
          version: 1,
          rooms: [
            { id: "superior-land", name: "Superior Kara", occupancy: { rooms: 1, adults: 2, children: 0 } },
            { id: "superior-land", name: "Superior Deniz", occupancy: { rooms: 1, adults: 2, children: 0 } },
          ],
        },
      ),
      collectionContext(),
    );
    assert.equal(duplicateBatch.status, 400);
    assert.equal((await store.load())[0].rooms.length, 0);

    const response = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/rooms",
        "POST",
        {
          version: 1,
          rooms: [
            { id: "superior-land", name: "Superior Kara", occupancy: { rooms: 1, adults: 2, children: 0 } },
            { id: "superior-sea", name: "Superior Deniz", occupancy: { rooms: 1, adults: 2, children: 0 } },
          ],
        },
      ),
      collectionContext(),
    );
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.hotel.rooms.length, 2);
    assert.equal(payload.hotel.version, 2);
    assert.equal(payload.room.id, "superior-sea");
    assert.deepEqual(
      (await store.load())[0].rooms.map((room) => room.id),
      ["superior-land", "superior-sea"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("room API validates occupancy and rejects duplicate room IDs", async () => {
  const { directory, collection } = await fixture();
  try {
    const noAdult = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/rooms",
        "POST",
        { ...validRoom, occupancy: { rooms: 1, adults: 0, children: 1 } },
      ),
      collectionContext(),
    );
    assert.equal(noAdult.status, 400);

    const tooManyGuests = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/rooms",
        "POST",
        { ...validRoom, occupancy: { rooms: 2, adults: 15, children: 6 } },
      ),
      collectionContext(),
    );
    assert.equal(tooManyGuests.status, 400);

    assert.equal((await addRoom(collection)).status, 201);
    const duplicate = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/rooms",
        "POST",
        { ...validRoom, version: 2 },
      ),
      collectionContext(),
    );
    assert.equal(duplicate.status, 409);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("room changes reset stale channel verification", async () => {
  const { directory, collection, detail, store } = await fixture();
  try {
    await addRoom(collection);
    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({
        ...hotel,
        channelMappings: [
          {
            id: "mapping_01",
            providerKey: "booking",
            marketId: parseRuntimeScopeKey("example-eu"),
            status: "configured" as const,
            externalHotelId: "example-123",
            roomAliases: { "standard-land": ["Standard Land View"] },
            configurationCheckedAt: "2026-11-05T09:30:00.000Z",
          },
        ],
      })),
      result: undefined,
    }));

    const response = await detail.PATCH(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/rooms/standard-land",
        "PATCH",
        {
          version: 2,
          name: "Standard Garden Room",
          occupancy: { rooms: 1, adults: 2, children: 1 },
        },
      ),
      detailContext("standard-land"),
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.room.name, "Standard Garden Room");
    assert.equal(payload.room.occupancy.children, 1);
    assert.equal(payload.hotel.channelMappings[0].status, "draft");
    assert.equal(payload.hotel.channelMappings[0].configurationCheckedAt, undefined);
    assert.equal(payload.hotel.version, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("room deletion protects matching policy and channel aliases", async () => {
  const { directory, collection, detail, store } = await fixture();
  try {
    await addRoom(collection);
    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({
        ...hotel,
        matchingPolicy: {
          category: "standard" as const,
          requireBalcony: false,
          roomByView: { land: "standard-land" },
        },
        channelMappings: [
          {
            id: "mapping_01",
            providerKey: "booking",
            marketId: parseRuntimeScopeKey("example-eu"),
            status: "draft" as const,
            roomAliases: { "standard-land": ["Standard Land View"] },
          },
        ],
      })),
      result: undefined,
    }));
    const url = "http://localhost/api/hotels/hotel_01/rooms/standard-land";
    const policyBlocked = await detail.DELETE(
      jsonRequest(url, "DELETE", { version: 2 }),
      detailContext("standard-land"),
    );
    assert.equal(policyBlocked.status, 409);
    assert.match((await policyBlocked.json()).error, /eşleştirme politikasından/);

    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({ ...hotel, matchingPolicy: undefined })),
      result: undefined,
    }));
    const aliasBlocked = await detail.DELETE(
      jsonRequest(url, "DELETE", { version: 2 }),
      detailContext("standard-land"),
    );
    assert.equal(aliasBlocked.status, 409);
    assert.match((await aliasBlocked.json()).error, /alias/);

    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({
        ...hotel,
        channelMappings: hotel.channelMappings.map((mapping) => ({
          ...mapping,
          roomAliases: {},
        })),
      })),
      result: undefined,
    }));
    const removed = await detail.DELETE(
      jsonRequest(url, "DELETE", { version: 2 }),
      detailContext("standard-land"),
    );
    assert.equal(removed.status, 200);
    const hotel = (await removed.json()).hotel;
    assert.deepEqual(hotel.rooms, []);
    assert.equal(hotel.version, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("room API protects system and non-draft hotels and validates writes", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const system = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/system:miramare-beach/rooms",
        "POST",
        validRoom,
      ),
      collectionContext("system:miramare-beach"),
    );
    assert.equal(system.status, 403);

    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({ ...hotel, status: "ready" as const })),
      result: undefined,
    }));
    const ready = await addRoom(collection);
    assert.equal(ready.status, 409);

    const injected = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/rooms",
        "POST",
        { ...validRoom, aliases: ["Supplier Room"] },
      ),
      collectionContext(),
    );
    assert.equal(injected.status, 400);

    const crossOrigin = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/rooms",
        "POST",
        validRoom,
        "https://evil.test",
      ),
      collectionContext(),
    );
    assert.equal(crossOrigin.status, 403);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
