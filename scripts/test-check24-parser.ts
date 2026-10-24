
import assert from "node:assert/strict";

import {
  parseCheck24OldRecommendations,
} from "../src/lib/ota/check24-parser";

function makeResponse(
  overrides: Record<string, unknown> = {},
  offerOverrides: Record<string, unknown> = {},
) {
  return {
    status: {
      state: "finished",
      isExpired: false,
      searchRoomConfiguration: "[A|A]",
      ...overrides,
    },
    roomRates: [
      {
        roomCategoryTitle: "Superior Room Land View",
        roomInformation: {
          providerRoomName: "Superior Room Land View",
        },
        recommendation: {
          offerUuid: "offer-001",
          roomOccupancy: "[A|A]",
          mealType: "all_inclusive",
          supplier: {
            id: "176",
            displayLabel: "Expedia",
          },
          priceStructure: {
            numberOfNights: 5,
            inclusiveTaxesAndFees: false,
            effectiveTotal: {
              euro: {
                amount: 1298.42,
                currency: "EUR",
              },
            },
          },
          ...offerOverrides,
        },
      },
    ],
  };
}

function test(
  name: string,
  run: () => void,
) {
  run();
  console.log(`PASS ${name}`);
}

test("Parse valid two-adult offer", () => {
  const offers = parseCheck24OldRecommendations(
    makeResponse(),
    5,
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0].totalPrice, 1298.42);
  assert.equal(offers[0].currency, "EUR");
  assert.equal(offers[0].supplierName, "Expedia");
  assert.equal(offers[0].roomOccupancy, "[A|A]");
  assert.equal(offers[0].taxesIncluded, false);
});

test("Reject single-adult offer", () => {
  const offers = parseCheck24OldRecommendations(
    makeResponse(
      {},
      { roomOccupancy: "[A]" },
    ),
    5,
  );

  assert.equal(offers.length, 0);
});

test("Reject unfinished search", () => {
  const offers = parseCheck24OldRecommendations(
    makeResponse({ state: "running" }),
    5,
  );

  assert.equal(offers.length, 0);
});

test("Reject expired search", () => {
  const offers = parseCheck24OldRecommendations(
    makeResponse({ isExpired: true }),
    5,
  );

  assert.equal(offers.length, 0);
});

test("Reject wrong stay duration", () => {
  const offers = parseCheck24OldRecommendations(
    makeResponse(),
    7,
  );

  assert.equal(offers.length, 0);
});

test("Reject non-EUR price", () => {
  const offers = parseCheck24OldRecommendations(
    makeResponse(
      {},
      {
        priceStructure: {
          numberOfNights: 5,
          effectiveTotal: {
            euro: {
              amount: 1298.42,
              currency: "USD",
            },
          },
        },
      },
    ),
    5,
  );

  assert.equal(offers.length, 0);
});

test("Prefer offer-specific room description", () => {
  const offers = parseCheck24OldRecommendations(
    makeResponse(
      {},
      {
        providerRoomDescription:
          "Superior Double Room Land View",
      },
    ),
    5,
  );

  assert.equal(
    offers[0].roomName,
    "Superior Double Room Land View",
  );
});

console.log(
  "CHECK24 parser testleri başarılı: 7 kontrol.",
);
