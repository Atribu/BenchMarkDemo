import test from "node:test";
import assert from "node:assert/strict";
import { HOTEL_CATALOG } from "../src/lib/hotels/catalog";
import { createHotelDraft } from "../src/lib/hotels/model";
import {
  createHotelReadRepository,
  systemHotelRecord,
} from "../src/lib/hotels/repository";

function draft(id = "hotel_01", key = "example-resort") {
  return createHotelDraft({
    id,
    key,
    name: "Example Resort",
    shortCode: "ER",
    location: { countryCode: "TR", city: "Antalya", region: "Kemer" },
    createdBy: "admin@example.com",
    now: "2026-11-05T09:00:00.000Z",
  });
}

test("repository exposes the existing catalog as unchanged active system hotels", () => {
  const repository = createHotelReadRepository();
  const hotels = repository.list();

  assert.deepEqual(
    hotels.map((hotel) => hotel.key),
    HOTEL_CATALOG.map((hotel) => hotel.key),
  );
  assert.ok(hotels.every((hotel) => hotel.source === "system"));
  assert.ok(hotels.every((hotel) => hotel.status === "active"));
  assert.deepEqual(
    repository.findByKey("port-nature")?.markets.map((market) => market.id),
    ["port-nature-eu", "port-nature-uk", "port-nature-ru"],
  );
  assert.equal(
    repository.findById("system:miramare-beach")?.rooms.length,
    4,
  );
  assert.equal(repository.listForBenchmark().length, HOTEL_CATALOG.length);
});

test("system catalog conversion preserves metadata without moving channel config", () => {
  const hotel = systemHotelRecord(HOTEL_CATALOG[0]);

  assert.deepEqual(hotel.location, {
    countryCode: "TR",
    city: "Antalya",
    region: "Side",
  });
  assert.deepEqual(hotel.rooms[0].occupancy, {
    rooms: 1,
    adults: 2,
    children: 0,
  });
  assert.deepEqual(hotel.channelMappings, []);
  assert.equal(hotel.audit.createdAt, null);
});

test("repository merges user drafts without exposing them to benchmark queries", () => {
  const repository = createHotelReadRepository([draft()]);

  assert.equal(repository.list().length, HOTEL_CATALOG.length + 1);
  assert.equal(repository.findByKey("example-resort")?.status, "draft");
  assert.equal(repository.listForBenchmark().length, HOTEL_CATALOG.length);
});

test("repository hides archived hotels by default and can list them for management", () => {
  const archived = {
    ...draft(),
    status: "archived" as const,
    audit: {
      ...draft().audit,
      archivedAt: "2026-11-05T10:00:00.000Z",
    },
  };
  const repository = createHotelReadRepository([archived]);

  assert.equal(repository.list().some((hotel) => hotel.id === archived.id), false);
  assert.equal(
    repository
      .list({ includeArchived: true })
      .some((hotel) => hotel.id === archived.id),
    true,
  );
});

test("repository never lets a user record replace a system hotel", () => {
  assert.throws(
    () => createHotelReadRepository([draft("system:miramare-beach")]),
    /Otel kimliği zaten kullanılıyor/,
  );
  assert.throws(
    () => createHotelReadRepository([draft("hotel_02", "miramare-beach")]),
    /Otel anahtarı zaten kullanılıyor/,
  );
});

test("repository rejects records that impersonate the system source", () => {
  assert.throws(
    () =>
      createHotelReadRepository([
        { ...draft(), source: "system" },
      ]),
    /kaynağı kullanıcı olmalıdır/,
  );
});
