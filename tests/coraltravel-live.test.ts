import test from "node:test";
import assert from "node:assert/strict";
import type {
  ProviderDescriptor,
  ReportScopeDefinition,
} from "../src/lib/benchmark/types";
import { __coralTravelInternal as coralTravel } from "../src/lib/ota/live-coraltravel";
import { matchCoralTravelRoom } from "../src/lib/ota/coraltravel-rooms";

const provider: ProviderDescriptor = {
  key: "coraltravel",
  name: "Coral Travel",
  shortName: "Coral",
  collectionType: "api",
  liveSupported: true,
  readiness: "api-contract",
  notes: "test",
  supportedScopes: ["beach-eu"],
};

const scope: ReportScopeDefinition = {
  id: "beach-eu",
  label: "Beach Avrupa",
  hotelKey: "miramare-beach",
  hotelName: "Miramare Beach",
  marketLabel: "Avrupa",
  currency: "EUR",
  windows: [
    {
      id: "2026-11-20_2026-11-24",
      label: "20-24 Kasım",
      checkIn: "2026-11-20",
      checkOut: "2026-11-24",
      nights: 4,
    },
  ],
  rooms: [
    {
      id: "corner",
      name: "Köşe Oda",
      occupancyLabel: "2 Pax",
      referenceRates: {},
    },
    {
      id: "economy",
      name: "Ekonomi Oda",
      occupancyLabel: "2 Pax",
      referenceRates: {},
    },
    {
      id: "superior-land",
      name: "Superior Kara Manzaralı",
      occupancyLabel: "2 Pax",
      referenceRates: {},
    },
    {
      id: "superior-sea",
      name: "Superior Deniz Manzaralı",
      occupancyLabel: "2 Pax",
      referenceRates: {},
    },
  ],
};

const window = scope.windows[0];

function offer(overrides: Record<string, unknown> = {}) {
  return {
    productType: "hotelonly",
    flightOffer: null,
    tourOperator: { code: "COR" },
    hotelOffer: {
      hotel: { giata: { hotelId: "4893" } },
      roomType: {
        originalCode: "OSCB",
        originalName: "DZ Superior Corner",
      },
      boardType: { code: "AIU", name: "All Inclusive Ultra" },
    },
    travelDate: {
      fromDate: window.checkIn,
      toDate: window.checkOut,
      duration: String(window.nights),
    },
    totalPrice: { value: "926", currency: "EUR" },
    personPrice: { value: "463", currency: "EUR" },
    ...overrides,
  };
}

test("Coral Travel maps the verified Beach corner room and uses total price", () => {
  const [parsed] = coralTravel.parseOffers(
    { offerList: [offer()] },
    provider,
    scope,
    window,
    "https://coraltravel.de/offers/",
  );

  assert.equal(parsed.matchedRoomId, "corner");
  assert.equal(parsed.price, 926);
  assert.equal(parsed.rooms, 1);
  assert.equal(parsed.adults, 2);
  assert.deepEqual(parsed.roomFeatures, {
    category: "variant",
    view: "land",
    balcony: "unknown",
  });
});

test("Coral Travel uses the dynamic GIATA identity and room aliases", () => {
  const dynamicOffer = offer({
    hotelOffer: {
      ...offer().hotelOffer,
      hotel: { giata: { hotelId: "998877" } },
      roomType: {
        originalCode: "DYN-STD",
        originalName: "Dynamic Standard Land View",
      },
    },
  });
  const [parsed] = coralTravel.parseOffers(
    { offerList: [dynamicOffer] },
    provider,
    {
      ...scope,
      rooms: [
        {
          id: "dynamic-land",
          name: "Dinamik Kara Manzaralı",
          occupancyLabel: "1 oda · 2 yetişkin",
          referenceRates: {},
        },
      ],
    },
    window,
    "https://coraltravel.de/offers/",
    {
      pageUrl: "https://coraltravel.de/hotels/dynamic-hotel/",
      roomAliases: {
        "dynamic-land": ["Dynamic Standard Land View"],
      },
      matchingPolicy: {
        category: "standard",
        requireBalcony: false,
        roomByView: { land: "dynamic-land" },
      },
      coraltravel: {
        market: "de",
        giataId: "998877",
        searchQuery: "Dynamic Hotel",
        suggestion: "Dynamic Hotel",
      },
    },
  );

  assert.equal(parsed.matchedRoomId, "dynamic-land");
  assert.equal(parsed.sourceProductCode, "DYN-STD");
});

test("Coral Travel accepts only the expected hotel-only COR offer contract", () => {
  const invalidOffers = [
    offer({ productType: "pauschal" }),
    offer({ flightOffer: {} }),
    offer({ tourOperator: { code: "OTHER" } }),
    offer({
      hotelOffer: {
        ...offer().hotelOffer,
        hotel: { giata: { hotelId: "1" } },
      },
    }),
    offer({ travelDate: { ...offer().travelDate, fromDate: "2026-11-21" } }),
    offer({ travelDate: { ...offer().travelDate, duration: "5" } }),
    offer({ totalPrice: { value: "926", currency: "GBP" } }),
    offer({ totalPrice: { value: "0", currency: "EUR" } }),
    offer({ totalPrice: { value: "1000001", currency: "EUR" } }),
    offer({
      hotelOffer: {
        ...offer().hotelOffer,
        boardType: { code: "BB", name: "Breakfast" },
      },
    }),
    offer({
      hotelOffer: {
        ...offer().hotelOffer,
        boardType: { code: "UB", name: "Ultra Breakfast" },
      },
    }),
  ];

  assert.deepEqual(
    coralTravel.parseOffers(
      { offerList: invalidOffers },
      provider,
      scope,
      window,
      "https://coraltravel.de/offers/",
    ),
    [],
  );
});

test("Coral Travel keeps unverified Beach room variants out of benchmark rows", () => {
  const sideSea = matchCoralTravelRoom(
    scope,
    "DUSB",
    "DZ Superior seitl.Meerbl.",
  );
  const deluxeGarden = matchCoralTravelRoom(
    scope,
    "DGYB",
    "DZ Deluxe priv. Garten",
  );

  assert.equal(sideSea.matchedRoomId, undefined);
  assert.equal(deluxeGarden.matchedRoomId, undefined);
});

test("Coral Travel accepts only the verified Port Nature GIATA identity", () => {
  const portScope = {
    ...scope,
    id: "port-nature-eu" as const,
    hotelKey: "port-nature" as const,
    hotelName: "Port Nature Luxury Resort Hotel & Spa",
  };
  const portOffer = offer({
    hotelOffer: {
      ...offer().hotelOffer,
      hotel: { giata: { hotelId: "365454" } },
      roomType: {
        originalCode: "STD",
        originalName: "Standard Room Land View",
      },
    },
  });

  assert.equal(
    coralTravel.parseOffers(
      { offerList: [portOffer] },
      provider,
      portScope,
      window,
      "https://coraltravel.de/offers/",
    ).length,
    1,
  );
  assert.equal(
    coralTravel.parseOffers(
      {
        offerList: [
          {
            ...portOffer,
            hotelOffer: {
              ...(portOffer.hotelOffer as object),
              hotel: { giata: { hotelId: "4893" } },
            },
          },
        ],
      },
      provider,
      portScope,
      window,
      "https://coraltravel.de/offers/",
    ).length,
    0,
  );
});

test("Coral Travel builds and validates the Port Nature Russia hotel-only search", () => {
  const portRuScope: ReportScopeDefinition = {
    ...scope,
    id: "port-nature-ru",
    hotelKey: "port-nature",
    hotelName: "Port Nature Luxury Resort Hotel & Spa",
    marketLabel: "Rusya",
    currency: "RUB",
  };
  const criteria = coralTravel.buildCoralRuSearchCriteria(
    portRuScope,
    window,
  );

  assert.equal(criteria.reservationType, 2);
  assert.deepEqual(criteria.beginDates, [
    "2026-11-20T00:00:00Z",
    "2026-11-24T00:00:00Z",
  ]);
  assert.equal(criteria.arrivalLocations[0].id, "10197-7-100-6");
  assert.equal(criteria.nights[0].value, 4);
  assert.equal(criteria.roomCriterias[0].passengers.length, 2);

  const decrypted = {
    result: {
      searchCriterias: {
        reservationType: 1,
        beginDates: [window.checkIn, window.checkOut],
        nights: [{ value: window.nights }],
        arrivalLocations: [{ id: "10197-7" }],
        roomCriterias: [
          {
            passengers: [
              { passengerType: 0, age: 20 },
              { passengerType: 0, age: 20 },
            ],
          },
        ],
      },
    },
  };
  assert.equal(
    coralTravel.validateCoralRuDecryptedSearch(
      decrypted,
      portRuScope,
      window,
    ),
    true,
  );
  assert.equal(
    coralTravel.validateCoralRuDecryptedSearch(
      {
        ...decrypted,
        result: {
          searchCriterias: {
            ...decrypted.result.searchCriterias,
            reservationType: 0,
          },
        },
      },
      portRuScope,
      window,
    ),
    false,
  );
});

test("Coral Travel parses a verified Port Nature Russia RUB hotel-only offer", () => {
  const portRuScope: ReportScopeDefinition = {
    ...scope,
    id: "port-nature-ru",
    hotelKey: "port-nature",
    hotelName: "Port Nature Luxury Resort Hotel & Spa",
    marketLabel: "Rusya",
    currency: "RUB",
    rooms: [
      {
        id: "standard-land",
        name: "Standart Kara Manzaralı",
        occupancyLabel: "1 oda · 2 yetişkin",
        referenceRates: {},
      },
    ],
  };
  const parsed = coralTravel.parseCoralRuOffers(
    {
      result: {
        rooms: { "48127": { name: "Standard Room Land View" } },
        meals: { ai: { name: "Все включено" } },
        products: [
          {
            hotel: { id: "10197", name: "PORT NATURE LUXURY RESORT HOTEL & SPA" },
            offers: [
              {
                checkInDate: `${window.checkIn}T00:00:00Z`,
                checkOutDate: `${window.checkOut}T00:00:00Z`,
                stayNights: window.nights,
                flight: null,
                price: { amount: 250000, currency: "RUB" },
                rooms: [
                  {
                    roomKey: "48127",
                    mealKey: "ai",
                    passengers: [
                      { passengerType: 0 },
                      { passengerType: 0 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    provider,
    portRuScope,
    window,
    "https://www.coral.ru/hotels/turkey/port-nature-luxury-resort-hotel-spa-belek/",
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].currency, "RUB");
  assert.equal(parsed[0].price, 250000);
  assert.equal(parsed[0].matchedRoomId, "standard-land");
});
