
import { createPatchrightBrowserPage } from "../src/lib/ota/patchright-browser";

const HOTEL_ID = "136301";

const SOURCE_URL =
  "https://nurhotel.anextour.de/search/offer?" +
  new URLSearchParams({
    aid: HOTEL_ID,
    dur: "7",
    ibe: "hotel",
    ddate: "2027-05-10",
    rdate: "2027-05-17",
    adult: "2",
  });

async function main() {
  const handle = await createPatchrightBrowserPage({
    profilePath: `./.benchmark-state/anex-port-nature-${process.pid}`,
    headless: false,
    market: "de",
  });

  const { page } = handle;

  try {
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/search/offers/list" &&
        response.request().method() === "POST",
      { timeout: 60_000 },
    );

    await page.goto(SOURCE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const response = await responsePromise;

    console.log("[PORT NATURE] HTTP status:", response.status());

    const request = response.request().postDataJSON();

    console.log("[PORT NATURE] Search identity:", {
      accommodationIds:
        request?.accommodations?.ids,
      dates: request?.dates,
      durations: request?.durations,
      adults: request?.ageOfPersons?.adults,
      children: request?.ageOfPersons?.children,
    });

    if (response.status() !== 200) {
      throw new Error(
        `ANEX offer API returned HTTP ${response.status()}`,
      );
    }

    const result: unknown = await response.json();

    if (!result || typeof result !== "object") {
      throw new Error("Unexpected offer response.");
    }

    // Şimdilik sadece yanıtın yapısını inceliyoruz.
    const data = result as Record<string, unknown>;

    console.log("[PORT NATURE] Response keys:", Object.keys(data));

    for (const key of Object.keys(data)) {
      const value = data[key];

      console.log("[PORT NATURE] Response field:", {
        key,
        type: Array.isArray(value)
          ? "array"
          : typeof value,
        length: Array.isArray(value)
          ? value.length
          : undefined,
        objectKeys:
          value && typeof value === "object"
            ? Object.keys(value).slice(0, 30)
            : undefined,
      });
    }

    const responseData = data.data as Record<string, unknown>;

console.log("[PORT NATURE] Result summary:", {
  numberOfResults: responseData.numberOfResults,
  numberOfAccommodations: responseData.numberOfAccommodations,
  moreItemsAvailable: responseData.moreItemsAvailable,
});

const accommodations = responseData.accommodations;

console.log("[PORT NATURE] Accommodations:", {
  type: Array.isArray(accommodations)
    ? "array"
    : typeof accommodations,
  count: Array.isArray(accommodations)
    ? accommodations.length
    : undefined,
  sample: Array.isArray(accommodations)
    ? accommodations.slice(0, 1)
    : accommodations &&
        typeof accommodations === "object"
      ? Object.keys(accommodations).slice(0, 15)
      : undefined,
});

const items = responseData.items;

console.log("[PORT NATURE] Offer items:", {
  count: Array.isArray(items) ? items.length : 0,
  firstItem:
    Array.isArray(items) && items.length
      ? items[0]
      : null,
});

    console.log(
      "[PORT NATURE] Browser remains open for inspection.",
    );

    await new Promise<void>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", () => resolve());
    });
  } finally {
    await handle.close();
  }
}

main().catch(console.error);
