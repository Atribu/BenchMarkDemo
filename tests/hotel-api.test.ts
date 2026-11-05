import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileHotelStore } from "../src/lib/hotels/file-store";
import { createHotelRouteHandlers } from "../app/api/hotels/route-handlers";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hotel-api-"));
  const handlers = createHotelRouteHandlers({
    store: createFileHotelStore(directory),
    generateId: () => "00000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-11-05T09:00:00.000Z"),
  });
  return { directory, handlers };
}

function request(
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/hotels", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const validHotel = {
  key: "example-resort",
  name: " Example Resort ",
  shortCode: "er",
  location: {
    countryCode: "tr",
    city: "Antalya",
    region: "Kemer",
  },
  websiteUrl: "https://example.com",
};

test("hotel API lists system hotels and creates a persistent draft", async () => {
  const { directory, handlers } = await fixture();
  try {
    const before = await handlers.GET(request());
    assert.equal(before.status, 200);
    assert.equal((await before.json()).hotels.length, 4);

    const created = await handlers.POST(request(validHotel));
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("cache-control"), "no-store");
    const payload = await created.json();
    assert.equal(payload.hotel.id, "hotel_00000000000040008000000000000001");
    assert.equal(payload.hotel.name, "Example Resort");
    assert.equal(payload.hotel.shortCode, "ER");
    assert.equal(payload.hotel.location.countryCode, "TR");
    assert.equal(payload.hotel.status, "draft");
    assert.equal(payload.hotel.source, "user");
    assert.deepEqual(payload.hotel.markets, []);
    assert.equal(
      created.headers.get("location"),
      `/api/hotels/${payload.hotel.id}`,
    );

    const after = await handlers.GET(request());
    assert.equal((await after.json()).hotels.length, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hotel API rejects duplicate system and user keys", async () => {
  const { directory, handlers } = await fixture();
  try {
    const systemConflict = await handlers.POST(
      request({ ...validHotel, key: "miramare-beach" }),
    );
    assert.equal(systemConflict.status, 409);

    assert.equal((await handlers.POST(request(validHotel))).status, 201);
    const userConflict = await handlers.POST(request(validHotel));
    assert.equal(userConflict.status, 409);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hotel API rejects lifecycle injection and malformed input", async () => {
  const { directory, handlers } = await fixture();
  try {
    const injected = await handlers.POST(
      request({ ...validHotel, status: "active" }),
    );
    assert.equal(injected.status, 400);
    assert.match((await injected.json()).error, /beklenmeyen alan: status/);

    const invalidKey = await handlers.POST(
      request({ ...validHotel, key: "Invalid Hotel" }),
    );
    assert.equal(invalidKey.status, 400);
    const invalidUrl = await handlers.POST(
      request({ ...validHotel, websiteUrl: "http://example.com" }),
    );
    assert.equal(invalidUrl.status, 400);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hotel API enforces content type and same-origin writes", async () => {
  const { directory, handlers } = await fixture();
  try {
    const wrongType = new Request("http://localhost/api/hotels", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(validHotel),
    });
    assert.equal((await handlers.POST(wrongType)).status, 415);

    const crossOrigin = request(validHotel, { origin: "https://evil.test" });
    assert.equal((await handlers.POST(crossOrigin)).status, 403);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
