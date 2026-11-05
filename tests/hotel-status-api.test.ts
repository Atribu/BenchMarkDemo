import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHotelStatusRouteHandlers } from "../app/api/hotels/[id]/status/route-handlers";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";
import { createHotelDraft, type ManagedHotelRecord } from "../src/lib/hotels/model";
import { createHotelReadRepository } from "../src/lib/hotels/repository";

function draft(configured = false): ManagedHotelRecord {
  const hotel = createHotelDraft({
    id: "hotel_01",
    key: "example-resort",
    name: "Example Resort",
    shortCode: "ER",
    location: { countryCode: "TR", city: "Antalya" },
    createdBy: "creator",
    now: "2026-11-05T09:00:00.000Z",
  });
  if (!configured) return hotel;

  const marketId = parseRuntimeScopeKey("example-eu");
  return {
    ...hotel,
    markets: [
      {
        id: marketId,
        label: "Example Avrupa Benchmark",
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
        marketId,
        status: "verified",
        externalHotelId: "example-123",
        roomAliases: { "standard-land": ["Standard Land View"] },
        verifiedAt: "2026-11-05T09:30:00.000Z",
      },
    ],
  };
}

async function fixture(configured = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hotel-status-api-"));
  const store = createFileHotelStore(directory);
  await store.update(() => ({ hotels: [draft(configured)], result: undefined }));
  const handlers = createHotelStatusRouteHandlers({
    store,
    now: () => new Date("2026-11-05T10:00:00.000Z"),
  });
  return { directory, handlers, store };
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(
  id: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost/api/hotels/${id}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("empty drafts cannot become ready or bypass ready state", async () => {
  const { directory, handlers, store } = await fixture();
  try {
    const incomplete = await handlers.PATCH(
      request("hotel_01", { version: 1, status: "ready" }),
      context("hotel_01"),
    );
    assert.equal(incomplete.status, 409);
    assert.match((await incomplete.json()).error, /en az bir pazar/);

    const bypass = await handlers.PATCH(
      request("hotel_01", { version: 1, status: "active" }),
      context("hotel_01"),
    );
    assert.equal(bypass.status, 409);
    assert.match((await bypass.json()).error, /Taslak.*Aktif/);

    const [hotel] = await store.load();
    assert.equal(hotel.status, "draft");
    assert.equal(hotel.version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("configured hotels transition from draft to ready and active", async () => {
  const { directory, handlers, store } = await fixture(true);
  try {
    const readyResponse = await handlers.PATCH(
      request("hotel_01", { version: 1, status: "ready" }),
      context("hotel_01"),
    );
    assert.equal(readyResponse.status, 200);
    const ready = (await readyResponse.json()).hotel;
    assert.equal(ready.status, "ready");
    assert.equal(ready.version, 2);
    assert.equal(ready.audit.updatedBy, "local-development");

    const stale = await handlers.PATCH(
      request("hotel_01", { version: 1, status: "active" }),
      context("hotel_01"),
    );
    assert.equal(stale.status, 409);

    const activeResponse = await handlers.PATCH(
      request("hotel_01", { version: 2, status: "active" }),
      context("hotel_01"),
    );
    assert.equal(activeResponse.status, 200);
    const active = (await activeResponse.json()).hotel;
    assert.equal(active.status, "active");
    assert.equal(active.version, 3);
    assert.equal(
      createHotelReadRepository(await store.load())
        .listForBenchmark()
        .some((hotel) => hotel.id === "hotel_01"),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("activation requires a verified channel for every market", async () => {
  const { directory, handlers, store } = await fixture(true);
  try {
    await store.update((hotels) => ({
      hotels: hotels.map((hotel) => ({
        ...hotel,
        status: "ready" as const,
        channelMappings: hotel.channelMappings.map((mapping) => ({
          ...mapping,
          status: "draft" as const,
          verifiedAt: undefined,
        })),
      })),
      result: undefined,
    }));
    const response = await handlers.PATCH(
      request("hotel_01", { version: 1, status: "active" }),
      context("hotel_01"),
    );
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /doğrulanmış kanal/);
    assert.equal((await store.load())[0].status, "ready");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("archiving records the time and restoring clears it", async () => {
  const { directory, handlers } = await fixture();
  try {
    const archivedResponse = await handlers.PATCH(
      request("hotel_01", { version: 1, status: "archived" }),
      context("hotel_01"),
    );
    const archived = (await archivedResponse.json()).hotel;
    assert.equal(archivedResponse.status, 200);
    assert.equal(archived.status, "archived");
    assert.equal(archived.audit.archivedAt, "2026-11-05T10:00:00.000Z");

    const restoredResponse = await handlers.PATCH(
      request("hotel_01", { version: 2, status: "draft" }),
      context("hotel_01"),
    );
    const restored = (await restoredResponse.json()).hotel;
    assert.equal(restoredResponse.status, 200);
    assert.equal(restored.status, "draft");
    assert.equal(restored.audit.archivedAt, undefined);
    assert.equal(restored.version, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("status API keeps system hotels read-only and validates writes", async () => {
  const { directory, handlers } = await fixture();
  try {
    const systemId = "system:miramare-beach";
    const system = await handlers.PATCH(
      request(systemId, { version: 1, status: "ready" }),
      context(systemId),
    );
    assert.equal(system.status, 403);

    const injected = await handlers.PATCH(
      request("hotel_01", { version: 1, status: "ready", source: "system" }),
      context("hotel_01"),
    );
    assert.equal(injected.status, 400);

    const invalid = await handlers.PATCH(
      request("hotel_01", { version: 1, status: "published" }),
      context("hotel_01"),
    );
    assert.equal(invalid.status, 400);

    const crossOrigin = await handlers.PATCH(
      request(
        "hotel_01",
        { version: 1, status: "archived" },
        { origin: "https://evil.test" },
      ),
      context("hotel_01"),
    );
    assert.equal(crossOrigin.status, 403);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
