
import assert from "node:assert/strict";

import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";

import {
  buildSchauinslandCollectedOffers,
  type SchauinslandOffer,
} from "../src/lib/ota/live-schauinsland";

const scope = REPORT_SCOPES.find(
  (item) => item.id === "beach-eu",
);

assert.ok(scope, "Miramare Beach kapsamı bulunamadı.");

const provider = OTA_PROVIDERS.find(
  (item) => item.key === "schauinsland",
);

assert.ok(provider, "Schauinsland sağlayıcısı bulunamadı.");

const window = scope.windows[0];

assert.ok(window, "Benchmark tarih aralığı bulunamadı.");

const sourceHint =
  "https://www.schauinsland-reisen.de/hotel/4893-miramare-beach-hotel";

const collectedAt = "2026-10-23T10:00:00.000Z";

function createOffer(
  overrides: Partial<SchauinslandOffer> = {},
): SchauinslandOffer {
  return {
    hotelId: "4893",
    checkIn: window.checkIn,
    checkOut: window.checkOut,
    nights: window.nights,

    roomName: "DZ Superior Meerblick",
    roomCode: "DMU3",
    boardCode: "GT06-AIP",
    boardName: "All Inclusive plus",

    totalPrice: 1462,
    currency: "EUR",
    tourOperator: "SLR",

    offerId: "offer-1",
    externalId: "external-1",
    productCode: "AYT085",
    travelType: null,
    sourceCode: "TRAVELTAINMENT",
    hotelOfferCategory: 5,

    ...overrides,
  };
}

let passed = 0;

function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

// 1. Teklif metadata'sı doğru aktarılmalı.
test("Preserve source metadata", () => {
  const results = buildSchauinslandCollectedOffers(
    [createOffer()],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  assert.equal(results.length, 1);

  const offer = results[0];

  assert.equal(offer.sourceOfferId, "offer-1");
  assert.equal(offer.sourceProductCode, "AYT085");
  assert.equal(offer.sourceTravelType, null);
  assert.equal(
    offer.sourceSystemCode,
    "TRAVELTAINMENT",
  );

  assert.equal(offer.price, 1462);
  assert.equal(offer.currency, "EUR");

  assert.equal(offer.rooms, 1);
  assert.equal(offer.adults, 2);
});

// 2. Farklı ürün kodları farklı teklifler olarak kalmalı.
test("Preserve distinct products", () => {
  const results = buildSchauinslandCollectedOffers(
    [
      createOffer(),
      createOffer({
        offerId: "offer-2",
        productCode: "AYTA24",
        travelType: "BB",
        totalPrice: 1680,
      }),
    ],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  assert.equal(results.length, 2);

  assert.notEqual(results[0].id, results[1].id);

  assert.deepEqual(
    results.map((offer) => offer.sourceProductCode),
    ["AYT085", "AYTA24"],
  );

  assert.deepEqual(
    results.map((offer) => offer.price),
    [1462, 1680],
  );
});

// 3. Doğrulanmış oda otomatik eşleştirilmeli.
test("Match confirmed room", () => {
  const results = buildSchauinslandCollectedOffers(
    [createOffer()],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  assert.equal(
    results[0].matchedRoomId,
    "superior-sea",
  );
});

// 4. Henüz doğrulanmamış oda eşleştirilmemeli.

// 4. Superior Land artık doğrulanmış kategori.
test("Match confirmed Superior Land room", () => {
  const results = buildSchauinslandCollectedOffers(
    [
      createOffer({
        roomCode: "DSU3",
        roomName: "Doppelzimmer Superior",
      }),
    ],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  assert.equal(
    results[0].matchedRoomId,
    "superior-land",
  );

  assert.equal(
    results[0].roomFeatures.view,
    "land",
  );
});


test("Keep unknown room for manual review", () => {
  const results = buildSchauinslandCollectedOffers(
    [
      createOffer({
        roomCode: "DSS3",
        roomName: "DZ Superior seitl. Meerblick",
      }),
    ],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].matchedRoomId, undefined);

  assert.match(
    results[0].matchReason ?? "",
    /eşleşmesi bulunamadı/,
  );
});


// 5. Yanlış oda açıklaması otomatik eşleştirilmemeli.
test("Reject mismatching room description", () => {
  const results = buildSchauinslandCollectedOffers(
    [
      createOffer({
        roomCode: "DMU3",
        roomName: "DZ Superior seitl. Meerblick",
      }),
    ],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  assert.equal(
    results[0].matchedRoomId,
    undefined,
  );
});

// 6. Tarih, fiyat ve kaynak bilgisi korunmalı.
test("Preserve benchmark fields", () => {
  const results = buildSchauinslandCollectedOffers(
    [createOffer()],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  const offer = results[0];

  assert.equal(offer.scopeKey, scope.id);
  assert.equal(offer.windowId, window.id);
  assert.equal(offer.checkIn, window.checkIn);
  assert.equal(offer.checkOut, window.checkOut);
  assert.equal(offer.nights, window.nights);
  assert.equal(offer.sourceHint, sourceHint);
  assert.equal(offer.observedAt, collectedAt);
  assert.equal(offer.sourceBoardCode, "GT06-AIP");
assert.equal(offer.terms.board, "All Inclusive plus");
});

console.log(
  `Schauinsland CollectedOffer testleri başarılı: ${passed} kontrol.`,
);
