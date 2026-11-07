import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHotelMarketRouteHandlers } from "../app/api/hotels/[id]/markets/route-handlers";
import { createHotelMarketDetailRouteHandlers } from "../app/api/hotels/[id]/markets/[marketId]/route-handlers";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";
import { createHotelDraft } from "../src/lib/hotels/model";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hotel-market-api-"));
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
    collection: createHotelMarketRouteHandlers(dependencies),
    detail: createHotelMarketDetailRouteHandlers(dependencies),
  };
}

function collectionContext(id = "hotel_01") {
  return { params: Promise.resolve({ id }) };
}

function detailContext(marketId: string, id = "hotel_01") {
  return { params: Promise.resolve({ id, marketId }) };
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

const validMarket = {
  version: 1,
  id: "example-eu",
  label: " Example Avrupa Benchmark ",
  marketLabel: "Avrupa",
  currency: "EUR",
  requiredBoard: "all-inclusive",
  notes: "Doğrudan otel fiyatı",
};

test("market API adds a normalized market to a draft hotel", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const response = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets",
        "POST",
        validMarket,
      ),
      collectionContext(),
    );
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.market.id, "example-eu");
    assert.equal(payload.market.label, "Example Avrupa Benchmark");
    assert.equal(payload.hotel.version, 2);
    assert.equal(payload.hotel.status, "draft");
    assert.equal(payload.hotel.audit.updatedBy, "local-development");
    assert.equal(
      response.headers.get("location"),
      "/api/hotels/hotel_01/markets/example-eu",
    );
    assert.equal((await store.load())[0].markets.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("market IDs cannot collide with system or user scopes", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const systemConflict = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets",
        "POST",
        { ...validMarket, id: "beach-eu" },
      ),
      collectionContext(),
    );
    assert.equal(systemConflict.status, 409);

    assert.equal(
      (
        await collection.POST(
          jsonRequest(
            "http://localhost/api/hotels/hotel_01/markets",
            "POST",
            validMarket,
          ),
          collectionContext(),
        )
      ).status,
      201,
    );
    await store.update((hotels) => ({
      hotels: [
        ...hotels,
        createHotelDraft({
          id: "hotel_02",
          key: "second-resort",
          name: "Second Resort",
          shortCode: "SR",
          location: { countryCode: "TR", city: "Antalya" },
          createdBy: "creator",
          now: "2026-11-05T09:30:00.000Z",
        }),
      ],
      result: undefined,
    }));
    const userConflict = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_02/markets",
        "POST",
        validMarket,
      ),
      collectionContext("hotel_02"),
    );
    assert.equal(userConflict.status, 409);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("changing currency resets stale channel verification", async () => {
  const { directory, collection, detail, store } = await fixture();
  try {
    await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets",
        "POST",
        validMarket,
      ),
      collectionContext(),
    );
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
            roomAliases: {},
            configurationCheckedAt: "2026-11-05T09:30:00.000Z",
          },
        ],
      })),
      result: undefined,
    }));

    const response = await detail.PATCH(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets/example-eu",
        "PATCH",
        { version: 2, currency: "GBP", requiredBoard: null },
      ),
      detailContext("example-eu"),
    );
    assert.equal(response.status, 200);
    const hotel = (await response.json()).hotel;
    assert.equal(hotel.markets[0].currency, "GBP");
    assert.equal(hotel.markets[0].requiredBoard, undefined);
    assert.equal(hotel.channelMappings[0].status, "draft");
    assert.equal(hotel.channelMappings[0].configurationCheckedAt, undefined);
    assert.equal(hotel.version, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("market deletion is blocked while channel mappings reference it", async () => {
  const { directory, collection, detail, store } = await fixture();
  try {
    await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets",
        "POST",
        validMarket,
      ),
      collectionContext(),
    );
    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({
        ...hotel,
        channelMappings: [
          {
            id: "mapping_01",
            providerKey: "booking",
            marketId: parseRuntimeScopeKey("example-eu"),
            status: "draft" as const,
            roomAliases: {},
          },
        ],
      })),
      result: undefined,
    }));
    const blocked = await detail.DELETE(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets/example-eu",
        "DELETE",
        { version: 2 },
      ),
      detailContext("example-eu"),
    );
    assert.equal(blocked.status, 409);

    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({ ...hotel, channelMappings: [] })),
      result: undefined,
    }));
    const removed = await detail.DELETE(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets/example-eu",
        "DELETE",
        { version: 2 },
      ),
      detailContext("example-eu"),
    );
    assert.equal(removed.status, 200);
    const hotel = (await removed.json()).hotel;
    assert.deepEqual(hotel.markets, []);
    assert.equal(hotel.version, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("market API protects system and non-draft hotels and validates input", async () => {
  const { directory, collection, store } = await fixture();
  try {
    const system = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/system:miramare-beach/markets",
        "POST",
        validMarket,
      ),
      collectionContext("system:miramare-beach"),
    );
    assert.equal(system.status, 403);

    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({ ...hotel, status: "ready" as const })),
      result: undefined,
    }));
    const ready = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets",
        "POST",
        validMarket,
      ),
      collectionContext(),
    );
    assert.equal(ready.status, 409);

    const injected = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets",
        "POST",
        { ...validMarket, status: "verified" },
      ),
      collectionContext(),
    );
    assert.equal(injected.status, 400);

    const crossOrigin = await collection.POST(
      jsonRequest(
        "http://localhost/api/hotels/hotel_01/markets",
        "POST",
        validMarket,
        "https://evil.test",
      ),
      collectionContext(),
    );
    assert.equal(crossOrigin.status, 403);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
