import test from "node:test";
import assert from "node:assert/strict";
import type { Check24ParsedOffer } from "../src/lib/ota/check24-parser";
import {
  validateCheck24BeachOffer,
  validateCheck24PortNatureOffer,
  validateCheck24QueenOffer,
  validateCheck24SyHotelsOffer,
} from "../src/lib/ota/check24-room-validation";
import { buildCheck24HotelSearchUrl } from "../src/lib/ota/live-check24";

function offer(
  roomName: string,
  patch: Partial<Check24ParsedOffer> = {},
): Check24ParsedOffer {
  return {
    offerId: `offer-${roomName}`,
    roomName,
    roomCategoryName: "Doppelzimmer",
    roomOccupancy: "[A|A]",
    mealType: "all_inclusive",
    supplierName: "DERTOUR",
    totalPrice: 1038,
    currency: "EUR",
    nights: 5,
    taxesIncluded: true,
    source: "rate",
    sourceRoomDescription: roomName,
    ...patch,
  };
}

test("CHECK24 exact superior views become matched room prices", () => {
  const land = validateCheck24BeachOffer(
    offer("Doppelzimmer Superior Landblick"),
    5,
  );
  const sea = validateCheck24BeachOffer(
    offer("Doppelzimmer Superior Meerblick", { totalPrice: 1120 }),
    5,
  );

  assert.equal(land.status, "matched");
  assert.equal(land.roomId, "superior-land");
  assert.equal(sea.status, "matched");
  assert.equal(sea.roomId, "superior-sea");
});

test("CHECK24 ambiguous room equivalence stays outside matched prices", () => {
  const economy = validateCheck24BeachOffer(
    offer("Doppelzimmer Economy", { totalPrice: 1012 }),
    5,
  );
  const corner = validateCheck24BeachOffer(
    offer("Superior Corner Room", { totalPrice: 1443.4 }),
    5,
  );
  const partialSea = validateCheck24BeachOffer(
    offer("Doppelzimmer Superior seitlicher Meerblick"),
    5,
  );

  assert.equal(economy.status, "manual-review");
  assert.equal(corner.status, "manual-review");
  assert.equal(partialSea.status, "rejected");
});

test("CHECK24 rejects mismatched stay and board details", () => {
  assert.equal(
    validateCheck24BeachOffer(
      offer("Doppelzimmer Superior Landblick", { nights: 4 }),
      5,
    ).status,
    "rejected",
  );
  assert.equal(
    validateCheck24BeachOffer(
      offer("Doppelzimmer Superior Landblick", { mealType: "breakfast" }),
      5,
    ).status,
    "rejected",
  );
});

test("CHECK24 maps verified Port Nature room labels", () => {
  const cases = [
    ["Doppelzimmer mit Landblick", "standard-land"],
    ["Doppelzimmer Standard seitl. Meerblick", "standard-side-sea"],
    ["Doppelzimmer Standard Meerblick", "standard-sea"],
    ["Familienzimmer seitl. MB", "family"],
    ["King Suite", "king-suite"],
  ] as const;

  for (const [roomName, roomId] of cases) {
    const result = validateCheck24PortNatureOffer(offer(roomName), 5);
    assert.equal(result.status, "matched", roomName);
    assert.equal(result.roomId, roomId, roomName);
  }
});

test("CHECK24 Port Nature keeps generic and invalid-board rooms outside coverage", () => {
  assert.equal(
    validateCheck24PortNatureOffer(offer("Doppelzimmer"), 5).status,
    "rejected",
  );
  assert.equal(
    validateCheck24PortNatureOffer(
      offer("Doppelzimmer mit Landblick", { mealType: "breakfast" }),
      5,
    ).status,
    "rejected",
  );
});

test("CHECK24 builds a dated Port Nature hotel-only search", () => {
  assert.equal(
    buildCheck24HotelSearchUrl(
      { hotelId: "8393120", hotelName: "Port Nature Luxury Resort" },
      "2026-10-31",
      "2026-11-05",
    ),
    "https://hotel.check24.de/search/Port%20Nature%20Luxury%20Resort-8393120/2026-10-31/2026-11-05/%5BA%7CA%5D/hotel.html",
  );
});

test("CHECK24 Queen maps only explicit land and full-sea standard rooms", () => {
  const land = validateCheck24QueenOffer(
    offer("Doppelzimmer Standard Landblick"),
    5,
  );
  const sea = validateCheck24QueenOffer(
    offer("Standardzimmer, Meerblick", { totalPrice: 1044 }),
    5,
  );
  assert.equal(land.status, "matched");
  assert.equal(land.roomId, "standard-land");
  assert.equal(sea.status, "matched");
  assert.equal(sea.roomId, "standard-sea");

  for (const roomName of [
    "Standardzimmer",
    "DZ=EZ seitl. Meerblick",
    "Doppelzimmer Superior",
    "Familienzimmer",
    "Suite Room with Sea View",
  ]) {
    assert.equal(
      validateCheck24QueenOffer(offer(roomName), 5).status,
      "rejected",
      roomName,
    );
  }
});

test("CHECK24 builds Queen's numeric entry route while validating its modern identity", () => {
  assert.equal(
    buildCheck24HotelSearchUrl(
      {
        hotelId: "8571549",
        hotelName: "Miramare Queen Hotel - Ultra All Inclusive",
        accommodationId: "019ab52936e17297ae2c11519fcc3f33",
      },
      "2027-05-10",
      "2027-05-15",
    ),
    "https://hotel.check24.de/search/Miramare%20Queen%20Hotel%20-%20Ultra%20All%20Inclusive-8571549/2027-05-10/2027-05-15/%5BA%7CA%5D/hotel.html",
  );
});

test("CHECK24 maps all verified SY Hotels room categories", () => {
  const cases = [
    ["Doppelzimmer mit Landblick", "deluxe-land"],
    ["Doppelzimmer, Poolblick", "deluxe-pool"],
    ["Dz Superior Deluxe", "deluxe-superior"],
    ["DELUXE FAMILY ROOM", "deluxe-family"],
    ["DELUXE DUPLEX FAMILY ROOM", "deluxe-duplex-family"],
    ["Doppelzimmer Swim Up", "deluxe-swim-up"],
    [
      "Deluxe Family Room with Swim Up Pool and Terrace",
      "deluxe-family-swim-up",
    ],
    ["Dz Shallow Pool", "deluxe-shallow-pool"],
  ] as const;

  for (const [roomName, roomId] of cases) {
    const result = validateCheck24SyHotelsOffer(offer(roomName), 5);
    assert.equal(result.status, "matched", roomName);
    assert.equal(result.roomId, roomId, roomName);
  }

  assert.equal(
    validateCheck24SyHotelsOffer(offer("Deluxe Accessible Room"), 5).status,
    "rejected",
  );
});
