import test from "node:test";
import assert from "node:assert/strict";
import { HOTEL_CATALOG, getHotelDefinition } from "../src/lib/hotels/catalog";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import {
  ANEX_HOTEL_CONFIG,
  BOOKING_HOTEL_CONFIG,
  CHECK24_HOTEL_CONFIG,
  CORALTRAVEL_HOTEL_CONFIG,
  EXPEDIA_HOTEL_CONFIG,
  HOLIDAYCHECK_HOTEL_CONFIG,
  ONTHEBEACH_HOTEL_CONFIG,
} from "../src/lib/ota/live-config";
import { GOOGLE_HOTEL_IDS } from "../src/lib/ota/google-hotel-config";
import {
  matchAnexRoom,
  parseAnexRuOffers,
} from "../src/lib/ota/live-anextour";
import { classifyRoom, matchOfferRoom } from "../src/lib/ota/offer-matching";
import { PEGAS_HOTEL_CONFIG } from "../src/lib/ota/live-pegastour";

const portNature = REPORT_SCOPES.find(
  (scope) => scope.id === "port-nature-eu",
)!;
const portNatureUk = REPORT_SCOPES.find(
  (scope) => scope.id === "port-nature-uk",
)!;
const portNatureRu = REPORT_SCOPES.find(
  (scope) => scope.id === "port-nature-ru",
)!;

test("hotel catalog generates unique report scopes and complete hotel metadata", () => {
  assert.equal(new Set(HOTEL_CATALOG.map((hotel) => hotel.key)).size, 4);
  assert.equal(new Set(REPORT_SCOPES.map((scope) => scope.id)).size, 10);
  assert.equal(getHotelDefinition("port-nature").shortCode, "PN");
  assert.equal(portNature.hotelName, "Port Nature Luxury Resort Hotel & Spa");
  assert.equal(portNature.currency, "EUR");
  assert.equal(portNature.requiredBoard, "all-inclusive");
  assert.equal(portNatureUk.hotelKey, "port-nature");
  assert.equal(portNatureUk.currency, "GBP");
  assert.equal(portNatureRu.hotelKey, "port-nature");
  assert.equal(portNatureRu.currency, "RUB");
  assert.deepEqual(
    portNature.rooms.map((room) => room.id),
    [
      "standard-land",
      "standard-side-sea",
      "standard-sea",
      "family",
      "king-suite",
    ],
  );
  assert.equal(getHotelDefinition("sy-hotels-belek").shortCode, "SY");
  assert.deepEqual(
    REPORT_SCOPES.find((scope) => scope.id === "sy-hotels-eu")?.rooms.map(
      (room) => room.id,
    ),
    [
      "deluxe-land",
      "deluxe-pool",
      "deluxe-superior",
      "deluxe-family",
      "deluxe-duplex-family",
      "deluxe-swim-up",
      "deluxe-family-swim-up",
      "deluxe-shallow-pool",
    ],
  );
});

test("Port Nature routes Russian providers to the RUB scope", () => {
  const europeanProviders = OTA_PROVIDERS.filter((provider) =>
    provider.supportedScopes.includes("port-nature-eu"),
  );
  assert.deepEqual(
    europeanProviders.map((provider) => provider.key),
    [
      "anextour",
      "booking",
      "check24",
      "expedia",
      "holidaycheck",
      "restplatzboerse",
      "stayforlong",
    ],
  );
  assert.deepEqual(
    OTA_PROVIDERS.filter((provider) =>
      provider.supportedScopes.includes("port-nature-ru"),
    ).map((provider) => provider.key),
    ["anextour", "pegastour", "coraltravel"],
  );
  assert.equal(ANEX_HOTEL_CONFIG["port-nature"]?.accommodationId, "136301");
  assert.equal(ANEX_HOTEL_CONFIG["port-nature"]?.ruHotelId, "8356");
  assert.equal(CORALTRAVEL_HOTEL_CONFIG["port-nature"]?.currency, "RUB");
  assert.equal(PEGAS_HOTEL_CONFIG["port-nature"].hotelId, 6609069);
  assert.ok(
    OTA_PROVIDERS.find((provider) => provider.key === "onthebeach")
      ?.supportedScopes.includes("port-nature-uk"),
  );
});

test("SY Hotels exposes only channels with a verified hotel identity", () => {
  assert.deepEqual(
    OTA_PROVIDERS.filter((provider) =>
      provider.supportedScopes.includes("sy-hotels-eu"),
    ).map((provider) => provider.key),
    [
      "booking",
      "check24",
      "expedia",
      "holidaycheck",
      "restplatzboerse",
      "tui",
      "schauinsland",
    ],
  );
  assert.deepEqual(
    OTA_PROVIDERS.filter((provider) =>
      provider.supportedScopes.includes("sy-hotels-uk"),
    ).map((provider) => provider.key),
    ["booking", "expedia", "onthebeach"],
  );
  assert.deepEqual(
    OTA_PROVIDERS.filter((provider) =>
      provider.supportedScopes.includes("sy-hotels-ru"),
    ).map((provider) => provider.key),
    ["pegastour"],
  );
  assert.equal(
    CHECK24_HOTEL_CONFIG["sy-hotels-belek"].accommodationId,
    "019ab53308e673799d4d0b164fb80e79",
  );
});

test("Port Nature ANEX room names map through provider configuration", () => {
  const cases = [
    ["Doppelzimmer Standard Landblick", "standard-land"],
    ["Doppelzimmer Standard seitl. Meerblick", "standard-side-sea"],
    ["Doppelzimmer Standard Meerblick", "standard-sea"],
    ["Familienzimmer", "family"],
    ["FZ. seitl. Meerblick (2 Zimmer", "family"],
    ["King Suite", "king-suite"],
  ] as const;

  for (const [name, roomId] of cases) {
    assert.equal(matchAnexRoom(portNature, name)?.id, roomId, name);
  }
  assert.equal(matchAnexRoom(portNature, "Economy Promo Room"), undefined);
});

test("ANEX Russia accepts only the exact Port Nature RUB hotel-only stay", () => {
  const result = parseAnexRuOffers(
    [
      {
        result: [
          {
            price: [
              {
                hotelInc: 8356,
                checkIn: "2026-10-31",
                checkOut: "2026-11-05",
                nights: 5,
                adult: 2,
                converted_price: 116600,
                roomName: "Standard Room Land View",
                mealName: "Ультра все включено",
              },
              {
                hotelInc: 9999,
                checkIn: "2026-10-31",
                checkOut: "2026-11-05",
                nights: 5,
                adult: 2,
                converted_price: 1,
                roomName: "Wrong Hotel",
                mealName: "Все включено",
              },
            ],
          },
        ],
      },
    ],
    {
      hotelId: "8356",
      checkIn: "2026-10-31",
      checkOut: "2026-11-05",
      nights: 5,
    },
  );

  assert.deepEqual(result, [
    {
      roomName: "Standard Room Land View",
      board: "Ультра все включено",
      price: 116600,
    },
  ]);
});

test("Port Nature supports its official side-sea room without weakening other hotels", () => {
  assert.equal(
    matchOfferRoom(
      portNature,
      classifyRoom("Standard Room with Side Sea View Balcony"),
    ).matchedRoomId,
    "standard-side-sea",
  );
  const beach = REPORT_SCOPES.find((scope) => scope.id === "beach-eu")!;
  assert.equal(
    matchOfferRoom(
      beach,
      classifyRoom("Superior Room with Side Sea View Balcony"),
    ).matchedRoomId,
    undefined,
  );
});

test("known Port Nature property identities stay separate from live enablement", () => {
  assert.match(BOOKING_HOTEL_CONFIG["port-nature"]!.pageUrl, /port-nature/);
  assert.match(
    HOLIDAYCHECK_HOTEL_CONFIG["port-nature"]!.pageUrl,
    /6a10924b-2286-3a46-b5db-ad9802b8d226/,
  );
  assert.equal(CHECK24_HOTEL_CONFIG["port-nature"].hotelId, "8393120");
  assert.equal(CORALTRAVEL_HOTEL_CONFIG["port-nature"]?.giataId, "365454");
  assert.match(EXPEDIA_HOTEL_CONFIG["port-nature"]!.pageUrl, /h8108100/);
  assert.match(
    ONTHEBEACH_HOTEL_CONFIG["port-nature"]!.pageUrl,
    /port-nature-luxury-resort-hotel-spa/,
  );
  assert.equal(GOOGLE_HOTEL_IDS["port-nature"], "CgsI8rbHj9SO5K6aARAB");
});
