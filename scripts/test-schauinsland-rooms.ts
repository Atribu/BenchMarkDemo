
import assert from "node:assert/strict";

import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { matchSchauinslandRoom } from "../src/lib/ota/schauinsland-rooms";

const beach = REPORT_SCOPES.find(
  (scope) => scope.id === "beach-eu",
);

const queen = REPORT_SCOPES.find(
  (scope) => scope.id === "queen-eu",
);

assert.ok(beach, "Miramare Beach scope bulunamadı.");
assert.ok(queen, "Miramare Queen scope bulunamadı.");

const cases = [
    {
  scope: beach,
  code: "DSUA",
  name: "Doppelzimmer Superior",
  expectedRoomId: "superior-land",
  confirmed: true,
},
{
  scope: queen,
  code: "D  A",
  name: "Doppelzimmer",
  expectedRoomId: "standard-land",
  confirmed: true,
},
    {
  scope: beach,
  code: "SOZ3",
  name: "Sparzimmer mit Balkon",
  expectedRoomId: "economy",
  confirmed: false,
},
    {
  scope: beach,
  code: "DMU3",
  name: "DZ Superior seitl. Meerblick",
  expectedRoomId: "superior-sea",
  confirmed: false,
},
{
  scope: queen,
  code: "DM 3",
  name: "Doppelzimmer seitlicher Meerblick",
  expectedRoomId: "standard-sea",
  confirmed: false,
},
{
  scope: beach,
  code: "SOZ3",
  name: "Sparzimmer ohne Balkon",
  expectedRoomId: "economy",
  confirmed: true,
},
{
  scope: beach,
  code: "SOZA",
  name: "Sparzimmer ohne Balkon",
  expectedRoomId: "economy",
  confirmed: true,
},
{
  scope: beach,
  code: "D2X3",
  name: "Grosses Doppelzimmer",
  expectedRoomId: "corner",
  confirmed: true,
},
{
  scope: beach,
  code: "D2XA",
  name: "Grosses Doppelzimmer",
  expectedRoomId: "corner",
  confirmed: true,
},
{
  scope: beach,
  code: "D2X3",
  name: "Deluxe Garten DZ",
  expectedRoomId: "corner",
  confirmed: false,
},

  {
    scope: beach,
    code: "DMU3",
    name: "DZ Superior Meerblick",
    expectedRoomId: "superior-sea",
    confirmed: true,
  },
  {
    scope: beach,
    code: "DMUA",
    name: "DZ Superior Meerblick",
    expectedRoomId: "superior-sea",
    confirmed: true,
  },
  {
    scope: beach,
    code: "DSU3",
    name: "Doppelzimmer Superior",
    expectedRoomId: "superior-land",
    confirmed: true,
  },
  {
    scope: beach,
    code: "DSS3",
    name: "DZ Superior seitl. Meerblick",
    expectedRoomId: null,
    confirmed: false,
  },
  {
    scope: queen,
    code: "DM 3",
    name: "Doppelzimmer Meerblick",
    expectedRoomId: "standard-sea",
    confirmed: true,
  },
  {
    scope: queen,
    code: "DM A",
    name: "Doppelzimmer Meerblick",
    expectedRoomId: "standard-sea",
    confirmed: true,
  },
  {
    scope: queen,
    code: "D  3",
    name: "Doppelzimmer",
    expectedRoomId: "standard-land",
    confirmed: true,
  },
  {
    scope: queen,
    code: "SSZ3",
    name: "Super Sparzimmer",
    expectedRoomId: null,
    confirmed: false,
  },
  {
    scope: queen,
    code: "DM 3",
    name: "Doppelzimmer Gartengebaeude",
    expectedRoomId: "standard-sea",
    confirmed: false,
  },
];

for (const testCase of cases) {
  const result = matchSchauinslandRoom(
    testCase.scope,
    testCase.code,
    testCase.name,
  );

  assert.equal(
    result.room?.id ?? null,
    testCase.expectedRoomId,
    `Oda eşleşmesi hatalı: ${testCase.code}`,
  );

  assert.equal(
    result.confirmed,
    testCase.confirmed,
    `Doğrulama durumu hatalı: ${testCase.code}`,
  );

  console.log(
    `PASS ${testCase.scope.hotelName} / ${testCase.code}`,
  );
}


const incorrectDescription = matchSchauinslandRoom(
  beach,
  "DMU3",
  "DZ Superior seitl. Meerblick",
);

assert.equal(incorrectDescription.confirmed, false);

assert.match(
  incorrectDescription.reason,
  /beklenen açıklamayla eşleşmiyor/,
);

const confirmedLand = matchSchauinslandRoom(
  queen,
  "D  3",
  "Doppelzimmer",
);

assert.equal(confirmedLand.confirmed, true);
assert.equal(confirmedLand.room?.id, "standard-land");
assert.equal(confirmedLand.features.view, "land");


console.log(
  `Schauinsland oda eşleştirme testleri başarılı: ${cases.length + 2} kontrol.`,
);