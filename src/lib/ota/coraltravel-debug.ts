import { createPatchrightBrowserPage } from "./patchright-browser";
import type { Page } from "patchright";

const GERMAN_MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Geçersiz ISO tarih: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Geçersiz takvim tarihi: ${value}`);
  }

  return { year, month, day };
}

function monthLabel(value: string) {
  const { year, month } = parseIsoDate(value);
  return `${GERMAN_MONTHS[month - 1]}, ${year}`;
}

function germanDate(value: string) {
  const { year, month, day } = parseIsoDate(value);
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

async function selectCoralTravelDate(page: Page, value: string) {
  const label = monthLabel(value);
  const { day } = parseIsoDate(value);
  const wrappers = page.locator(
    ".calwrapper:visible .first-cal-wrapper, " +
      ".calwrapper:visible .sec-cal-wrapper",
  );

  for (let attempt = 0; attempt < 18; attempt++) {
    const matchingMonth = wrappers.filter({
      has: page.locator(".month_header", { hasText: label }),
    });

    if ((await matchingMonth.count()) > 0) {
      const dayButton = matchingMonth
        .first()
        .locator("button.mday-btn:not(.disabledday)")
        .filter({ hasText: new RegExp(`^0?${day}$`) });

      await dayButton.first().waitFor({ state: "visible", timeout: 10_000 });
      await dayButton.first().click();
      console.log("[CORALTRAVEL] Calendar date selected:", {
        date: value,
        month: label,
      });
      return;
    }

    const headers = await wrappers.locator(".month_header").allTextContents();
    const target = parseIsoDate(value);
    const visibleMonths = headers.flatMap((header) => {
      const normalized = header.replace(/chevron_(?:left|right)/g, "").trim();
      const match = GERMAN_MONTHS.map((month, index) => ({ month, index })).find(
        ({ month }) => normalized.startsWith(`${month},`),
      );
      const year = Number(normalized.split(",")[1]?.trim());
      return match && Number.isInteger(year)
        ? [year * 12 + match.index]
        : [];
    });

    if (!visibleMonths.length) {
      throw new Error("Coral Travel takvim ay başlıkları okunamadı.");
    }

    const targetMonth = target.year * 12 + target.month - 1;
    const goBack = targetMonth < Math.min(...visibleMonths);
    const direction = goBack ? "left" : "right";
    const navigation = page
      .locator(`.calwrapper:visible .month_header`)
      .getByText(`chevron_${direction}`, { exact: true });

    await navigation.first().click();
    await page.waitForTimeout(150);
  }

  throw new Error(`${value} tarihi Coral Travel takviminde bulunamadı.`);
}

async function fillCoralTravelSearch(page: Page) {
  const checkIn = "2027-05-10";
const checkOut = "2027-05-15";

  // 1. Nur Hotel sekmesine geç.
  await page.getByText("Nur Hotel", { exact: true }).click();

  console.log("[CORALTRAVEL] Nur Hotel selected.");

  // 2. Otel arama alanını aç.
  await page
    .getByText("Reiseziel oder Hotelname", {
      exact: true,
    })
    .click({ timeout: 10_000 });

  console.log("[CORALTRAVEL] Hotel search opened.");

  // 3. Açılan gerçek input alanlarını incele.
  const inputs = await page.locator("input").evaluateAll(
    (elements) =>
      elements.map((element) => ({
        outerHTML: element.outerHTML.slice(0, 350),
        placeholder: element.getAttribute("placeholder"),
        type: element.getAttribute("type"),
      })),
  );

  console.log("[CORALTRAVEL] Available inputs:", inputs);

  // 4. Görünür metin input'unu bul.
  const hotelInput = page.locator(
    'input[type="text"]:visible, input:not([type]):visible',
  ).last();

  await hotelInput.fill("Miramare", {
    timeout: 10_000,
  });

  console.log("[CORALTRAVEL] Hotel name entered.");

  // 5. Miramare Queen Hotel önerisini seç.
const hotelSuggestion = page.getByText(
  "Miramare Queen Hotel",
  { exact: true },
).last();

const isAvailable = await hotelSuggestion
  .isVisible()
  .catch(() => false);

if (!isAvailable) {
  console.log(
    "[CORALTRAVEL QUEEN] Queen arama önerilerinde bulunamadı.",
  );

  return;
}

await hotelSuggestion.click();

console.log(
  "[CORALTRAVEL QUEEN] Hotel selected.",
);

await hotelSuggestion.waitFor({
  state: "visible",
  timeout: 15_000,
});

await hotelSuggestion.click();

console.log("[CORALTRAVEL] Hotel selected:", {
  hotel: "Miramare Queen Hotel",
});

// 6. Tarih alanını aç.
const dateField = page
  .getByText(
    /\d{2}\.\d{2}\.\d{4}\s*-\s*\d{2}\.\d{2}\.\d{4}/,
  )
  .first();

await dateField.waitFor({
  state: "visible",
  timeout: 10_000,
});

await dateField.click();

console.log("[CORALTRAVEL] Datepicker opened.");

await selectCoralTravelDate(page, checkIn);
await selectCoralTravelDate(page, checkOut);

const expectedRange = `${germanDate(checkIn)} - ${germanDate(checkOut)}`;
await page.getByText(expectedRange, { exact: true }).first().waitFor({
  state: "visible",
  timeout: 10_000,
});

  console.log("[CORALTRAVEL] Requested dates:", {
    checkIn,
    checkOut,
    displayedRange: expectedRange,
  });

  const searchButton = page.getByText("URLAUB FINDEN", { exact: true }).first();
  await searchButton.waitFor({ state: "visible", timeout: 10_000 });
  await searchButton.click();

console.log("[CORALTRAVEL] Search submitted.");

await page.waitForURL(
  (url) => url.pathname.startsWith("/offers"),
  { timeout: 45_000 },
);

console.log("[CORALTRAVEL] Offers page opened:", {
  pathname: new URL(page.url()).pathname,
});

// Otelin teklif detaylarına geç.
const offersButton = page.getByText(
  "Zu den Angeboten",
  { exact: true },
).first();

await offersButton.waitFor({
  state: "visible",
  timeout: 20_000,
});

await offersButton.click();

console.log("[CORALTRAVEL] Offer details opened.");
}

export const __coralTravelDebugInternal = {
  germanDate,
  monthLabel,
  parseIsoDate,
};

export async function debugCoralTravel() {
  const handle = await createPatchrightBrowserPage({
    profilePath: `./.benchmark-state/coraltravel-debug-${process.pid}`,
    headless: false,
    market: "de",
  });

  const { page, context } = handle;

  let capturedResponses = 0;
  let capturedOffers = 0;
  let capturedHotelResponses = 0;
  let capturedOfferShape = false;

  // Bütün context üzerindeki response olaylarını izle.
  context.on("response", async (response) => {
    const url = response.url();
    const request = response.request();
if (
  response.request().method() === "POST" &&
  new URL(response.url()).pathname ===
    "/api/trafics/completions" &&
  response.status() === 200
) {
  try {
    const data: unknown = await response.json();

    console.log("[CORALTRAVEL QUEEN] Completions:", {
      data: JSON.stringify(data).slice(0, 6000),
    });
  } catch (error) {
    console.log(
      "[CORALTRAVEL QUEEN] Completions error:",
      error,
    );
  }
} 
    if (
      !url.includes("coraltravel.de") &&
      !url.includes("traffics")
    ) {
      return;
    }

    const method = request.method();
    const status = response.status();

    if (
      !url.includes("/api/") &&
      !url.includes("offers")
    ) {
      return;
    }

if (
  url.includes("/api/trafics/") &&
  !url.includes("/api/trafics/hotels")
) {
  console.log("[CORALTRAVEL] Network:", {
    method,
    status,
    url: url.slice(0, 250),
  });
}

if (
  method === "POST" &&
  status === 200 &&
  (
    new URL(url).pathname === "/api/trafics/hotels" ||
    new URL(url).pathname === "/api/trafics/hotels/giataId"
  )
) {
  capturedHotelResponses++;

  try {
    const data: unknown = await response.json();

    const result = data as {
  totalResultCount?: string | number;
  hotelList?: Array<{
    code?: string;
    name?: string;
    giata?: {
      hotelId?: string | number;
    };
  }>;
};

const queenHotels = (result.hotelList ?? []).filter(
  (hotel) =>
    /miramare\s*queen/i.test(hotel.name ?? "") ||
    String(hotel.giata?.hotelId ?? "") === "4894",
);

console.log("[CORALTRAVEL QUEEN] Hotel discovery:", {
  totalResultCount: result.totalResultCount,
  hotelsInResponse: result.hotelList?.length ?? 0,
  queenHotels,
});

    console.log("[CORALTRAVEL] Hotels response:", {
      endpoint: new URL(url).pathname,
      isArray: Array.isArray(data),
      keys:
        data && typeof data === "object"
          ? Object.keys(data)
          : [],
      preview: JSON.stringify(data).slice(0, 500),
    });
  } catch (error) {
    console.log(
      "[CORALTRAVEL] Hotels response parse failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

    // Fiyat endpoint'i dışındaki istekleri sadece logla.
if (
  new URL(url).pathname !== "/api/trafics/offers" ||
  method !== "POST"
) {
  return;
}

    capturedResponses++;

    try {
      if (status !== 200) {
        return;
      }

      const data: unknown = await response.json();

      if (
        !data ||
        typeof data !== "object" ||
        !("offerList" in data)
      ) {
        console.log(
          "[CORALTRAVEL] Unexpected response structure",
        );
        return;
      }

      const result = data as {
        totalResultCount?: string;
        offerList?: Array<{
          productType?: string;
          flightOffer?: unknown;
          tourOperator?: { code?: string };
          totalPrice?: {
            value?: string;
            currency?: string;
          };
          travelDate?: {
            fromDate?: string;
            toDate?: string;
            duration?: string;
          };
          hotelOffer?: {
            hotel?: {
              giata?: { hotelId?: string };
            };
            roomType?: {
              originalCode?: string;
              originalName?: string;
            };
            boardType?: {
              name?: string;
            };
          };
        }>;
      };

      if (!capturedOfferShape && result.offerList?.length) {
        capturedOfferShape = true;
        const sample = result.offerList[0] as Record<string, unknown>;
        const hotelOffer = sample.hotelOffer as
          | Record<string, unknown>
          | undefined;
        console.log("[CORALTRAVEL] Offer shape:", {
          offerKeys: Object.keys(sample).sort(),
          hotelOfferKeys: hotelOffer ? Object.keys(hotelOffer).sort() : [],
          occupancyKeys: Object.keys(sample)
            .filter((key) => /adult|child|guest|occup|pax|person|room/i.test(key))
            .sort(),
        });
      }

      const offers = (result.offerList ?? []).filter(
        (offer) =>
          offer.productType === "hotelonly" &&
          offer.flightOffer == null &&
          offer.tourOperator?.code === "COR" &&
         String(
  offer.hotelOffer?.hotel?.giata?.hotelId,
) === "4894",
      );

      capturedOffers += offers.length;

      console.log("[CORALTRAVEL] Offers:", {
        totalResultCount: result.totalResultCount,
        responseOffers: result.offerList?.length ?? 0,
        miramareQueenOffers: offers.length,
      });

      console.table(
        offers.map((offer) => ({
          hotelId: offer.hotelOffer?.hotel?.giata?.hotelId,
          from: offer.travelDate?.fromDate,
          to: offer.travelDate?.toDate,
          nights: offer.travelDate?.duration,
          room: offer.hotelOffer?.roomType?.originalName,
          code: offer.hotelOffer?.roomType?.originalCode,
          board: offer.hotelOffer?.boardType?.name,
          price: offer.totalPrice?.value,
          currency: offer.totalPrice?.currency,
        })),
      );
    } catch (error) {
      console.error(
        "[CORALTRAVEL] Response parsing error:",
        error,
      );
    }
  });

  try {
const navigation = await page.goto(
  "https://coraltravel.de/",
  {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  },
);

    console.log("[CORALTRAVEL] Navigation:", {
      status: navigation?.status(),
      url: page.url(),
      title: await page.title(),
    });

    // CoralTravel cookie consent penceresini kapat.
try {
  const rejectCookies = page.getByRole("button", {
    name: "Ablehnen",
    exact: true,
  });

  await rejectCookies.click({
    timeout: 8_000,
  });

  console.log("[CORALTRAVEL] Cookie consent rejected.");
} catch {
  console.log(
    "[CORALTRAVEL] Cookie button not found or already dismissed.",
  );
}

try {
  // await fillCoralTravelSearch(page);
} catch (error) {
  console.error(
    "[CORALTRAVEL] Search form automation failed:",
    error instanceof Error ? error.message : String(error),
  );
}

    console.log(
      "[CORALTRAVEL] Chrome'da Miramare Queen " +
        "Nur Hotel aramasını gerçekleştir.",
    );

    // Sabit 120 saniyelik bekleme yerine
    // terminalden Enter ile sonlandır.
    console.log(
      "[CORALTRAVEL] İşlem bitince terminalde Enter'a bas.",
    );

    if (process.argv.includes("--auto-close")) {
      for (let attempt = 0; attempt < 4; attempt++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(750);
      }
    } else {
      await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.once("data", () => resolve());
      });
    }

console.log("[CORALTRAVEL] Final results:", {
  capturedResponses,
  capturedOffers,
  capturedHotelResponses,
});
  } finally {
    await handle.close();
  }
}
