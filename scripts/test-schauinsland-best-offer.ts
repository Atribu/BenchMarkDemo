
import assert from "node:assert/strict";

import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";

import {
  buildSchauinslandCollectedOffers,
  selectSchauinslandBestOffer,
  type SchauinslandOffer,
  getSchauinslandBoardCode,
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

assert.ok(window, "Tarih aralığı bulunamadı.");

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

const sourceHint =
  "https://www.schauinsland-reisen.de/hotel/4893-miramare-beach-hotel";

const collectedAt = "2026-10-23T10:00:00.000Z";

const offers = buildSchauinslandCollectedOffers(
  [
    createOffer({
      offerId: "higher-price",
      productCode: "AYTA24",
      travelType: "BB",
      totalPrice: 1680,
    }),
    createOffer({
      offerId: "lower-price",
      productCode: "AYT085",
      travelType: null,
      totalPrice: 1462,
    }),
    createOffer({
      offerId: "corner-offer",
      roomCode: "D2X3",
      roomName: "Grosses Doppelzimmer",
      totalPrice: 1804,
    }),
    createOffer({
      offerId: "wrong-description",
      roomCode: "DMU3",
      roomName: "DZ Superior seitl. Meerblick",
      totalPrice: 1200,
    }),
  ],
  provider,
  scope,
  window,
  sourceHint,
  collectedAt,
);

let passed = 0;

function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

// 1. En düşük eşleşen fiyat seçilmeli.
test("Select lowest confirmed price", () => {
  const best = selectSchauinslandBestOffer(
    offers,
    "superior-sea",
  );

  assert.ok(best);
  assert.equal(best.price, 1462);
  assert.equal(best.sourceOfferId, "lower-price");
});

// 2. Farklı oda kategorileri karışmamalı.
test("Keep room categories separate", () => {
  const best = selectSchauinslandBestOffer(
    offers,
    "corner",
  );

  assert.ok(best);
  assert.equal(best.price, 1804);
  assert.equal(best.sourceOfferId, "corner-offer");
});

// 3. Yanlış açıklamalı ucuz teklif seçilmemeli.
test("Ignore unconfirmed cheaper offers", () => {
  const best = selectSchauinslandBestOffer(
    offers,
    "superior-sea",
  );

  assert.ok(best);
  assert.notEqual(best.price, 1200);
});

// 4. Ürün metadata'sı korunmalı.
test("Preserve selected source metadata", () => {
  const best = selectSchauinslandBestOffer(
    offers,
    "superior-sea",
  );

  assert.ok(best);
  assert.equal(best.sourceProductCode, "AYT085");
  assert.equal(best.sourceTravelType, null);
});

// 5. Eşleşmeyen kategori undefined dönmeli.
test("Return undefined without match", () => {
  const best = selectSchauinslandBestOffer(
    offers,
    "nonexistent-room",
  );

  assert.equal(best, undefined);
});


// 6. İstenen pansiyon koduna göre filtreleme yapılmalı.
test("Select matching board code", () => {
  const boardOffers = buildSchauinslandCollectedOffers(
    [
      createOffer({
        offerId: "ai-offer",
        boardCode: "GT06-AI",
        boardName: "All Inclusive",
        totalPrice: 1400,
      }),
      createOffer({
        offerId: "aip-offer",
        boardCode: "GT06-AIP",
        boardName: "All Inclusive plus",
        totalPrice: 1500,
      }),
    ],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  const best = selectSchauinslandBestOffer(
    boardOffers,
    "superior-sea",
    "GT06-AIP",
  );

  assert.ok(best);
  assert.equal(best.price, 1500);
  assert.equal(best.sourceBoardCode, "GT06-AIP");
});

// 7. Filtre verilmezse mevcut davranış korunmalı.
test("Preserve default lowest-price behavior", () => {
  const boardOffers = buildSchauinslandCollectedOffers(
    [
      createOffer({
        boardCode: "GT06-AI",
        boardName: "All Inclusive",
        totalPrice: 1400,
      }),
      createOffer({
        boardCode: "GT06-AIP",
        boardName: "All Inclusive plus",
        totalPrice: 1500,
      }),
    ],
    provider,
    scope,
    window,
    sourceHint,
    collectedAt,
  );

  const best = selectSchauinslandBestOffer(
    boardOffers,
    "superior-sea",
  );

  assert.ok(best);
  assert.equal(best.price, 1400);
});

// 8. İstenen pansiyon bulunamazsa başka pansiyona geçilmemeli.
test("No fallback to different board", () => {
  const best = selectSchauinslandBestOffer(
    offers,
    "superior-sea",
    "GT06-HB",
  );

  assert.equal(best, undefined);
});


test("Map All Inclusive benchmark board", () => {
  assert.equal(
    getSchauinslandBoardCode("all-inclusive"),
    "GT06-AI",
  );
});

test("Map All Inclusive Plus benchmark board", () => {
  assert.equal(
    getSchauinslandBoardCode("all-inclusive-plus"),
    "GT06-AIP",
  );
});

test("Keep board filter optional", () => {
  assert.equal(
    getSchauinslandBoardCode(undefined),
    undefined,
  );
});



console.log(
  `Schauinsland fiyat seçme testleri başarılı: ${passed} kontrol.`,
);
