import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import {
  buildRestplatzboersePayload,
  buildRestplatzboerseSourceUrl,
  collectRestplatzboerseLiveQuotes,
  matchRestplatzboerseRoom,
  parseRestplatzboerseOffers,
  parseVerifiedRestplatzboerseOffer,
  RESTPLATZBOERSE_HOTEL_CONFIG,
} from "../src/lib/ota/live-restplatzboerse";

const window = {
  id: "2027-05-10_2027-05-17",
  label: "10–17 Mayıs 2027",
  checkIn: "2027-05-10",
  checkOut: "2027-05-17",
  nights: 7,
};

const searchOffer = {
  Name: "Port Nature Luxury Resort Hotel & Spa",
  Category: 5,
  StartDate: "2027-05-10T00:00:00",
  EndDate: "2027-05-17T00:00:00",
  OvernightStays: 7,
  TourOperator: { Code: "FER", Name: "FERIEN Touristik" },
  Price: 753,
  CurrencyCode: "EUR",
  OriginalPrice: 753,
  OriginalCurrencyCode: "EUR",
  Pricing: {
    Single: { Amount: 753, Converted: null },
    Total: { Amount: 1506, Converted: null },
    Type: "AveragePerson",
  },
  Room: {
    Type: "DoubleRoom",
    Name: "Doppelzimmer Landbl.",
    View: "NothingSpecial",
    Code: "2NVB",
  },
  BoardType: "AllInclusiveSuperior",
  OfferID: "verified-offer-id",
  OfferCode: "AYT2162",
};

const expected = {
  hotelKey: "port-nature" as const,
  hotelName: "Port Nature Luxury Resort Hotel & Spa",
  checkIn: "2027-05-10",
  checkOut: "2027-05-17",
  nights: 7,
};

test("Restplatzbörse request fixes exact hotel-only stay and two adults", () => {
  assert.deepEqual(buildRestplatzboersePayload(136301, window), {
    CurrencyCode: "EUR",
    RoomViews: [],
    HotelIffCode: 136301,
    StartDate: "2027-05-10",
    EndDate: "2027-05-17",
    Adults: 2,
    Children: [],
    MinDuration: 7,
    MaxDuration: 7,
    BoardTypes: [],
    RoomTypes: [],
    Transfer: [],
    DefiniteStartDate: true,
    NumberOfResults: 20,
    TourOperatorCodes: [],
    TravelType: "Accommodation",
  });
  const url = new URL(buildRestplatzboerseSourceUrl(136301, window));
  assert.equal(url.pathname, "/hotel/136301/");
  assert.equal(url.searchParams.get("ibe"), "hotel");
  assert.equal(url.searchParams.get("adult"), "2");
  assert.equal(url.searchParams.get("ddate"), window.checkIn);
  assert.equal(url.searchParams.get("rdate"), window.checkOut);
});

test("Restplatzbörse parser uses the two-adult total, never the per-person price", () => {
  const parsed = parseRestplatzboerseOffers(
    { Offers: [searchOffer], _links: {} },
    expected,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].totalPrice, 1506);
  assert.equal(parsed[0].matchedRoomId, "standard-land");

  assert.deepEqual(
    parseRestplatzboerseOffers(
      {
        Offers: [
          { ...searchOffer, Name: "Wrong Hotel" },
          { ...searchOffer, EndDate: "2027-05-18T00:00:00" },
          { ...searchOffer, CurrencyCode: "GBP" },
          {
            ...searchOffer,
            Pricing: {
              ...searchOffer.Pricing,
              Total: { Amount: 753, Converted: null },
            },
          },
        ],
      },
      expected,
    ),
    [],
  );
});

test("Restplatzbörse keeps regular All Inclusive separate from All Inclusive Plus", () => {
  const regular = {
    ...searchOffer,
    BoardType: "AllInclusive",
    OfferID: "regular-all-inclusive-id",
  };
  const candidate = parseRestplatzboerseOffers(
    { Offers: [regular] },
    expected,
  )[0];
  assert.equal(candidate.boardCode, "AllInclusive");
  assert.equal(
    parseVerifiedRestplatzboerseOffer(
      {
        Status: "Available",
        Available: true,
        Offer: {
          TravelType: "Accommodation",
          StartDate: "2027-05-10T00:00:00",
          EndDate: "2027-05-17T00:00:00",
          TourOperator: { Code: "FER", Name: "FERIEN Touristik" },
          Price: "1506.84",
          TravellerAmount: 2,
          Travellers: [{ Qualifier: "ADULT" }, { Qualifier: "ADULT" }],
          CurrencyCode: "EUR",
          Room: { Name: "Doppelzimmer Landbl.", Code: "2NVB" },
          BoardType: "ALLINCLUSIVE",
          OfferID: "regular-all-inclusive-id",
          OfferCode: "AYT2162",
          OvernightStays: 7,
        },
      },
      candidate,
    ),
    1506.84,
  );
});

test("Restplatzbörse Port Nature room semantics map without guessing generic rooms", () => {
  assert.equal(
    matchRestplatzboerseRoom(
      "port-nature",
      "Doppelzimmer Landbl.",
      "2NVB",
      "DoubleRoom",
      "NothingSpecial",
    ),
    "standard-land",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "port-nature",
      "Doppelzimmer seitl.Meerbl.",
      "DZSB",
      "DoubleRoom",
      "PartialOcean",
    ),
    "standard-side-sea",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "port-nature",
      "Doppelzimmer Meerblick",
      "719Q",
      "DoubleRoom",
      "FullOcean",
    ),
    "standard-sea",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "port-nature",
      "Familienzimmer seitl. MB",
      "F4SQ",
      "FamilyRoom",
      "PartialOcean",
    ),
    "family",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "port-nature",
      "Suite King",
      "KS Q",
      "Suite",
      "NothingSpecial",
    ),
    "king-suite",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "port-nature",
      "Doppelzimmer",
      "D01A",
      "DoubleRoom",
      "NothingSpecial",
    ),
    undefined,
  );
});

test("Restplatzbörse official hotel identities include both Miramare hotels", () => {
  assert.deepEqual(RESTPLATZBOERSE_HOTEL_CONFIG["miramare-beach"], {
    hotelIffCode: 1708,
    hotelName: "Miramare Beach Hotel",
  });
  assert.deepEqual(RESTPLATZBOERSE_HOTEL_CONFIG["miramare-queen"], {
    hotelIffCode: 17048,
    hotelName: "Miramare Queen Hotel",
  });
});

test("Restplatzbörse maps Miramare rooms without upgrading side-sea or balcony-free rooms", () => {
  assert.equal(
    matchRestplatzboerseRoom(
      "miramare-beach",
      "Doppelzimmer Economy",
      "ECOQ",
      "DoubleRoom",
      "NothingSpecial",
    ),
    "economy",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "miramare-beach",
      "Doppelzimmer Superior,Landseite,Klimaanlage,Dusche,Balkon",
      "DSPS",
      "DoubleRoom",
      "NothingSpecial",
    ),
    "superior-land",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "miramare-beach",
      "Doppelzimmer Superior",
      "DSU3",
      "DoubleRoom",
      "NothingSpecial",
    ),
    undefined,
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "miramare-beach",
      "Superior Land View Best Price without Balcony",
      "DZX8 A",
      "DoubleRoom",
      "NothingSpecial",
    ),
    undefined,
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "miramare-beach",
      "Doppelzimmer Superior,seitl. Meerblick,Klimaanlage,Dusche,Balkon",
      "DSMS",
      "DoubleRoom",
      "PartialOcean",
    ),
    undefined,
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "miramare-queen",
      "Doppelzimmer",
      "D  3",
      "DoubleRoom",
      "NothingSpecial",
    ),
    "standard-land",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "miramare-queen",
      "Doppelzimmer Meerblick",
      "DM 3",
      "DoubleRoom",
      "FullOcean",
    ),
    "standard-sea",
  );
  assert.equal(
    matchRestplatzboerseRoom(
      "miramare-queen",
      "DZ seitl. Meerblick",
      "DMS3",
      "DoubleRoom",
      "PartialOcean",
    ),
    undefined,
  );
});

test("Restplatzbörse verify-offer must preserve stay, room, operator and board", () => {
  const candidate = parseRestplatzboerseOffers(
    { Offers: [searchOffer] },
    expected,
  )[0];
  const verified = {
    Status: "Available",
    Available: true,
    Offer: {
      TravelType: "Accommodation",
      StartDate: "2027-05-10T00:00:00",
      EndDate: "2027-05-17T00:00:00",
      TourOperator: { Code: "FER", Name: "FERIEN Touristik" },
      Price: "1506.84",
      TravellerAmount: 2,
      Travellers: [{ Qualifier: "ADULT" }, { Qualifier: "ADULT" }],
      CurrencyCode: "EUR",
      Room: { Name: "Doppelzimmer Landbl.", Code: "2NVB" },
      BoardType: "ALLINCLUSIVEPLUS",
      OfferID: "verified-offer-id",
      OfferCode: "AYT2162",
      OvernightStays: 7,
    },
  };
  assert.equal(parseVerifiedRestplatzboerseOffer(verified, candidate), 1506.84);
  assert.throws(
    () =>
      parseVerifiedRestplatzboerseOffer(
        { ...verified, Offer: { ...verified.Offer, TravellerAmount: 1 } },
        candidate,
      ),
    /eşleşmiyor/,
  );
});

test("Restplatzbörse collector publishes only the verified accommodation total", async () => {
  const provider = OTA_PROVIDERS.find(
    (item) => item.key === "restplatzboerse",
  )!;
  const baseScope = REPORT_SCOPES.find(
    (item) => item.id === "port-nature-eu",
  )!;
  const calls: string[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/v1/hotel-offers"))
      return new Response(
        JSON.stringify({ Offers: [searchOffer], _links: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const request = JSON.parse(String(init?.body));
    assert.equal(request.OfferID, "verified-offer-id");
    return new Response(
      JSON.stringify({
        Status: "Available",
        Available: true,
        Offer: {
          TravelType: "Accommodation",
          StartDate: "2027-05-10T00:00:00",
          EndDate: "2027-05-17T00:00:00",
          TourOperator: { Code: "FER", Name: "FERIEN Touristik" },
          Price: "1506.84",
          TravellerAmount: 2,
          Travellers: [{ Qualifier: "ADULT" }, { Qualifier: "ADULT" }],
          CurrencyCode: "EUR",
          Room: { Name: "Doppelzimmer Landbl.", Code: "2NVB" },
          BoardType: "ALLINCLUSIVEPLUS",
          OfferID: "verified-offer-id",
          OfferCode: "AYT2162",
          OvernightStays: 7,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await collectRestplatzboerseLiveQuotes(
    provider,
    { ...baseScope, windows: [window] },
    mockFetch,
  );
  const land = result.quotes.find((quote) => quote.roomId === "standard-land")!;
  assert.equal(land.status, "available");
  assert.equal(land.price, 1506.84);
  assert.equal(result.offers?.[0].price, 1506.84);
  assert.equal(result.offers?.[0].terms.operator, "FERIEN Touristik (FER)");
  assert.equal(calls.length, 2);
});
