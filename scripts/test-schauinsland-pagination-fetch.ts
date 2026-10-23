
import assert from "node:assert/strict";
import {
  fetchSchauinslandRemainingPages,
} from "../src/lib/ota/live-schauinsland";

function makeOffers(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `offer-${start + index}`,
  }));
}

function makeResult(
  total: number,
  start: number,
  count: number,
) {
  return {
    data: {
      productOffers: {
        pagination: { resultsTotal: total },
        hotels: [
          { offers: makeOffers(start, count) },
        ],
      },
    },
  };
}

function makeCapturedRequest() {
  return {
    url: "https://www.schauinsland-reisen.de/api/graphql",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operationName: "getOfferList",
      variables: {
        packageOfferRequest: {
          pagination: {
            resultsPerPage: 50,
            showingResultsFrom: 0,
          },
          productSearch: {
            bookingType: "HOTEL_ONLY",
          },
        },
      },
    }),
  };
}

async function main() {
  // Test 1: 120 teklif üç sayfadan toplanmalı.
  const requestedOffsets: number[] = [];

  const client = {
    post: async (
      _url: string,
      options: {
        data: string;
        headers: Record<string, string>;
        timeout: number;
      },
    ) => {
      const body = JSON.parse(options.data);
      const offset =
        body.variables.packageOfferRequest.pagination
          .showingResultsFrom;

      requestedOffsets.push(offset);

      return {
        status: () => 200,
        json: async () =>
          offset === 50
            ? makeResult(120, 50, 50)
            : makeResult(120, 100, 20),
      };
    },
  };

  const result = await fetchSchauinslandRemainingPages(
    client,
    makeCapturedRequest(),
    makeResult(120, 0, 50),
  );

  assert.deepEqual(requestedOffsets, [50, 100]);

  const hotels = (
    result as {
      data: {
        productOffers: {
          hotels: Array<{ offers: Array<{ id: string }> }>;
        };
      };
    }
  ).data.productOffers.hotels;

  const allOffers = hotels.flatMap((hotel) => hotel.offers);

  assert.equal(allOffers.length, 120);
  assert.equal(new Set(allOffers.map((offer) => offer.id)).size, 120);

  console.log("PASS Collect 120 offers across 3 pages");

  // Test 2: İlk sayfa yeterliyse ek istek olmamalı.
  let extraRequests = 0;

  const singlePageClient = {
    post: async () => {
      extraRequests++;
      throw new Error("Unexpected request");
    },
  };

  await fetchSchauinslandRemainingPages(
    singlePageClient,
    makeCapturedRequest(),
    makeResult(18, 0, 18),
  );

  assert.equal(extraRequests, 0);

  console.log("PASS No extra request for single page");

  // Test 3: Tekrarlanan teklifler reddedilmeli.
  const duplicateClient = {
    post: async () => ({
      status: () => 200,
      json: async () => makeResult(60, 0, 10),
    }),
  };

  await assert.rejects(
    fetchSchauinslandRemainingPages(
      duplicateClient,
      makeCapturedRequest(),
      makeResult(60, 0, 50),
    ),
    /tekrarlı/,
  );

  console.log("PASS Reject duplicate offers");

  // Test 4: Başarısız ek sayfa reddedilmeli.
  const failedClient = {
    post: async () => ({
      status: () => 500,
      json: async () => ({}),
    }),
  };

  await assert.rejects(
    fetchSchauinslandRemainingPages(
      failedClient,
      makeCapturedRequest(),
      makeResult(60, 0, 50),
    ),
    /HTTP 500/,
  );

  console.log("PASS Reject failed page");

  console.log(
    "Schauinsland pagination fetch testleri başarılı: 4 kontrol.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
