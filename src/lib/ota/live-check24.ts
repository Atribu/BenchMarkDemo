
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

export interface Check24HotelSearchConfig {
  hotelId: string;
  hotelName: string;
  accommodationId?: string;
  accommodationSlug?: string;
}

export type Check24HotelResult = {
  apiVersion: "old" | "new";
  url: string;
  nights: number;
  totalOffers: number;
  offers: Check24ParsedOffer[];
};

async function handleCheck24Cookies(page: Page): Promise<void> {
  const cookieText = page.getByText(
    "Unvergleichlich lecker",
    { exact: true },
  );

  const visible = await cookieText
    .isVisible()
    .catch(() => false);

  if (!visible) {
    console.log("[CHECK24] Cookie dialog not visible.");
    return;
  }

  console.log("[CHECK24] Cookie dialog detected.");

  const necessaryCookies = page.getByText(
    "Nur notwendige Cookies",
    { exact: true },
  );

  const count = await necessaryCookies.count();

  console.log("[CHECK24] Necessary cookie controls:", count);

  if (!count) {
    throw new Error(
      "CHECK24 cookie dialog visible but necessary cookies control missing.",
    );
  }

  await necessaryCookies.first().click({
    timeout: 5_000,
  });

  const stillVisible = await cookieText
    .isVisible()
    .catch(() => false);

  if (stillVisible) {
    throw new Error(
      "CHECK24 cookie dialog remained visible after consent.",
    );
  }

  console.log("[CHECK24] Cookie dialog closed.");
}

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


export function buildCheck24HotelSearchUrl(
  config: Check24HotelSearchConfig,
  checkIn: string,
  checkOut: string,
): string {
  getNights(checkIn, checkOut);

  // Yeni CHECK24 API kimliği ve URL slug'ı
  // doğrulanan otellerde yeni arayüzü kullan.
  if (config.accommodationId && config.accommodationSlug) {
    const url = new URL(
      `https://hotels.check24.de/accommodation/` +
        `${config.accommodationSlug}-${config.accommodationId}`,
    );

    url.searchParams.set("checkinDate", checkIn);
    url.searchParams.set("checkoutDate", checkOut);
    url.searchParams.set("occupancy", "[A|A]");

    return url.toString();
  }

  // Eski CHECK24 URL yapısını kullanan oteller
  // için mevcut davranışı koru.
  return (
    "https://hotel.check24.de/search/" +
    `${encodeURIComponent(config.hotelName)}-${config.hotelId}/` +
    `${checkIn}/${checkOut}/%5BA%7CA%5D/hotel.html`
  );
}


/**
 * Collects CHECK24's completed hotel-only search for any catalogued property.
 * The legacy search route is intentional: unlike the newer accommodation route,
 * it uses the public numeric hotel id that is available for every configured
 * hotel and still returns the same clustered offer payload.
 */

export async function collectCheck24Hotel(
  page: Page,
  config: Check24HotelSearchConfig,
  checkIn: string,
  checkOut: string,
): Promise<Check24HotelResult> {
  const nights = getNights(checkIn, checkOut);
  const searchUrl = buildCheck24HotelSearchUrl(
    config,
    checkIn,
    checkOut,
  );

  console.log("[CHECK24] Collector config:", {
  hotel: config.hotelName,
  hotelId: config.hotelId,
  accommodationId: config.accommodationId,
  checkIn,
  checkOut,
});

  // Önce dinleyici kurulur. Böylece hızlı API
  // cevaplarını navigasyon sırasında kaçırmayız.

  const debugCheck24 = (label: string, url: string, extra = {}) => {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  if (!parsed.hostname.endsWith("check24.de")) return;

  if (
    !parsed.pathname.includes("/api/") &&
    !parsed.pathname.includes("/search")
  ) {
    return;
  }

  console.log(`[CHECK24 ${label}]`, {
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    accommodationId: parsed.searchParams.get("accommodationId"),
    checkIn: parsed.searchParams.get("checkinDate"),
    checkOut: parsed.searchParams.get("checkoutDate"),
    ...extra,
  });
};

page.on("request", (request) => {
  debugCheck24("REQUEST", request.url(), {
    method: request.method(),
  });
});

page.on("response", (response) => {
  debugCheck24("RESPONSE", response.url(), {
    status: response.status(),
  });
});

page.on("requestfailed", (request) => {
  debugCheck24("FAILED", request.url(), {
    error: request.failure(),
  });
});

  const finishedResponsePromise = page.waitForResponse(
    async (response) => {
      if (response.status() !== 200) return false;

      const url = new URL(response.url());

      const isOldApi =
        url.hostname === "hotel.check24.de" &&
        /^\/api-hotel\/proxy\/portale\/hotels\/searches\/[^/]+\/clustered_offers\.json$/.test(
          url.pathname,
        );

        if (
  url.hostname === "hotels.check24.de" &&
  url.pathname === "/api/offers"
) {
  const actualId = url.searchParams.get("accommodationId");
  const actualCheckIn = url.searchParams.get("checkinDate");
  const actualCheckOut = url.searchParams.get("checkoutDate");
  const actualOccupancy = url.searchParams.get("occupancy");

  console.log("[CHECK24] New API matching:", {
    status: response.status(),

    expectedId: config.accommodationId,
    actualId,
    hotelIdMatches:
      actualId === config.accommodationId,

    checkInMatches: actualCheckIn === checkIn,
    checkOutMatches: actualCheckOut === checkOut,
    occupancyMatches: actualOccupancy === "[A|A]",
  });
}

      const isNewApi =
        Boolean(config.accommodationId) &&
        url.hostname === "hotels.check24.de" &&
        url.pathname === "/api/offers" &&
        url.searchParams.get("accommodationId") ===
          config.accommodationId &&
        url.searchParams.get("checkinDate") === checkIn &&
        url.searchParams.get("checkoutDate") === checkOut &&
        url.searchParams.get("occupancy") === "[A|A]";

      if (!isOldApi && !isNewApi) return false;

      if (url.hostname === "hotels.check24.de" &&
    url.pathname === "/api/offers") {
  console.log("[CHECK24] Main offers matching:", {
    hotel: config.hotelName,
    status: response.status(),
    expectedAccommodationId: config.accommodationId,
    actualAccommodationId: url.searchParams.get("accommodationId"),
    expectedDates: [checkIn, checkOut],
    actualDates: [
      url.searchParams.get("checkinDate"),
      url.searchParams.get("checkoutDate"),
    ],
    matches: isNewApi,
  });
}

      try {
        const data = await response.json();

       if (isNewApi) {
  console.log("[CHECK24] Main offers status:", {
    hotel: config.hotelName,
    status: data?.offers?.status,
    fittingRooms: Array.isArray(data?.offers?.roomCategoriesFitting)
      ? data.offers.roomCategoriesFitting.length
      : null,
    nonFittingRooms: Array.isArray(
      data?.offers?.roomCategoriesNonFitting,
    )
      ? data.offers.roomCategoriesNonFitting.length
      : null,
  });

  return data?.offers?.status === 2;
}

        return (
          data?.status?.state === "finished" &&
          data?.status?.isExpired === false &&
          data?.status?.searchRoomConfiguration === "[A|A]"
        );
      } catch {
        return false;
      }
    },
    { timeout: 60_000 },
  ).then(
    (response) => ({ response }),
    (error: unknown) => ({ error }),
  );

  const navigation = await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  if (!navigation || navigation.status() >= 400) {
    throw new Error(
      `CHECK24 navigation HTTP ${navigation?.status() ?? "unknown"}`,
    );
  }

  await handleCheck24Cookies(page);

  console.log("[CHECK24] Page diagnostics:", {
  url: page.url(),
  title: await page.title().catch(() => "unknown"),
  frames: page.frames().map((frame) => ({
    name: frame.name(),
    url: frame.url().slice(0, 160),
  })),
  body: await page.locator("body")
    .innerText({ timeout: 3_000 })
    .then((text) => text.slice(0, 500))
    .catch(() => ""),
});

  const result = await finishedResponsePromise;

  if ("error" in result) {
    throw result.error;
  }

  const response = result.response;
  const responseUrl = new URL(response.url());

  const apiVersion: "old" | "new" =
    responseUrl.hostname === "hotels.check24.de"
      ? "new"
      : "old";

  // Eski API'de sorgu tarihleri response URL'sinde
  // bulunmadığından sayfa bağlamını doğrula.
  if (apiVersion === "old") {
    const currentUrl = new URL(page.url());
    const expectedUrl = new URL(searchUrl);

    if (
      currentUrl.hostname !== expectedUrl.hostname ||
      currentUrl.pathname !== expectedUrl.pathname
    ) {
      throw new Error(
        "CHECK24 old API search context mismatch",
      );
    }
  }

  if (apiVersion === "new") {
    const currentUrl = new URL(page.url());

    const pageAccommodationId =
      currentUrl.pathname.match(/-([a-f0-9]{32})$/i)?.[1];

    if (
      currentUrl.hostname !== "hotels.check24.de" ||
      pageAccommodationId !== config.accommodationId ||
      currentUrl.searchParams.get("checkinDate") !== checkIn ||
      currentUrl.searchParams.get("checkoutDate") !== checkOut ||
      currentUrl.searchParams.get("occupancy") !== "[A|A]"
    ) {
      throw new Error(
        "CHECK24 new API search context mismatch",
      );
    }
  }

  const data: unknown = await response.json();

  const parsedOffers =
    apiVersion === "new"
      ? parseCheck24NewAllOffers(data)
      : parseCheck24OldAllOffers(data, nights);

  const offers: Check24ParsedOffer[] =
    parsedOffers.map((offer) => ({
      ...offer,
      nights:
        apiVersion === "new"
          ? nights
          : offer.nights,
    }));

  console.log("[CHECK24] Generic collection:", {
    hotel: config.hotelName,
    apiVersion,
    checkIn,
    checkOut,
    nights,
    totalOffers: offers.length,
  });

  if (!offers.length) {
    throw new Error(
      `CHECK24 ${apiVersion} API returned no valid offers`,
    );
  }

  return {
    apiVersion,
    url: page.url(),
    nights,
    totalOffers: offers.length,
    offers,
  };
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
    { timeout: 15_000 },
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

