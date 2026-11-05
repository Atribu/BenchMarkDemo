import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHotelDetailRouteHandlers } from "../app/api/hotels/[id]/route-handlers";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { createHotelDraft } from "../src/lib/hotels/model";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hotel-detail-api-"));
  const store = createFileHotelStore(directory);
  await store.update(() => ({
    hotels: [
      createHotelDraft({
        id: "hotel_01",
        key: "example-resort",
        name: "Example Resort",
        shortCode: "ER",
        location: { countryCode: "TR", city: "Antalya" },
        websiteUrl: "https://example.com/",
        createdBy: "creator",
        now: "2026-11-05T09:00:00.000Z",
      }),
    ],
    result: undefined,
  }));
  const handlers = createHotelDetailRouteHandlers({
    store,
    now: () => new Date("2026-11-05T10:00:00.000Z"),
  });
  return { directory, handlers, store };
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getRequest(id: string) {
  return new Request(`http://localhost/api/hotels/${id}`);
}

function patchRequest(
  id: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost/api/hotels/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("hotel detail API reads system and user hotels", async () => {
  const { directory, handlers } = await fixture();
  try {
    const user = await handlers.GET(getRequest("hotel_01"), context("hotel_01"));
    assert.equal(user.status, 200);
    assert.equal((await user.json()).hotel.key, "example-resort");

    const systemId = "system:miramare-beach";
    const system = await handlers.GET(getRequest(systemId), context(systemId));
    assert.equal(system.status, 200);
    assert.equal((await system.json()).hotel.source, "system");

    const missing = await handlers.GET(
      getRequest("hotel_missing"),
      context("hotel_missing"),
    );
    assert.equal(missing.status, 404);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hotel detail API updates allowed fields with optimistic versioning", async () => {
  const { directory, handlers } = await fixture();
  try {
    const response = await handlers.PATCH(
      patchRequest("hotel_01", {
        version: 1,
        name: " Updated Resort ",
        shortCode: "ur",
        location: { countryCode: "tr", city: "Muğla", region: "Bodrum" },
        websiteUrl: null,
      }),
      context("hotel_01"),
    );
    assert.equal(response.status, 200);
    const hotel = (await response.json()).hotel;
    assert.equal(hotel.name, "Updated Resort");
    assert.equal(hotel.shortCode, "UR");
    assert.equal(hotel.location.countryCode, "TR");
    assert.equal(hotel.websiteUrl, undefined);
    assert.equal(hotel.version, 2);
    assert.equal(hotel.audit.updatedBy, "local-development");
    assert.equal(hotel.audit.updatedAt, "2026-11-05T10:00:00.000Z");
    assert.equal(hotel.key, "example-resort");
    assert.equal(hotel.status, "draft");
    assert.equal(hotel.source, "user");

    const reread = await handlers.GET(
      getRequest("hotel_01"),
      context("hotel_01"),
    );
    assert.equal((await reread.json()).hotel.name, "Updated Resort");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hotel detail API rejects stale writes without changing the record", async () => {
  const { directory, handlers } = await fixture();
  try {
    const stale = await handlers.PATCH(
      patchRequest("hotel_01", { version: 2, name: "Stale Update" }),
      context("hotel_01"),
    );
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /yeniden yükleyin/);

    const current = await handlers.GET(
      getRequest("hotel_01"),
      context("hotel_01"),
    );
    const hotel = (await current.json()).hotel;
    assert.equal(hotel.name, "Example Resort");
    assert.equal(hotel.version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hotel detail API keeps system hotels and protected fields read-only", async () => {
  const { directory, handlers, store } = await fixture();
  try {
    const systemId = "system:miramare-beach";
    const system = await handlers.PATCH(
      patchRequest(systemId, { version: 1, name: "Changed" }),
      context(systemId),
    );
    assert.equal(system.status, 403);

    const injected = await handlers.PATCH(
      patchRequest("hotel_01", { version: 1, status: "active" }),
      context("hotel_01"),
    );
    assert.equal(injected.status, 400);
    assert.match((await injected.json()).error, /beklenmeyen alan: status/);

    const keyChange = await handlers.PATCH(
      patchRequest("hotel_01", { version: 1, key: "new-key" }),
      context("hotel_01"),
    );
    assert.equal(keyChange.status, 400);

    await store.update((hotels) => ({
      hotels: hotels.map((hotel) =>
        hotel.id === "hotel_01" ? { ...hotel, status: "active" } : hotel,
      ),
      result: undefined,
    }));
    const active = await handlers.PATCH(
      patchRequest("hotel_01", { version: 1, name: "Changed" }),
      context("hotel_01"),
    );
    assert.equal(active.status, 409);
    assert.match((await active.json()).error, /active durumundayken/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hotel detail API validates identifiers, content type and origin", async () => {
  const { directory, handlers } = await fixture();
  try {
    const invalid = await handlers.GET(
      getRequest("INVALID ID"),
      context("INVALID ID"),
    );
    assert.equal(invalid.status, 400);

    const wrongType = new Request("http://localhost/api/hotels/hotel_01", {
      method: "PATCH",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ version: 1, name: "Changed" }),
    });
    assert.equal(
      (await handlers.PATCH(wrongType, context("hotel_01"))).status,
      415,
    );

    const crossOrigin = patchRequest(
      "hotel_01",
      { version: 1, name: "Changed" },
      { origin: "https://evil.test" },
    );
    assert.equal(
      (await handlers.PATCH(crossOrigin, context("hotel_01"))).status,
      403,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
