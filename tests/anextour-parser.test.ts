import assert from "node:assert/strict";
import test from "node:test";

import { parseAnexTourOffers } from "../src/lib/ota/anextour-parser";

function response(operatorId: string) {
  return {
    data: {
      items: [
        {
          accommodationId: "297825",
          tourOperator: { id: operatorId, name: "ÖGER TOURS" },
          units: [
            {
              room: { name: "Doppelzimmer mit Landblick" },
              board: { code: "ALLINCLUSIVEPLUS" },
            },
          ],
          startDate: "2027-05-10",
          endDate: "2027-05-15",
          duration: { overnights: 5 },
          price: {
            total: { amount: 813, currency: "EUR", type: "PARTY" },
          },
        },
      ],
    },
  };
}

const expectedStay = {
  accommodationId: "297825",
  checkIn: "2027-05-10",
  checkOut: "2027-05-15",
  nights: 5,
};

test("SY Hotels accepts its verified ÖGER offer on the ANEX Germany platform", () => {
  const offers = parseAnexTourOffers(response("OGE"), {
    ...expectedStay,
    operatorIds: ["ANEX", "OGE"],
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].operator, "ÖGER TOURS");
  assert.equal(offers[0].price, 813);
});

test("ÖGER remains rejected unless the hotel explicitly enables it", () => {
  assert.deepEqual(parseAnexTourOffers(response("OGE"), expectedStay), []);
  assert.deepEqual(
    parseAnexTourOffers(response("OTHER"), {
      ...expectedStay,
      operatorIds: ["ANEX", "OGE"],
    }),
    [],
  );
});
