import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPegasSearchPayload,
  matchPegasRoom,
  parsePegasHotelOnlyOffers,
  PEGAS_HOTEL_CONFIG,
} from "../src/lib/ota/live-pegastour";

const window = {
  id: "2027-05-10_2027-05-15",
  label: "10–15 Mayıs 2027",
  checkIn: "2027-05-10",
  checkOut: "2027-05-15",
  nights: 5,
};

function price(raw: number, currency = "RUB") {
  return {
    paymentCurrency: {
      raw,
      formatted:
        currency === "RUB" ? `${raw.toLocaleString("ru-RU")} ₽` : `€${raw}`,
      parts: {
        currency: { code: currency, symbol: currency === "RUB" ? "₽" : "€" },
      },
    },
  };
}

const response = {
  ok: true,
  data: {
    startDate: "2027-05-10T00:00:00Z",
    endDate: "2027-05-15T00:00:00Z",
    duration: 5,
    hotel: { hotelId: 6609069 },
    referenceDescription: {
      roomCategories: [
        { id: 8280, name: "Land View" },
        { id: 8395, name: "Side Sea View" },
        { id: 9001, name: "Sea View" },
        { id: 17303, name: "Семейный номер" },
        { id: 5869, name: "Королевский Сьют" },
      ],
      hotelBoardTypes: [
        { id: 1, name: "Ультра все включено" },
        { id: 2, name: "Завтрак" },
      ],
    },
    accommodationOptions: [
      {
        rooms: [
          {
            roomCategoryId: 8280,
            options: [
              {
                id: "land-ai",
                boardTypeId: 1,
                boardTypeCode: "UAI",
                pricePerStay: price(145000),
                pricePerNight: price(29000),
              },
              {
                id: "land-breakfast",
                boardTypeId: 2,
                boardTypeCode: "BB",
                pricePerStay: price(100000),
              },
              {
                id: "land-eur",
                boardTypeId: 1,
                boardTypeCode: "UAI",
                pricePerStay: price(1500, "EUR"),
              },
            ],
          },
        ],
      },
      {
        rooms: [
          {
            roomCategoryId: 8395,
            options: [
              {
                id: "side-ai",
                boardTypeId: 1,
                boardTypeCode: "UAI",
                pricePerStay: price(150000),
              },
            ],
          },
        ],
      },
    ],
  },
};

test("Pegas uses the official Port Nature hotel-only identity and exact stay", () => {
  assert.deepEqual(PEGAS_HOTEL_CONFIG["port-nature"], {
    hotelId: 6609069,
    locationId: 7192,
    hotelName: "Port Nature Luxury Resort Hotel & Spa",
    pageUrl:
      "https://pegast.ru/hotel/turkey/antalya/belek/port-nature-luxury-resort-hotel-and-spa-6609069",
  });
  assert.deepEqual(buildPegasSearchPayload(6609069, window), {
    hotel: {
      countryIds: [],
      regionIds: [],
      locationIds: [],
      locationAreaIds: [],
      hotelsOutsideAreasLocationIds: [],
      hotelIds: [6609069],
    },
    startDates: ["2027-05-10"],
    durations: [5],
    roomAccommodations: [{ adults: 2, childrenAges: [] }],
  });
});

test("Pegas accepts only RUB All Inclusive pricePerStay totals", () => {
  const offers = parsePegasHotelOnlyOffers(response, {
    hotelId: 6609069,
    checkIn: window.checkIn,
    checkOut: window.checkOut,
    nights: window.nights,
  });
  assert.deepEqual(
    offers.map((offer) => ({
      id: offer.optionId,
      price: offer.totalPrice,
      room: offer.matchedRoomId,
      currency: offer.currency,
    })),
    [
      { id: "land-ai", price: 145000, room: "standard-land", currency: "RUB" },
      { id: "side-ai", price: 150000, room: "standard-side-sea", currency: "RUB" },
    ],
  );
});

test("Pegas keeps Port Nature room categories distinct", () => {
  assert.equal(matchPegasRoom("Land View"), "standard-land");
  assert.equal(matchPegasRoom("Side Sea View"), "standard-side-sea");
  assert.equal(matchPegasRoom("Номер с видом на море"), "standard-sea");
  assert.equal(matchPegasRoom("Семейный номер"), "family");
  assert.equal(matchPegasRoom("Королевский Сьют"), "king-suite");
});

test("Pegas uses SY Hotels' verified identity and distinct room aliases", () => {
  assert.equal(PEGAS_HOTEL_CONFIG["sy-hotels-belek"].hotelId, 816187159);
  const cases = [
    ["Deluxe Land View", "deluxe-land"],
    ["Deluxe Pool View", "deluxe-pool"],
    ["Deluxe Superior", "deluxe-superior"],
    ["Deluxe Family Room", "deluxe-family"],
    ["Deluxe Duplex Family Room", "deluxe-duplex-family"],
    ["Deluxe Swim Up", "deluxe-swim-up"],
    ["Deluxe Family Swim Up", "deluxe-family-swim-up"],
    ["Deluxe Shallow Pool", "deluxe-shallow-pool"],
  ] as const;

  for (const [roomName, roomId] of cases) {
    assert.equal(
      matchPegasRoom(roomName, "sy-hotels-belek"),
      roomId,
      roomName,
    );
  }
});

test("Pegas rejects a different hotel or stay", () => {
  assert.throws(
    () =>
      parsePegasHotelOnlyOffers(response, {
        hotelId: 1,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
      }),
    /otel benchmark oteliyle eşleşmiyor/,
  );
  assert.throws(
    () =>
      parsePegasHotelOnlyOffers(response, {
        hotelId: 6609069,
        checkIn: "2027-05-11",
        checkOut: "2027-05-16",
        nights: 5,
      }),
    /tarihler benchmark aralığıyla eşleşmiyor/,
  );
});

test("Pegas treats a verified empty response as no availability", () => {
  assert.deepEqual(
    parsePegasHotelOnlyOffers(
      {
        ok: true,
        data: {
          startDate: "2027-05-10",
          endDate: "2027-05-15",
          duration: 5,
          hotel: { hotelId: 6609069 },
          referenceDescription: {},
          accommodationOptions: [],
        },
      },
      {
        hotelId: 6609069,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
      },
    ),
    [],
  );
});

test("Pegas treats its live empty-response shape with hotel null as no availability", () => {
  assert.deepEqual(
    parsePegasHotelOnlyOffers(
      {
        ok: true,
        data: {
          startDate: "2027-05-10T00:00:00",
          duration: 5,
          hotel: null,
          accommodationOptions: [],
          referenceDescription: {},
        },
      },
      {
        hotelId: 816187159,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
        hotelKey: "sy-hotels-belek",
      },
    ),
    [],
  );
});
