import type { Page } from "playwright";
import type {
  BenchmarkWindowDefinition,
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "../benchmark/types";
import {
  createBrowserPage,
  normalizeInlineText,
  parsePriceFromText,
  resolveProviderLiveConfig,
} from "./live-helpers";
import {
  classifyRoom,
  deduplicateOffers,
  matchOfferRoom,
  selectOfferQuotes,
} from "./offer-matching";
import { assertPricePageAccessible } from "./browser-diagnostics";
import { hasCompatibleView } from "./room-matching";

const SEARCH_URL = "https://www.onthebeach.co.uk/_p/hotels";
const DESTINATION = "Antalya (Alanya, Belek, Lara Beach, Side), Turkey";
const VERIFICATION_FRAME = 'iframe[title="Verification system"]';

export interface OnTheBeachSnapshot {
  sourceUrl: string;
  hotelName: string;
  checkInLabel: string;
  returnLabel: string;
  nights: number;
  adults: number;
  children: number;
  infants: number;
  rooms: number;
  totalSelected: boolean;
  offers: { roomName: string; board: string; priceText: string }[];
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

// Legacy Booking/Expedia parsers still import this; On the Beach uses strict offers below.
export function namedRoomRank(
  roomId: string,
  name: string,
): number | null {
  const normalizedName = normalizeInlineText(name);

  // Economy sadece Economy Room ile eşleşsin.
  if (roomId === "economy") {
    if (/^Economy Room$/i.test(normalizedName)) {
      return 0;
    }

    if (/^Economy$/i.test(normalizedName)) {
      return 5;
    }

    return null;
  }

  // Corner sadece Corner Room ile eşleşsin.
  if (roomId === "corner") {
    if (/^Superior Corner Room$/i.test(normalizedName)) {
      return 0;
    }

    if (/\bcorner\b/i.test(normalizedName)) {
      return 5;
    }

    return null;
  }

  if (
    !hasCompatibleView(roomId, normalizedName) ||
    /\b(suite|family|deluxe|corner|familienzimmer|eckzimmer)\b/i.test(
      normalizedName,
    )
  ) {
    return null;
  }

  if (
    roomId.startsWith("superior") &&
    !/\bsuperior\b/i.test(normalizedName)
  ) {
    return null;
  }

  if (
    roomId.startsWith("standard") &&
    /\bsuperior\b/i.test(normalizedName)
  ) {
    return null;
  }

  return (
    (/\b(side|partial|seitl|seitlichem|seitlicher|teilmeerblick)\b/i.test(
      normalizedName,
    )
      ? 10
      : 0) +
    (/promo|economy|no balcony|without balcony/i.test(
      normalizedName,
    )
      ? 20
      : 0)
  );
}

export function parseOnTheBeachOffers(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  snapshot: OnTheBeachSnapshot,
): CollectedOffer[] {
  const url = new URL(snapshot.sourceUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.onthebeach.co.uk" ||
    !/^\/hotel_searches\/show\/\d+\/?$/.test(url.pathname) ||
    scope.currency !== "GBP" ||
    normalizeInlineText(snapshot.hotelName).toLowerCase() !==
      scope.hotelName.toLowerCase() ||
    snapshot.checkInLabel.match(/\b\d{1,2} [A-Za-z]{3,4} \d{4}\b/)?.[0] !==
      dateLabel(window.checkIn) ||
    snapshot.returnLabel.match(/\b\d{1,2} [A-Za-z]{3,4} \d{4}\b/)?.[0] !==
      dateLabel(window.checkOut) ||
    snapshot.nights !== window.nights ||
    snapshot.adults !== 2 ||
    snapshot.children !== 0 ||
    snapshot.infants !== 0 ||
    snapshot.rooms !== 1 ||
    !snapshot.totalSelected
  )
    throw new Error(
      "On the Beach otel, tarih, kişi veya toplam fiyat seçimi doğrulanamadı.",
    );
  const offers: CollectedOffer[] = [];
  for (const offer of snapshot.offers) {
    // Pennies can be a separate DOM span; reject deposits or mixed unit prices.
    const total = offer.priceText
      .replace(/\s+/g, "")
      .match(/^£((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)perparty$/i);
    const price = total ? parsePriceFromText(`£${total[1]}`, "GBP") : null;
    const roomName = normalizeInlineText(offer.roomName);
    if (price === null || !Number.isFinite(price) || price <= 0 || !roomName)
      continue;
    const roomFeatures = classifyRoom(roomName);
    offers.push({
      id: `onthebeach:${scope.id}:${window.id}:${offers.length}`,
      providerKey: provider.key,
      scopeKey: scope.id,
      windowId: window.id,
      checkIn: window.checkIn,
      checkOut: window.checkOut,
      nights: window.nights,
      adults: 2,
      rooms: 1,
      price,
      currency: scope.currency,
      roomName,
      roomFeatures,
      ...matchOfferRoom(scope, roomFeatures),
      observedAt: new Date().toISOString(),
      sourceHint: snapshot.sourceUrl,
      terms: {
        board: normalizeInlineText(offer.board) || "Belirtilmedi",
        cancellation: "Sonuç kartında belirtilmedi",
        taxes: "Vergi dökümü ayrıca doğrulanmadı",
        availability:
          "Hotel Only; 1 oda, 2 yetişkin; Total Hotel Price / per party. Son fiyat ve müsaitlik rezervasyon adımında tekrar doğrulanmalı.",
      },
    });
  }
  return deduplicateOffers(offers);
}

export function parseOnTheBeachQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  snapshot: OnTheBeachSnapshot,
): ProviderQuote[] {
  return selectOfferQuotes(
    provider,
    scope,
    window,
    parseOnTheBeachOffers(provider, scope, window, snapshot),
    snapshot.sourceUrl,
  );
}

async function dismissCookieNotice(page: Page) {
  const overlay = page.locator("#ccc-overlay");
  await overlay
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => undefined);
  if (!(await overlay.isVisible())) return;
  const reject = page
    .locator("#ccc")
    .getByRole("button", {
      name: /I Do Not Accept|reject|decline|necessary|essential.*only/i,
    })
    .first();
  if (!(await reject.count()))
    throw new Error("Çerez tercih penceresi kapatılamadı.");
  await reject.click();
  await overlay.waitFor({ state: "hidden" });
}

async function assertSearchAccessible(page: Page) {
  if (await page.locator(VERIFICATION_FRAME).isVisible())
    throw new Error(
      "Site doğrulaması gerekiyor (CAPTCHA); otomatik fiyat alınamadı.",
    );
  await assertPricePageAccessible(page);
}

async function runHotelSearch(
  page: Page,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  onStep: (step: string) => void,
): Promise<OnTheBeachSnapshot> {
  if (window.nights < 2 || window.nights > 28)
    throw new Error(
      "On the Beach uçaksız formu 2–28 gecelik konaklama destekliyor.",
    );
  const response = await page.goto(SEARCH_URL, {
    waitUntil: "load",
    timeout: 45000,
  });
  await assertPricePageAccessible(page, response?.status());
  onStep("Çerez tercihleri");
  await dismissCookieNotice(page);
  await assertSearchAccessible(page);
  onStep("Hotel Only formunu açma");
  await page.getByRole("tab", { name: "Hotel Only", exact: true }).click();
  const destination = page.getByRole("searchbox", {
    name: "Enter destination",
    exact: true,
  });
  await destination.waitFor({ timeout: 30000 });
  onStep("Çerez tercihleri");
  await dismissCookieNotice(page);
  onStep("Antalya seçimi");
  await assertSearchAccessible(page);
  await destination.fill("Antaly");
  await destination.pressSequentially("a");
  await page.getByRole("button", { name: DESTINATION, exact: true }).click();
  onStep("Giriş tarihi seçimi");
  await page.getByRole("button", { name: /Check-in Date/ }).click();
  await page
    .locator(`label[for="departure-date_${window.checkIn.slice(0, 7)}"]`)
    .click();
  await page
    .locator(`button.datepicker__button[value="${window.checkIn}"]`)
    .click();
  onStep("Gece ve kişi seçimi");
  await page.getByRole("button", { name: /^Nights/ }).click();
  await page
    .locator('select[name="search[nights]"]')
    .selectOption(String(window.nights));
  if (
    await page
      .getByRole("heading", { name: "How long for?", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: /^Nights/ }).click();
  await page.getByRole("button", { name: /^Your Party/ }).click();
  for (const [field, value] of Object.entries({
    adults: "2",
    children: "0",
    infants: "0",
    number_of_rooms: "1",
  })) {
    await page.locator(`select[name="search[${field}]"]`).selectOption(value);
  }
  await page.getByRole("button", { name: /^Your Party/ }).click();
  onStep("Otel arama sonuçları");
  await page.getByRole("button", { name: /^Search/ }).click();
  await page.waitForURL(/\/hotel_searches\/show\/\d+/, { timeout: 60000 });
  await page
    .locator(".hotel-result")
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
  onStep("Otel adı filtresi");
  await assertSearchAccessible(page);
  const hotelFilter = page.getByRole("textbox", {
    name: "Hotel Name",
    exact: true,
  });
  await hotelFilter.fill(scope.hotelName.slice(0, -1));
  await hotelFilter.pressSequentially(scope.hotelName.slice(-1));
  await page
    .locator(".autocomplete__item")
    .filter({ hasText: scope.hotelName })
    .click();
  const card = page
    .locator(".hotel-result")
    .filter({ has: page.locator("h3").filter({ hasText: scope.hotelName }) });
  await card.waitFor({ state: "visible", timeout: 30000 });
  onStep("Toplam otel fiyatı seçimi");
  const totalToggle = card.locator(
    'input[type="checkbox"][name="price[toggle]"]',
  );
  // The native checkbox sits off-screen; use its visible label instead.
  if (!(await totalToggle.isChecked()))
    await card
      .locator("label.toggle-switch__label .toggle-switch__handle")
      .click();
  await card
    .locator(".board-option__price-label")
    .filter({ hasText: "per party" })
    .first()
    .waitFor();
  onStep("Oda seçenekleri");
  const more = card.getByText("View more board options", { exact: true });
  if (await more.isVisible()) {
    await more.click();
    await card.getByText("Minimise board options", { exact: true }).waitFor();
  }
  onStep("Fiyat ve arama koşullarını doğrulama");
  const offers = await card.locator(".board-option").evaluateAll((rows) =>
    rows
      .filter((row) => (row as HTMLElement).getClientRects().length > 0)
      .map((row) => {
        const title = row.querySelector(".board-option__title");
        const board = title?.querySelector("strong")?.textContent?.trim() ?? "";
        return {
          roomName: (title?.textContent ?? "").replace(board, "").trim(),
          board,
          priceText:
            row.querySelector(".board-option__price")?.textContent ?? "",
        };
      }),
  );
  const numbers = await page
    .locator('select[name^="search["]')
    .evaluateAll((selects) =>
      Object.fromEntries(
        selects.map((el) => [
          (el as HTMLSelectElement).name,
          Number((el as HTMLSelectElement).value),
        ]),
      ),
    );
  return {
    sourceUrl: page.url(),
    hotelName: await card.locator("h3").first().innerText(),
    checkInLabel: await page
      .getByRole("button", { name: /Check-in Date/ })
      .innerText(),
    returnLabel: await page
      .getByText(new RegExp(`^Return ${dateLabel(window.checkOut)}$`))
      .innerText(),
    nights: numbers["search[nights]"],
    adults: numbers["search[adults]"],
    children: numbers["search[children]"],
    infants: numbers["search[infants]"],
    rooms: numbers["search[number_of_rooms]"],
    totalSelected: await card
      .locator('input[type="checkbox"][name="price[toggle]"]')
      .isChecked(),
    offers,
  };
}

export async function collectOnTheBeachLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  dependencies: {
    createPage?: typeof createBrowserPage;
    search?: typeof runHotelSearch;
  } = {},
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const warnings: string[] = [];
  const offers: CollectedOffer[] = [];
  for (const window of scope.windows) {
    let handle: Awaited<ReturnType<typeof createBrowserPage>> | undefined;
    let step = "Hotel Only sayfasını açma";
    try {
      handle = await (dependencies.createPage ?? createBrowserPage)(
        resolveProviderLiveConfig(provider.key, scope.currency),
      );
      handle.page.setDefaultTimeout(15000);
      const snapshot = await (dependencies.search ?? runHotelSearch)(
        handle.page,
        scope,
        window,
        (next) => {
          step = next;
        },
      );
      const windowOffers = parseOnTheBeachOffers(
        provider,
        scope,
        window,
        snapshot,
      );
      offers.push(...windowOffers);
      quotes.push(
        ...selectOfferQuotes(
          provider,
          scope,
          window,
          windowOffers,
          snapshot.sourceUrl,
        ),
      );
    } catch (error) {
      const verificationVisible = await handle?.page
        .locator(VERIFICATION_FRAME)
        .isVisible()
        .catch(() => false);
      let reason = verificationVisible
        ? "Site doğrulaması gerekiyor (CAPTCHA); otomatik fiyat alınamadı."
        : error instanceof Error
          ? error.message.split("\n")[0]
          : "Arama tamamlanamadı.";
      if (handle && !verificationVisible) {
        try {
          await assertPricePageAccessible(handle.page);
        } catch (diagnostic) {
          reason = diagnostic instanceof Error ? diagnostic.message : reason;
        }
      }
      warnings.push(
        `On the Beach / ${scope.hotelName} / ${window.checkIn} / ${step}: ${reason}`,
      );
      quotes.push(
        ...scope.rooms.map((room): ProviderQuote => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          currency: scope.currency,
          price: null,
          status: "manual-review",
          dataMode: "live",
          sourceHint: handle?.page.url() || SEARCH_URL,
          reason: `Uçaksız otel araması tamamlanamadı (${step}): ${reason}`,
        })),
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
  return { quotes, warnings, offers };
}
