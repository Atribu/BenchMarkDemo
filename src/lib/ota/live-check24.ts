
import type { Page } from "patchright";

import {
  parseCheck24NewAllOffers,
  parseCheck24OldAllOffers,
  type Check24ParsedOffer,
} from "./check24-parser";

import {
  getCheck24BeachBestOffers,
} from "./check24-room-mapping";


const BEACH_ACCOMMODATION_ID =
  "019ab52846f67e3fa61a67dc9422e9de";

const BEACH_SLUG =
  "miramare-beach-hotel-ultra-all-inclusive";

type Check24BeachResult = {
  url: string;
  nights: number;
  totalOffers: number;
  offers: Check24ParsedOffer[];
  bestOffers: ReturnType<
    typeof getCheck24BeachBestOffers
  >;
};

function getNights(
  checkIn: string,
  checkOut: string,
): number {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (
    !datePattern.test(checkIn) ||
    !datePattern.test(checkOut)
  ) {
    throw new Error("Invalid CHECK24 date format");
  }

  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);

  const nights = (end - start) / 86_400_000;

  if (
    !Number.isInteger(nights) ||
    nights <= 0 ||
    new Date(start).toISOString().slice(0, 10) !== checkIn ||
    new Date(end).toISOString().slice(0, 10) !== checkOut
  ) {
    throw new Error("Invalid CHECK24 stay dates");
  }

  return nights;
}

export async function collectCheck24BeachNew(
  page: Page,
  checkIn: string,
  checkOut: string,
): Promise<Check24BeachResult> {
  const nights = getNights(checkIn, checkOut);

  const url = new URL(
    `https://hotels.check24.de/accommodation/${BEACH_SLUG}-${BEACH_ACCOMMODATION_ID}`,
  );

  url.searchParams.set("checkinDate", checkIn);
  url.searchParams.set("checkoutDate", checkOut);
  url.searchParams.set("occupancy", "[A|A]");

  // Dinleyiciyi sayfayı açmadan önce başlatıyoruz.
  const finishedResponse = page.waitForResponse(
    async (response) => {
      if (response.status() !== 200) return false;

      const responseUrl = new URL(response.url());

      if (
        responseUrl.hostname !== "hotels.check24.de" ||
        responseUrl.pathname !== "/api/offers" ||
        responseUrl.searchParams.get("accommodationId") !==
          BEACH_ACCOMMODATION_ID ||
        responseUrl.searchParams.get("checkinDate") !== checkIn ||
        responseUrl.searchParams.get("checkoutDate") !== checkOut ||
        responseUrl.searchParams.get("occupancy") !== "[A|A]"
      ) {
        return false;
      }

      try {
        const data = await response.json();
        return data?.offers?.status === 2;
      } catch {
        return false;
      }
    },
    { timeout: 60_000 },
  );

  await page.goto(url.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const response = await finishedResponse;
  const data: unknown = await response.json();

  const parsedOffers = parseCheck24NewAllOffers(data);

  // Gece sayısı API teklifinde yok.
  // Collector, doğrulanmış arama tarihinden hesaplıyor.
  const offers: Check24ParsedOffer[] = parsedOffers.map(
    (offer) => ({
      ...offer,
      nights,
    }),
  );

  return {
    url: url.toString(),
    nights,
    totalOffers: offers.length,
    offers,
    bestOffers: getCheck24BeachBestOffers(
      offers,
      nights,
    ),
  };
}



export async function collectCheck24BeachOld(
  page: Page,
  checkIn: string,
  checkOut: string,
): Promise<Check24BeachResult> {
  const nights = getNights(checkIn, checkOut);

  const hotelId = "7776197";

  const searchUrl =
    `https://hotel.check24.de/search/` +
    `Miramare%20Beach%20Hotel%20-%20Ultra%20All%20Inclusive-${hotelId}/` +
    `${checkIn}/${checkOut}/%5BA%7CA%5D/hotel.html`;

  const finishedResponse = page.waitForResponse(
    async (response) => {
      if (response.status() !== 200) return false;

      const responseUrl = new URL(response.url());

      if (
        responseUrl.hostname !== "hotel.check24.de" ||
        !responseUrl.pathname.endsWith(
          "/clustered_offers.json",
        )
      ) {
        return false;
      }

      try {
        const data = await response.json();

        return (
          data?.status?.state === "finished" &&
          data?.status?.isExpired === false &&
          data?.status?.searchRoomConfiguration ===
            "[A|A]"
        );
      } catch {
        return false;
      }
    },
    { timeout: 60_000 },
  );

  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const response = await finishedResponse;
  const data: unknown = await response.json();

  const offers = parseCheck24OldAllOffers(
    data,
    nights,
  );

  return {
    url: searchUrl,
    nights,
    totalOffers: offers.length,
    offers,
    bestOffers: getCheck24BeachBestOffers(
      offers,
      nights,
    ),
  };
}


export async function collectCheck24Beach(
  page: Page,
  checkIn: string,
  checkOut: string,
): Promise<
  Check24BeachResult & {
    apiVersion: "old" | "new";
  }
> {
  const nights = getNights(checkIn, checkOut);

  const hotelId = "7776197";

  const searchUrl =
    "https://hotel.check24.de/search/" +
    `Miramare%20Beach%20Hotel%20-%20Ultra%20All%20Inclusive-${hotelId}/` +
    `${checkIn}/${checkOut}/%5BA%7CA%5D/hotel.html`;

  // İki API'den hangisi tamamlanırsa onu yakala.
  // Dinleyici navigasyondan önce kuruluyor.
  const finishedResponse = page.waitForResponse(
    async (response) => {
      if (response.status() !== 200) {
        return false;
      }

      const responseUrl = new URL(response.url());

      const isNewApi =
        responseUrl.hostname === "hotels.check24.de" &&
        responseUrl.pathname === "/api/offers" &&
        responseUrl.searchParams.get(
          "accommodationId",
        ) === BEACH_ACCOMMODATION_ID &&
        responseUrl.searchParams.get(
          "checkinDate",
        ) === checkIn &&
        responseUrl.searchParams.get(
          "checkoutDate",
        ) === checkOut &&
        responseUrl.searchParams.get(
          "occupancy",
        ) === "[A|A]";

      const isOldApi =
        responseUrl.hostname === "hotel.check24.de" &&
        /^\/api-hotel\/proxy\/portale\/hotels\/searches\/[^/]+\/clustered_offers\.json$/.test(
          responseUrl.pathname,
        );

      if (!isNewApi && !isOldApi) {
        return false;
      }

      try {
        const data = await response.json();

        if (isNewApi) {
          return data?.offers?.status === 2;
        }

        return (
          data?.status?.state === "finished" &&
          data?.status?.isExpired === false &&
          data?.status?.searchRoomConfiguration ===
            "[A|A]"
        );
      } catch {
        return false;
      }
    },
    { timeout: 60_000 },
  );

  // CHECK24 uygun gördüğü eski/yeni arayüze yönlendirebilir.
  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const response = await finishedResponse;
  const responseUrl = new URL(response.url());
  const data: unknown = await response.json();

  const apiVersion: "old" | "new" =
    responseUrl.hostname === "hotels.check24.de"
      ? "new"
      : "old";

  // Eski API'de tarih bilgisi yanıt URL'sinde bulunmuyor.
  // Bu nedenle beklediğimiz arama sayfasında olduğumuzu
  // ayrıca kontrol ediyoruz.
  if (apiVersion === "old") {
    const currentUrl = new URL(page.url());

    const expectedPath =
      new URL(searchUrl).pathname;

    if (
      currentUrl.hostname !== "hotel.check24.de" ||
      currentUrl.pathname !== expectedPath
    ) {
      throw new Error(
        "CHECK24 old API search context mismatch",
      );
    }
  }

  const parsedOffers =
    apiVersion === "new"
      ? parseCheck24NewAllOffers(data)
      : parseCheck24OldAllOffers(data, nights);

  if (parsedOffers.length === 0) {
    throw new Error(
      `CHECK24 ${apiVersion} API returned no valid offers`,
    );
  }

  // Yeni API teklifinde gece sayısı bulunmuyor.
  // Onu yalnızca doğrulanmış arama tarihlerinden alıyoruz.
const offers: Check24ParsedOffer[] =
  parsedOffers.map((offer) => ({
    ...offer,
    nights:
      apiVersion === "new"
        ? nights
        : offer.nights,
  }));

  return {
    apiVersion,
    url: page.url(),
    nights,
    totalOffers: offers.length,
    offers,
    bestOffers: getCheck24BeachBestOffers(
      offers,
      nights,
    ),
  };
}

