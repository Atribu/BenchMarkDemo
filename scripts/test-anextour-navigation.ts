import { chromium } from "patchright";

const url = new URL("https://nurhotel.anextour.de/search/offer");

url.searchParams.set("aid", "1708");
url.searchParams.set("ibe", "hotel");
url.searchParams.set("dur", "5");
url.searchParams.set("ddate", "2026-10-29");
url.searchParams.set("rdate", "2026-11-03");
url.searchParams.set("srtReg", "15");
url.searchParams.set("srtHot", "5");
url.searchParams.set("stars", "3");
url.searchParams.set("adult", "2");

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
  });

  try {
    const page = await browser.newPage();

    page.on("response", async (response) => {
  const url = response.url();

  if (!url.includes("/api/search/offers/")) return;

  const endpoint = new URL(url).pathname;

  console.log("[ANEX] API Response:", {
    endpoint,
    status: response.status(),
  });

  if (
  endpoint.endsWith("/list") ||
  endpoint.endsWith("/departuredate")
) {
  const request = response.request();

  let payload: Record<string, unknown> | null = null;

  try {
    payload = request.postDataJSON() as Record<string, unknown>;
  } catch {
    // JSON olmayan istekleri atla.
  }

  console.log("[ANEX] Request criteria:", {
    endpoint,
    method: request.method(),
    dates: payload?.dates,
    durations: payload?.durations,
    accommodations: payload?.accommodations,
    adults: payload?.ageOfPersons,
  });
}

  if (
    !endpoint.endsWith("/list") &&
    !endpoint.endsWith("/departuredate")
  ) {
    return;
  }

  try {
    const json = await response.json();

    const items = json?.data?.items;

    if (!Array.isArray(items)) return;

    const operators = [...new Set(
      items.map((item) => item.tourOperator?.id ?? "unknown"),
    )];

    const exactDateOffers = items.filter(
  (item) =>
    item.accommodationId === "1708" &&
    item.startDate === "2026-10-29" &&
    item.endDate === "2026-11-03" &&
    item.duration?.overnights === 5 &&
    item.price?.total?.type === "PARTY" &&
    item.price?.total?.currency === "EUR",
);

if (endpoint.endsWith("/list")) {
  console.table(
    exactDateOffers.map((item) => ({
      operatorId: item.tourOperator?.id,
      operator: item.tourOperator?.name,
      room: item.units?.[0]?.room?.name,
      board: item.units?.[0]?.board?.code,
      total: item.price?.total?.amount,
    })),
  );
}

const anexOffers = items.filter(
  (item) => item.tourOperator?.id === "ANEX",
);

// Yalnızca seçilen tarihlerdeki ANEX Tour teklifleri
const exactOffers = anexOffers.filter(
  (item) =>
    item.accommodationId === "1708" &&
    item.startDate === "2026-10-28" &&
    item.endDate === "2026-11-02" &&
    item.duration?.overnights === 5 &&
    item.price?.total?.type === "PARTY" &&
    item.price?.total?.currency === "EUR",
);

// Kesin tarih eşleşmelerini terminale yazdır
console.log("[ANEX] Exact date matches:", {
  endpoint,
  count: exactOffers.length,
  offers: exactOffers.map((item) => ({
    room: item.units?.[0]?.room?.name,
    board: item.units?.[0]?.board?.code,
    total: item.price?.total?.amount,
    checkIn: item.startDate,
    checkOut: item.endDate,
  })),
});

// Mevcut loglama kodun aynen devam edecek
console.log("[ANEX] Offer summary:", {
  endpoint,
  totalOffers: items.length,
  operators,
  anexOffers: anexOffers.length,
  sample: anexOffers.slice(0, 3).map((item) => ({
    hotelId: item.accommodationId,
    operator: item.tourOperator?.name,
    room: item.units?.[0]?.room?.name,
    board: item.units?.[0]?.board?.code,
    checkIn: item.startDate,
    checkOut: item.endDate,
    nights: item.duration?.overnights,
    price: item.price?.total?.amount,
    currency: item.price?.total?.currency,
    priceType: item.price?.total?.type,
  })),
});
      
  } catch (error) {
    console.log(
      "[ANEX] Response parse error:",
      error instanceof Error ? error.message : error,
    );
  }
});

    const response = await page.goto(url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    console.log("[ANEX] HTTP status:", response?.status());
    console.log("[ANEX] Final URL:", page.url());
    console.log("[ANEX] Title:", await page.title());

try {
  await page.getByText(/Miramare Beach/i).first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
} catch {
  console.log("[ANEX] Hotel text not visible within 20 seconds");
}

console.log("[ANEX] Diagnostics:", {
  finalUrl: page.url(),
  title: await page.title(),

  hotelTextCount: await page
    .getByText(/Miramare Beach/i)
    .count(),

  bodyContainsHotel: await page
    .locator("body")
    .innerText()
    .then((text) => /Miramare Beach/i.test(text))
    .catch(() => false),

  bodyPreview: await page
    .locator("body")
    .innerText()
    .then((text) => text.slice(0, 1200))
    .catch(() => ""),

  pageLength: (await page.content()).length,
});

await page.screenshot({
  path: "anextour-navigation.png",
  fullPage: false,
});

await page.waitForTimeout(15000);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);