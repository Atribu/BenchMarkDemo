import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createChannelMappingRouteHandlers } from "../app/api/hotels/[id]/channel-mappings/route-handlers";
import { createChannelMappingDetailRouteHandlers } from "../app/api/hotels/[id]/channel-mappings/[mappingId]/route-handlers";
import { createChannelMappingStatusRouteHandlers } from "../app/api/hotels/[id]/channel-mappings/[mappingId]/status/route-handlers";
import { createHotelStatusRouteHandlers } from "../app/api/hotels/[id]/status/route-handlers";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";
import { createHotelDraft } from "../src/lib/hotels/model";

const mappingId = "mapping_00000000000040008000000000000001";

async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "hotel-channel-mapping-api-"),
  );
  const store = createFileHotelStore(directory);
  const marketId = parseRuntimeScopeKey("example-eu");
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
        markets: [
          {
            id: marketId,
            label: "Example Avrupa Benchmark",
            marketLabel: "Avrupa",
            currency: "EUR" as const,
            requiredBoard: "all-inclusive" as const,
          },
        ],
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
        matchingPolicy: {
          category: "standard" as const,
          requireBalcony: false,
          roomByView: {
            land: "standard-land",
            sea: "standard-sea",
          },
        },
      },
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
    collection: createChannelMappingRouteHandlers({
      ...dependencies,
      generateId: () => "00000000-0000-4000-8000-000000000001",
    }),
    detail: createChannelMappingDetailRouteHandlers(dependencies),
    mappingStatus: createChannelMappingStatusRouteHandlers(dependencies),
    hotelStatus: createHotelStatusRouteHandlers(dependencies),
  };
}

function collectionContext(id = "hotel_01") {
  return { params: Promise.resolve({ id }) };
}

function mappingContext(id = "hotel_01", idForMapping = mappingId) {
  return { params: Promise.resolve({ id, mappingId: idForMapping }) };
}

function hotelContext(id = "hotel_01") {
  return { params: Promise.resolve({ id }) };
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

const validMapping = {
  version: 1,
  providerKey: "booking",
  marketId: "example-eu",
  externalHotelId: "example-123",
  pageUrl: "https://www.booking.com/hotel/tr/example-resort.html",
  searchName: "Example Resort",
  roomAliases: {
    "standard-land": ["Standard Land View"],
    "standard-sea": ["Standard Sea View"],
  },
};

async function createMapping(
  collection: ReturnType<typeof createChannelMappingRouteHandlers>,
  payload: unknown = validMapping,
) {
  return collection.POST(
    jsonRequest(
      "http://localhost/api/hotels/hotel_01/channel-mappings",
      "POST",
      payload,
    ),
    collectionContext(),
  );
}

test("channel mapping API creates an isolated draft for an existing OTA", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const response = await createMapping(collection);
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.mapping.id, mappingId);
    assert.equal(payload.mapping.providerKey, "booking");
    assert.equal(payload.mapping.marketId, "example-eu");
    assert.equal(payload.mapping.status, "draft");
    assert.equal(payload.mapping.verifiedAt, undefined);
    assert.equal(payload.hotel.version, 2);
    assert.equal(
      response.headers.get("location"),
      `/api/hotels/hotel_01/channel-mappings/${mappingId}`,
    );
    assert.equal((await store.load())[0].channelMappings.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("channel mapping validation rejects unknown providers and unsafe references", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const unknownProvider = await createMapping(collection, {
      ...validMapping,
      providerKey: "unknown-ota",
    });
    assert.equal(unknownProvider.status, 400);

    const wrongDomain = await createMapping(collection, {
      ...validMapping,
      pageUrl: "https://evil.test/hotel/example",
    });
    assert.equal(wrongDomain.status, 400);

    const unknownMarket = await createMapping(collection, {
      ...validMapping,
      marketId: "missing-market",
    });
    assert.equal(unknownMarket.status, 409);

    const unknownRoom = await createMapping(collection, {
      ...validMapping,
      roomAliases: { "missing-room": ["Supplier Room"] },
    });
    assert.equal(unknownRoom.status, 409);
    assert.equal((await store.load())[0].channelMappings.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("one OTA and market pair can have only one mapping", async () => {
  const { directory, collection } = await fixture();
  try {
    assert.equal((await createMapping(collection)).status, 201);
    const duplicate = await createMapping(collection, {
      ...validMapping,
      version: 2,
    });
    assert.equal(duplicate.status, 409);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verification requires aliases for every policy room", async () => {
  const { directory, collection, mappingStatus, store } = await fixture();
  try {
    const created = await createMapping(collection, {
      ...validMapping,
      roomAliases: { "standard-land": ["Standard Land View"] },
    });
    assert.equal(created.status, 201);
    const response = await mappingStatus.PATCH(
      jsonRequest(
        `http://localhost/api/hotels/hotel_01/channel-mappings/${mappingId}/status`,
        "PATCH",
        { version: 2, status: "verified" },
      ),
      mappingContext(),
    );
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /standard-sea/);
    assert.equal((await store.load())[0].channelMappings[0].status, "draft");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a complete mapping can be verified and enables controlled activation", async () => {
  const { directory, collection, mappingStatus, hotelStatus } = await fixture();
  try {
    await createMapping(collection);
    const verifiedResponse = await mappingStatus.PATCH(
      jsonRequest(
        `http://localhost/api/hotels/hotel_01/channel-mappings/${mappingId}/status`,
        "PATCH",
        { version: 2, status: "verified" },
      ),
      mappingContext(),
    );
    assert.equal(verifiedResponse.status, 200);
    const verified = (await verifiedResponse.json()).mapping;
    assert.equal(verified.status, "verified");
    assert.equal(verified.verifiedAt, "2026-11-05T10:00:00.000Z");

    const ready = await hotelStatus.PATCH(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/status",
        "PATCH",
        { version: 3, status: "ready" },
      ),
      hotelContext(),
    );
    assert.equal(ready.status, 200);
    const active = await hotelStatus.PATCH(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/status",
        "PATCH",
        { version: 4, status: "active" },
      ),
      hotelContext(),
    );
    assert.equal(active.status, 200);
    assert.equal((await active.json()).hotel.status, "active");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mapping detail changes clear verification and deletion is versioned", async () => {
  const { directory, collection, detail, mappingStatus } = await fixture();
  try {
    await createMapping(collection);
    await mappingStatus.PATCH(
      jsonRequest(
        `http://localhost/api/hotels/hotel_01/channel-mappings/${mappingId}/status`,
        "PATCH",
        { version: 2, status: "verified" },
      ),
      mappingContext(),
    );
    const updatedResponse = await detail.PATCH(
      jsonRequest(
        `http://localhost/api/hotels/hotel_01/channel-mappings/${mappingId}`,
        "PATCH",
        { version: 3, searchName: "Example Resort Hotel" },
      ),
      mappingContext(),
    );
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.mapping.searchName, "Example Resort Hotel");
    assert.equal(updated.mapping.status, "draft");
    assert.equal(updated.mapping.verifiedAt, undefined);
    assert.equal(updated.hotel.version, 4);

    const staleDelete = await detail.DELETE(
      jsonRequest(
        `http://localhost/api/hotels/hotel_01/channel-mappings/${mappingId}`,
        "DELETE",
        { version: 3 },
      ),
      mappingContext(),
    );
    assert.equal(staleDelete.status, 409);
    const removed = await detail.DELETE(
      jsonRequest(
        `http://localhost/api/hotels/hotel_01/channel-mappings/${mappingId}`,
        "DELETE",
        { version: 4 },
      ),
      mappingContext(),
    );
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).hotel.channelMappings, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("channel mapping API protects system and non-draft hotels", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const systemId = "system:miramare-beach";
    const system = await collection.POST(
      jsonRequest(
        `http://localhost/api/hotels/${systemId}/channel-mappings`,
        "POST",
        validMapping,
      ),
      collectionContext(systemId),
    );
    assert.equal(system.status, 403);

    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({ ...hotel, status: "ready" as const })),
      result: undefined,
    }));
    assert.equal((await createMapping(collection)).status, 409);

    const injected = await createMapping(collection, {
      ...validMapping,
      status: "verified",
    });
    assert.equal(injected.status, 400);

    const crossOrigin = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/channel-mappings",
        "POST",
        validMapping,
        "https://evil.test",
      ),
      collectionContext(),
    );
    assert.equal(crossOrigin.status, 403);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
