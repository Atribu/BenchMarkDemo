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
