
import assert from "node:assert/strict";

import {
  parseSchauinslandOffers,
  type SchauinslandSearchCriteria,
} from "../src/lib/ota/live-schauinsland";

const criteria: SchauinslandSearchCriteria = {
  hotelId: "4893",
  checkIn: "2026-10-26",
  checkOut: "2026-10-31",
  nights: 5,
};

function createOffer(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "offer-1",
    externalId: "external-1",
    hotelContentId: {
      giataId: "4893",
    },
    tourOperator: {
      code: "SLR",
    },
    offerStart: {
      date: "2026-10-26",
    },
    offerEnd: {
      date: "2026-10-31",
    },
    lengthOfStay: 5,
    departure: null,
    return: null,
    soldOut: false,
    price: {
      amount: 1462,
      currency: "EUR",
      perPersonAmount: 731,
    },
    rooms: {
      room: [
        {
          opCode: "DMU3",
          providerDescription: "DZ Superior Meerblick",
          board: {
            code: "GT06-AIP",
            label: "All Inclusive plus",
          },
        },
      ],
    },
    productCode: "AYT085",
    travelType: null,
    sourceCode: "TRAVELTAINMENT",
    hotelOfferCategory: 5,
    ...overrides,
  };
}

function createResponse(
  offers: Record<string, unknown>[],
) {
  return {
    data: {
      productOffers: {
        hotels: [
          {
            offers,
          },
        ],
      },
    },
  };
}

let passed = 0;

function test(
  name: string,
  run: () => void,
) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

// 1. Geçerli teklif ayrıştırılmalı.
test("Valid SLR offer", () => {
  const results = parseSchauinslandOffers(
    createResponse([createOffer()]),
    criteria,
  );

  assert.equal(results.length, 1);

  assert.equal(results[0].roomCode, "DMU3");
  assert.equal(results[0].totalPrice, 1462);
  assert.equal(results[0].currency, "EUR");

  assert.equal(results[0].offerId, "offer-1");
  assert.equal(results[0].externalId, "external-1");
  assert.equal(results[0].productCode, "AYT085");
  assert.equal(results[0].travelType, null);
  assert.equal(
    results[0].sourceCode,
    "TRAVELTAINMENT",
  );
  assert.equal(results[0].hotelOfferCategory, 5);
});

// 2. Farklı ürün kodları ayrı teklifler olarak korunmalı.
test("Distinct product codes", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        id: "offer-1",
        productCode: "AYT085",
        travelType: null,
        price: {
          amount: 1462,
          currency: "EUR",
        },
      }),
      createOffer({
        id: "offer-2",
        productCode: "AYTA24",
        travelType: "BB",
        price: {
          amount: 1680,
          currency: "EUR",
        },
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 2);

  assert.deepEqual(
    results.map((offer) => offer.productCode),
    ["AYT085", "AYTA24"],
  );

  assert.deepEqual(
    results.map((offer) => offer.travelType),
    [null, "BB"],
  );

  assert.deepEqual(
    results.map((offer) => offer.totalPrice),
    [1462, 1680],
  );
});

// 3. Farklı otel reddedilmeli.
test("Reject wrong hotel", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        hotelContentId: {
          giataId: "4894",
        },
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 4. Yanlış giriş tarihi reddedilmeli.
test("Reject wrong check-in date", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        offerStart: {
          date: "2026-10-27",
        },
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 5. Yanlış çıkış tarihi reddedilmeli.
test("Reject wrong check-out date", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        offerEnd: {
          date: "2026-11-01",
        },
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 6. Yanlış gece sayısı reddedilmeli.
test("Reject wrong duration", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        lengthOfStay: 7,
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 7. Başka tur operatörü reddedilmeli.
test("Reject other tour operator", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        tourOperator: {
          code: "SLRD",
        },
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 8. Uçuş içeren teklif reddedilmeli.
test("Reject flight package", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        departure: {
          airport: "BER",
        },
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 9. Satılmış teklif reddedilmeli.
test("Reject sold-out offer", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        soldOut: true,
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 10. Farklı para birimi reddedilmeli.
test("Reject non-EUR price", () => {
  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        price: {
          amount: 1462,
          currency: "GBP",
        },
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 11. Birden fazla oda içeren teklif reddedilmeli.
test("Reject multiple rooms", () => {
  const room = {
    opCode: "DMU3",
    providerDescription: "DZ Superior Meerblick",
    board: {
      code: "GT06-AIP",
      label: "All Inclusive plus",
    },
  };

  const results = parseSchauinslandOffers(
    createResponse([
      createOffer({
        rooms: {
          room: [room, room],
        },
      }),
    ]),
    criteria,
  );

  assert.equal(results.length, 0);
});

// 12. Hatalı fiyat reddedilmeli.
test("Reject invalid price", () => {
  for (const amount of [0, -100, NaN]) {
    const results = parseSchauinslandOffers(
      createResponse([
        createOffer({
          price: {
            amount,
            currency: "EUR",
          },
        }),
      ]),
      criteria,
    );

    assert.equal(results.length, 0);
  }
});

console.log(
  `Schauinsland teklif ayrıştırma testleri başarılı: ${passed} kontrol.`,
);
