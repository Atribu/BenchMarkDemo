import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import {
  buildStayforlongAvailabilityUrl,
  buildStayforlongSourceUrl,
  collectStayforlongLiveQuotes,
  matchStayforlongRoom,
  parseStayforlongOffers,
  parseVerifiedStayforlongOffer,
  STAYFORLONG_HOTEL_CONFIG,
} from "../src/lib/ota/live-stayforlong";

const window = {
  id: "2027-05-10_2027-05-15",
  label: "10–15 Mayıs 2027",
  checkIn: "2027-05-10",
  checkOut: "2027-05-15",
  nights: 5,
};

const availability = {
  id_availability: "ad04d879-a7c5-4bdd-8f5d-177100da18a8",
  adults: 2,
  children: 0,
  rooms: 1,
  currency: "EUR",
  room_name: "Doppelbett oder einzelbetten, landansicht",
  room_code: "Standard room land view, Double or Twin",
  normalized_room_code: "db2584c3cd61064508906d370ef724cd",
  board_name: "All Inklusive",
  board_code: "AI",
  selling_rate: 1395,
  bighead_rate: 1994,
  pay_rate: 83,
  avg_rate: 279,
  summary: {
    taxes: { amount: 126.82, currency: "EUR" },
    total: { amount: 1395, currency: "EUR" },
    total_with_fees: { amount: 1395, currency: "EUR" },
  },
  allotment: 999,
  provider: "2823b31391ddae4c5e93f088129b03bf",
  rate_type: "RECHECK",
};

const bookingRules = {
  id_property: 40539,
  selling_rate: 1395,
  currency: "EUR",
  pay_rate: 83,
  cancellation_policies: [
    { amount: 83, from: "2027-04-27", currency: "EUR" },
  ],
  nights: 5,
  allotment: 999,
  adults: 2,
  children: 0,
  children_ages: "",
  taxes: [
    {
      included: true,
      amount: 126.82,
      currency: "EUR",
      name: "state_rate",
    },
  ],
  avg_rate: 279,
  board_code: "AI",
  board_name: "All Inklusive",
  room_name: "Doppelbett oder einzelbetten, landansicht",
  rooms: 1,
  rate_class: "SFL",
};

test("Stayforlong uses the official Port Nature property and exact German stay", () => {
  assert.deepEqual(STAYFORLONG_HOTEL_CONFIG["miramare-beach"], {
    propertyId: 67296,
    slug: "miramare-beach-hotel_manavgat",
    hotelName: "Miramare Beach Hotel",
  });
  assert.deepEqual(STAYFORLONG_HOTEL_CONFIG["miramare-queen"], {
    propertyId: 67402,
    slug: "miramare-queen-hotel-all-inclusive_manavgat",
    hotelName: "Miramare Queen Hotel - All Inclusive",
  });
  assert.deepEqual(STAYFORLONG_HOTEL_CONFIG["port-nature"], {
    propertyId: 40539,
    slug: "port-nature-luxury-resort_serik",
    hotelName: "Port Nature Luxury Resort & Spa – All Inclusive",
  });
  const apiUrl = new URL(buildStayforlongAvailabilityUrl(40539, window));
  assert.equal(apiUrl.pathname, "/v4/availability/property/40539");
  assert.equal(apiUrl.searchParams.get("adultsByRoom"), "2");
  assert.equal(apiUrl.searchParams.get("childrenByRoom"), "0");
  assert.equal(apiUrl.searchParams.get("checkin"), window.checkIn);
  assert.equal(apiUrl.searchParams.get("checkout"), window.checkOut);
  assert.equal(apiUrl.searchParams.get("market"), "de");
  assert.equal(apiUrl.searchParams.get("currency"), "EUR");

  const sourceUrl = new URL(
    buildStayforlongSourceUrl("port-nature-luxury-resort_serik", window),
  );
  assert.equal(
    sourceUrl.pathname,
    "/de-de/hotel/tr/port-nature-luxury-resort_serik",
  );
  assert.equal(sourceUrl.searchParams.get("adults"), "2");
});

test("Stayforlong accepts Premium All Inclusive offers without inventing a normalized room code", () => {
  const premium = {
    ...availability,
    id_availability: "premium-beach-land",
    room_name: "Superior Zimmer (Landschaftsblick)",
    room_code: "RMSP00LC00;-OWN1-",
    normalized_room_code: "",
    board_name: "All Inklusive Premium",
    board_code: "AS",
    selling_rate: 1125,
    avg_rate: 225,
    summary: {
      ...availability.summary,
      total: { amount: 1125, currency: "EUR" },
      total_with_fees: { amount: 1125, currency: "EUR" },
    },
  };
  const parsed = parseStayforlongOffers(
    { "67296": { availability: [premium] } },
    67296,
    "miramare-beach",
    5,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].boardCode, "AS");
  assert.equal(parsed[0].normalizedRoomCode, "RMSP00LC00;-OWN1-");
  assert.equal(parsed[0].matchedRoomId, "superior-land");
});

test("Stayforlong keeps Miramare room categories and side-sea views separate", () => {
  assert.equal(
    matchStayforlongRoom(
      "miramare-beach",
      "Economy zimmer, doppelbett oder einzelbetten",
      "RMSDDB000E;-OWN1-",
    ),
    "economy",
  );
  assert.equal(
    matchStayforlongRoom(
      "miramare-beach",
      "Superior eckzimmer, doppel- oder einzelbetten",
      "19370068",
    ),
    "corner",
  );
  assert.equal(
    matchStayforlongRoom(
      "miramare-beach",
      "Superior Zimmer (Landschaftsblick)",
      "RMSP00LC00;-OWN1-",
    ),
    "superior-land",
  );
  assert.equal(
    matchStayforlongRoom(
      "miramare-beach",
      "Superior zimmer, doppelbett oder einzelbetten, meerblick",
      "RMSP00SV00;-OWN1-",
    ),
    "superior-sea",
  );
  assert.equal(
    matchStayforlongRoom(
      "miramare-beach",
      "Superior zimmer, doppelbett oder zwei einzelbetten, seitlicher meerblick",
      "RMSP00LS00;-OWN1-",
    ),
    undefined,
  );
  assert.equal(
    matchStayforlongRoom(
      "miramare-queen",
      "Doppelbett oder zwei einzelbetten",
      "2293",
    ),
    "standard-land",
  );
  assert.equal(
    matchStayforlongRoom(
      "miramare-queen",
      "Doppelzimmer - Meerblick",
      "22",
    ),
    "standard-sea",
  );
  assert.equal(
    matchStayforlongRoom(
      "miramare-queen",
      "Doppelbett oder einzelbetten, seitlicher meerblick",
      "RMSDDBLS00;-OWN6-",
    ),
    undefined,
  );
  assert.equal(
    matchStayforlongRoom(
      "miramare-queen",
      "Suite, king-bett und sofa, meerblick",
      "1516428415",
    ),
    undefined,
  );
});

test("Stayforlong parser accepts only two-adult EUR All Inclusive totals", () => {
  const response = {
    "40539": {
      availability: [
        availability,
        { ...availability, id_availability: "wrong-adults", adults: 1 },
        { ...availability, id_availability: "wrong-board", board_code: "RO" },
        {
          ...availability,
          id_availability: "nightly-instead-of-total",
          summary: {
            ...availability.summary,
            total_with_fees: { amount: 279, currency: "EUR" },
          },
        },
      ],
    },
    defaults: {},
    room_content: {},
  };
  const parsed = parseStayforlongOffers(
    response,
    40539,
    "port-nature",
    5,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].totalPrice, 1395);
  assert.equal(parsed[0].matchedRoomId, "standard-land");
});

test("Stayforlong Port Nature room views remain distinct", () => {
  assert.equal(
    matchStayforlongRoom(
      "port-nature",
      "Doppelbett oder einzelbetten, landansicht",
      "Standard room land view, Double or Twin",
    ),
    "standard-land",
  );
  assert.equal(
    matchStayforlongRoom(
      "port-nature",
      "Doppelbett oder einzelbetten, seitlicher meerblick",
      "Standard Room Side Sea View, Double or Twin",
    ),
    "standard-side-sea",
  );
  assert.equal(
    matchStayforlongRoom(
      "port-nature",
      "Doppelbett oder zwei einzelbetten, meerblick",
      "Standard Room Sea View, Double or Twin",
    ),
    "standard-sea",
  );
  assert.equal(
    matchStayforlongRoom(
      "port-nature",
      "Familienzimmer, doppelbett oder zwei einzelbetten, seitlicher meerblick",
      "Family Room Side Sea View, Double or Twin",
    ),
    "family",
  );
  assert.equal(
    matchStayforlongRoom(
      "port-nature",
      "Doppelbett oder zwei einzelbetten",
      "Standard Room, Double or Twin",
    ),
    undefined,
  );
});

test("Stayforlong bookingRules preserves property, occupancy, board and included taxes", () => {
  const candidate = parseStayforlongOffers(
    { "40539": { availability: [availability] } },
    40539,
    "port-nature",
    5,
  )[0];
  const verified = parseVerifiedStayforlongOffer(
    bookingRules,
    candidate,
    5,
  );
  assert.equal(verified.price, 1395);
  assert.match(verified.cancellation, /2027-04-27.*83 EUR/);
  assert.match(verified.taxes, /126\.82 EUR.*dahil/);
  assert.throws(
    () =>
      parseVerifiedStayforlongOffer(
        { ...bookingRules, id_property: 999 },
        candidate,
        5,
      ),
    /eşleşmiyor/,
  );
  assert.throws(
    () =>
      parseVerifiedStayforlongOffer(
        {
          ...bookingRules,
          taxes: [{ ...bookingRules.taxes[0], included: false }],
        },
        candidate,
        5,
      ),
    /eşleşmiyor/,
  );
});

test("Stayforlong collector publishes the bookingRules total", async () => {
  const provider = OTA_PROVIDERS.find((item) => item.key === "stayforlong")!;
  const scope = REPORT_SCOPES.find((item) => item.id === "port-nature-eu")!;
  const calls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/v4/availability/property/40539"))
      return new Response(
        JSON.stringify({ "40539": { availability: [availability] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    assert.match(url, /ad04d879-a7c5-4bdd-8f5d-177100da18a8\/bookingRules/);
    return new Response(JSON.stringify(bookingRules), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await collectStayforlongLiveQuotes(
    provider,
    { ...scope, windows: [window] },
    mockFetch,
  );
  const land = result.quotes.find((quote) => quote.roomId === "standard-land")!;
  assert.equal(land.status, "available");
  assert.equal(land.price, 1395);
  assert.equal(result.offers?.[0].price, 1395);
  assert.equal(result.offers?.[0].sourceSystemCode, "40539");
  assert.match(result.offers?.[0].terms.taxes ?? "", /126\.82 EUR/);
  assert.equal(calls.length, 2);
});
