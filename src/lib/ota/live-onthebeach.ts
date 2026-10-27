//live-onthebeach.ts
import type { Page } from "patchright";

import {
  createPatchrightBrowserPage,
  type PatchrightBrowserHandle,
} from "./patchright-browser";
import type {
  BenchmarkWindowDefinition,
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "../benchmark/types";
import {
  normalizeInlineText,
  parsePriceFromText,
  resolveProviderLiveConfig,
} from "./live-helpers";
import {
  classifyRoom,
  deduplicateOffers,
  matchExactRoomAlias,
  matchOfferRoom,
  selectOfferQuotes,
} from "./offer-matching";
import { assertPricePageAccessible } from "./browser-diagnostics";
import { ONTHEBEACH_HOTEL_CONFIG } from "./live-config";
import { hasCompatibleView } from "./room-matching";

const SEARCH_URL = "https://www.onthebeach.co.uk/hotels-in";
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
  aliases: string[] = [],
): number | null {
  const normalizedName = normalizeInlineText(name);

  // Economy sadece Economy Room ile eşleşsin.
  if (roomId === "economy") {
    const aliasRank = aliases.findIndex(
      (alias) =>
        normalizeInlineText(alias).toLowerCase() === normalizedName.toLowerCase(),
    );
    if (aliasRank >= 0) return aliasRank;

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

const normalMatch = matchOfferRoom(scope, roomFeatures);

let specificMatch:
  | {
      matchedRoomId?: string;
      matchReason: string;
    }
  | undefined;

if (scope.hotelKey === "miramare-beach") {
  specificMatch = matchExactRoomAlias(
    scope,
    roomName,
    "economy",
    ONTHEBEACH_HOTEL_CONFIG[scope.hotelKey]?.roomAliases.economy ?? [],
    "On the Beach ekonomi",
  );
  if (!specificMatch &&
    /^(superior corner|double or twin superior corner balcony)$/i.test(
      roomName,
    )
  ) {
    specificMatch = {
      matchedRoomId: "corner",
      matchReason: "OnTheBeach Superior Corner oda eşleşmesi.",
    };
  }
}

const roomMatch =
  specificMatch &&
  scope.rooms.some((room) => room.id === specificMatch.matchedRoomId)
    ? specificMatch
    : normalMatch;

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
      ...roomMatch,
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

async function assertSearchAccessible(
  page: Page,
  responseStatus?: number,
) {
  const verificationVisible = await page
    .locator(VERIFICATION_FRAME)
    .isVisible()
    .catch(() => false);

  if (verificationVisible) {
    console.log("[OnTheBeach] Verification challenge detected:", {
      url: page.url(),
      title: await page.title().catch(() => ""),
    });

    throw new Error("ONTHEBEACH_BOT_CHALLENGE");
  }

  await assertPricePageAccessible(page, responseStatus);
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
    console.log("[OnTheBeach] Before navigation:", {
  currentUrl: page.url(),
  target: SEARCH_URL,
});

const response = await page.goto(SEARCH_URL, {
  waitUntil: "commit",
  timeout: 60000,
});

console.log("[OnTheBeach] Navigation committed:", {
  status: response?.status(),
  url: page.url(),
  responseUrl: response?.url(),
  contentType: response?.headers()["content-type"],
  server: response?.headers()["server"],
  retryAfter: response?.headers()["retry-after"],
});

console.log("[OnTheBeach] Browser diagnostics:", {
  status: response?.status(),
  url: page.url(),

  browser: await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    language: navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    webdriver: navigator.webdriver,
    visibilityState: document.visibilityState,
  })),

  cookies: (await page.context().cookies()).map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    expires: cookie.expires,
  })),
});

await page.locator("body").waitFor({
  state: "attached",
  timeout: 15000,
});


console.log("\n========== ONTHEBEACH DEBUG START ==========");
console.log("[OnTheBeach] HTTP status:", response?.status());
console.log("[OnTheBeach] Requested URL:", SEARCH_URL);
console.log("[OnTheBeach] Final URL:", page.url());
console.log(
  "[OnTheBeach] Page title:",
  await page.title().catch(() => ""),
);

const verificationFrameVisible = await page
  .locator(VERIFICATION_FRAME)
  .isVisible()
  .catch(() => false);

console.log(
  "[OnTheBeach] Verification frame visible:",
  verificationFrameVisible,
);

const bodyText = await page
  .locator("body")
  .innerText({ timeout: 3000 })
  .catch(() => "");

console.log(
  "[OnTheBeach] Body preview:",
  bodyText.slice(0, 2000),
);

if (response?.status() === 403) {
  throw new Error("ONTHEBEACH_BOT_CHALLENGE");
}

await assertSearchAccessible(
  page,
  response?.status(),
);

console.log("[OnTheBeach] Initial access check: OK");
console.log("========== ONTHEBEACH DEBUG END ==========\n");

  onStep("Çerez tercihleri");
  await dismissCookieNotice(page);
  await assertSearchAccessible(page);

onStep("Otel arama formunu hazırlama");

onStep("Hotel Only sekmesini seçme");

const hotelsTab = page.getByRole("tab", {
  name: "Hotels",
  exact: true,
});

await hotelsTab.waitFor({
  state: "visible",
  timeout: 15000,
});

console.log("[OnTheBeach] Before Hotels click:", {
  url: page.url(),
  selected: await hotelsTab.getAttribute("aria-selected"),
});

if ((await hotelsTab.getAttribute("aria-selected")) !== "true") {
  await hotelsTab.click();
}

await page.waitForURL(
  (url) => url.searchParams.get("mode") === "ho",
  { timeout: 30000 },
);

await page.locator("body").waitFor({
  state: "visible",
  timeout: 15000,
});

console.log("[OnTheBeach] Hotel Only navigation:", {
  url: page.url(),
  mode: new URL(page.url()).searchParams.get("mode"),
  title: await page.title(),
  bodyPreview: (
    await page.locator("body").innerText()
  ).slice(0, 1500),
});

onStep("Hotel Only form alanlarını inceleme");

console.log(
  "[OnTheBeach] Hotel Only controls:",
  await page
    .locator("input, button, select, [role='combobox']")
    .evaluateAll((elements) =>
      elements
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 100) ?? "",
          type: element.getAttribute("type"),
          name: element.getAttribute("name"),
          id: element.getAttribute("id"),
          placeholder: element.getAttribute("placeholder"),
          ariaLabel: element.getAttribute("aria-label"),
          testId: element.getAttribute("data-testid"),
          value:
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement
              ? element.value
              : null,
        }))
        .filter(
          (item) =>
            /where|date|night|party|room|search|check/i.test(
              [
                item.text,
                item.name,
                item.id,
                item.placeholder,
                item.ariaLabel,
              ].join(" "),
            ),
        )
        .slice(0, 50),
    ),
);

console.log(
  "[OnTheBeach] Hotel Only form buttons:",
  await page.locator("button").evaluateAll((buttons) =>
    buttons
      .map((button) => ({
        text: button.textContent?.trim().slice(0, 150) ?? "",
        ariaLabel: button.getAttribute("aria-label"),
        id: button.getAttribute("id"),
        className: button.getAttribute("class"),
        testId: button.getAttribute("data-testid"),
      }))
      .filter((button) => button.text || button.ariaLabel)
      .slice(0, 60),
  ),
);

onStep("Hotel Only destinasyon alanını inceleme");

console.log(
  "[OnTheBeach] Destination elements:",
  await page.locator("input, button, [role='combobox']").evaluateAll(
    (elements) =>
      elements
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 150) ?? "",
          type: element.getAttribute("type"),
          name: element.getAttribute("name"),
          placeholder: element.getAttribute("placeholder"),
          ariaLabel: element.getAttribute("aria-label"),
          className: element.getAttribute("class"),
          outerHtml: element.outerHTML.slice(0, 500),
        }))
        .filter((element) =>
          /where to|destination|location|search-field|input-select/i.test(
            [
              element.text,
              element.name,
              element.placeholder,
              element.ariaLabel,
              element.className,
            ].join(" "),
          ),
        )
        .slice(0, 25),
  ),
);

onStep("Hotel Only Antalya destinasyonunu arama");

const hotelOnlyDestinationInput = page.locator(
  'input[name="destination"][type="search"]',
);

await hotelOnlyDestinationInput.waitFor({
  state: "visible",
  timeout: 15000,
});

await hotelOnlyDestinationInput.fill("Antalya");

await page.waitForTimeout(1200);

console.log("[OnTheBeach] Antalya destination results:", {
  inputValue: await hotelOnlyDestinationInput.inputValue(),

  visibleText: (
    await page.locator("body").innerText()
  ).slice(0, 1800),

  candidates: await page
    .locator("li, [role='option'], [class*='input-select']")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            /antalya|side|belek|alanya/i.test(
              element.textContent ?? "",
            )
          );
        })
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 200),
          className: element.getAttribute("class"),
          role: element.getAttribute("role"),
          outerHtml: element.outerHTML.slice(0, 700),
        }))
        .slice(0, 20),
    ),
});

onStep("Hotel Only Antalya destinasyonunu seçme");

const antalyaOption = page
  .locator("button.input-select__option")
  .filter({
    hasText: DESTINATION,
  });

await antalyaOption.waitFor({
  state: "visible",
  timeout: 15000,
});

await antalyaOption.click();

await page.waitForTimeout(500);

console.log("[OnTheBeach] Destination selection result:", {
  inputValue: await hotelOnlyDestinationInput.inputValue(),

  selectedOptions: await page
    .locator(".input-select__option")
    .allTextContents(),

  formPreview: (
    await page.locator("body").innerText()
  ).slice(0, 500),
});

onStep("Hotel Only giriş tarihi takvimini açma");

const hotelOnlyDateButton = page
  .locator("button.search-field-button")
  .filter({
    has: page.locator(".search-field-button__label", {
      hasText: "Check-in Date",
    }),
  });

await hotelOnlyDateButton.waitFor({
  state: "visible",
  timeout: 15000,
});

console.log("[OnTheBeach] Date before click:", {
  text: await hotelOnlyDateButton.innerText(),
  targetDate: window.checkIn,
});

await hotelOnlyDateButton.click();

console.log("[OnTheBeach] Calendar inspection:", {
  visibleText: (
    await page.locator("body").innerText()
  ).slice(0, 1600),

  dateButtons: await page
    .locator("button.datepicker__button")
    .evaluateAll((buttons) =>
      buttons.slice(0, 45).map((button) => ({
        text: button.textContent?.trim(),
        className: button.getAttribute("class"),
        disabled: (button as HTMLButtonElement).disabled,
        outerHtml: button.outerHTML.slice(0, 500),
      })),
    ),
});

onStep("Hotel Only giriş tarihini seçme");

const requestedMonth = window.checkIn.slice(0, 7);
const hotelOnlyCheckInMonth = page.locator(
  `input[name="departure-date"][value="${requestedMonth}"]`,
);

await hotelOnlyCheckInMonth.waitFor({
  state: "attached",
  timeout: 15000,
});

if (!(await hotelOnlyCheckInMonth.isChecked())) {
  await page
    .locator(`label[for="departure-date_${requestedMonth}"]`)
    .click();
}

const hotelOnlyCheckInDay = page.locator(
  `button.datepicker__button[value="${window.checkIn}"]`,
);

await hotelOnlyCheckInDay.waitFor({
  state: "visible",
  timeout: 15000,
});

await hotelOnlyCheckInDay.click();

await page.waitForTimeout(400);

console.log("[OnTheBeach] Check-in selection result:", {
  requested: window.checkIn,
  displayed: await hotelOnlyDateButton.innerText(),
  url: page.url(),
});

onStep("Hotel Only gece seçimi alanını inceleme");

const hotelOnlyNightsButton = page
  .locator("button.search-field-button")
  .filter({
    has: page.locator(".search-field-button__label", {
      hasText: "Nights",
    }),
  });

await hotelOnlyNightsButton.waitFor({
  state: "visible",
  timeout: 15000,
});

console.log("[OnTheBeach] Nights before click:", {
  requested: window.nights,
  displayed: await hotelOnlyNightsButton.innerText(),
});

await hotelOnlyNightsButton.click();

console.log("[OnTheBeach] Nights options inspection:", {
  visibleText: (
    await page.locator("body").innerText()
  ).slice(0, 1200),

selects: await page.locator("select").evaluateAll((elements) =>
  elements.map((element) => {
    const select = element as HTMLSelectElement;

    return {
      name: select.name,
      className: select.className,
      value: select.value,
      options: Array.from(select.options).map((option) => ({
        text: option.textContent?.trim(),
        value: option.value,
        selected: option.selected,
      })),
    };
  }),
),

  options: await page
    .locator("button, [role='option'], input[type='radio']")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();

          return rect.width > 0 && rect.height > 0;
        })
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 100) ?? "",
          value: element.getAttribute("value"),
          className: element.getAttribute("class"),
          outerHtml: element.outerHTML.slice(0, 350),
        }))
        .filter((item) =>
          /night|^[1-9]\d?$/.test(
            `${item.text} ${item.className ?? ""}`,
          ),
        )
        .slice(0, 40),
    ),
});

onStep("Hotel Only gece sayısını seçme");

const hotelOnlyNightsSelect = page.locator(
  'select[name="search[nights]"]',
);

await hotelOnlyNightsSelect.waitFor({
  state: "attached",
  timeout: 15000,
});

console.log("[OnTheBeach] Nights select before:", {
  requested: window.nights,
  currentValue: await hotelOnlyNightsSelect.inputValue(),
});

await hotelOnlyNightsSelect.selectOption(String(window.nights));

await page.waitForTimeout(400);

console.log("[OnTheBeach] Nights selection result:", {
  requested: window.nights,
  selectedValue: await hotelOnlyNightsSelect.inputValue(),
  displayed: await hotelOnlyNightsButton.innerText(),
  checkIn: await hotelOnlyDateButton.innerText(),
  returnText: await page
    .getByText(/^Return\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/)
    .first()
    .innerText()
    .catch(() => "Return alanı bulunamadı"),
});

onStep("Hotel Only misafir ve oda sayısını doğrulama");

const hotelOnlyGuestValues = {
  adults: await page
    .locator('select[name="search[adults]"]')
    .inputValue(),

  children: await page
    .locator('select[name="search[children]"]')
    .inputValue(),

  infants: await page
    .locator('select[name="search[infants]"]')
    .inputValue(),

  rooms: await page
    .locator('select[name="search[number_of_rooms]"]')
    .inputValue(),
};

console.log(
  "[OnTheBeach] Hotel Only guest verification:",
  hotelOnlyGuestValues,
);

if (
  hotelOnlyGuestValues.adults !== "2" ||
  hotelOnlyGuestValues.children !== "0" ||
  hotelOnlyGuestValues.infants !== "0" ||
  hotelOnlyGuestValues.rooms !== "1"
) {
  throw new Error(
    "Hotel Only misafir veya oda sayısı beklenen değerlerle eşleşmiyor.",
  );
}

console.log("[OnTheBeach] Hotel Only guest verification: OK");

onStep("Hotel Only aramasını başlatma");

const hotelOnlySearchButton = page.locator(
  "button.button--primary.button--with-arrow",
).filter({
  hasText: /^Search$/,
});

console.log("[OnTheBeach] Search button inspection:", {
  matchingButtons: await hotelOnlySearchButton.count(),

buttons: await page.locator("button").evaluateAll((buttons) =>
  buttons
    .filter((button) => /search/i.test(button.textContent ?? ""))
    .map((button) => {
      const rect = button.getBoundingClientRect();

      const style =
        button.ownerDocument.defaultView?.getComputedStyle(button);

      return {
        text: button.textContent?.trim(),
        className: button.getAttribute("class"),
        disabled: (button as HTMLButtonElement).disabled,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style?.visibility !== "hidden" &&
          style?.display !== "none",
        outerHtml: button.outerHTML.slice(0, 600),
      };
    }),
),

  calendarVisible: await page
    .locator("button.datepicker__button")
    .first()
    .isVisible()
    .catch(() => false),
});

await hotelOnlySearchButton.waitFor({
  state: "visible",
  timeout: 15000,
});

console.log("[OnTheBeach] Before Hotel Only search:", {
  hotel: scope.hotelName,
  url: page.url(),
  destination: await hotelOnlyDestinationInput.inputValue(),
  checkIn: await hotelOnlyDateButton.innerText(),
  nights: await hotelOnlyNightsSelect.inputValue(),
  guests: hotelOnlyGuestValues,
});

await hotelOnlySearchButton.click({
  timeout: 15000,
});

onStep("Hotel Only arama sonuçlarını bekleme");

console.log("[OnTheBeach] Search loading started:", {
  url: page.url(),
  title: await page.title(),
});

const searchStartTime = Date.now();

const resultsLoaded = await page
  .waitForURL(
    (url) => {
      return (
        url.hostname === "www.onthebeach.co.uk" &&
        url.searchParams.get("mode") !== "ho" &&
        url.pathname !== "/"
      );
    },
    {
      timeout: 60000,
      waitUntil: "domcontentloaded",
    },
  )
  .then(() => true)
  .catch(() => false);

console.log("[OnTheBeach] Search navigation result:", {
  resultsLoaded,
  elapsedMs: Date.now() - searchStartTime,
  url: page.url(),
  title: await page.title().catch(() => ""),
  bodyPreview: (
    await page.locator("body").innerText().catch(() => "")
  ).slice(0, 2000),
});

if (!resultsLoaded) {
  throw new Error(
    "Hotel Only araması 60 saniye içinde sonuç sayfasına yönlenmedi.",
  );
}

await assertSearchAccessible(page);

const targetHotelName = scope.hotelName.trim();
const filteredResultsUrl = new URL(page.url());
filteredResultsUrl.searchParams.set("filters[hotel_name]", targetHotelName);
filteredResultsUrl.searchParams.set("pagination[page]", "1");

onStep("Hotel Only sonuçlarını hedef otele filtreleme");

const filteredResponse = await page.goto(filteredResultsUrl.toString(), {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});

await assertSearchAccessible(page, filteredResponse?.status());

await page
  .locator("#search_results .hotel-result.search-result")
  .first()
  .waitFor({ state: "attached", timeout: 30000 });

console.log("[OnTheBeach] Hotel Only search result:", {
  hotel: scope.hotelName,
  url: page.url(),
  title: await page.title().catch(() => ""),
  bodyPreview: (
    await page.locator("body").innerText().catch(() => "")
  ).slice(0, 2500),
});

onStep("Hotel Only sonuç kartlarını inceleme");

console.log("[OnTheBeach] Results structure inspection:", {
  url: page.url(),

  targetHotel: scope.hotelName,

  hotelNameMatches: await page
    .getByText(/Miramare (Beach|Queen)/i)
    .allTextContents(),

  hotelLinks: await page.locator("a").evaluateAll((links) =>
    links
      .filter((link) =>
        /hotel|miramare/i.test(
          `${link.textContent ?? ""} ${link.getAttribute("href") ?? ""}`,
        ),
      )
      .slice(0, 25)
      .map((link) => ({
        text: link.textContent?.trim().slice(0, 120),
        href: link.getAttribute("href"),
        className: link.getAttribute("class"),
        outerHtml: link.outerHTML.slice(0, 500),
      })),
  ),

  pagination: await page
    .locator("a, button, [role='button']")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const text = element.textContent?.trim() ?? "";
          const ariaLabel = element.getAttribute("aria-label") ?? "";
          const className = element.getAttribute("class") ?? "";

          return (
            /^(next|previous|prev|[1-9]\d?)$/i.test(text) ||
            /pagination|page|next|previous/i.test(
              `${ariaLabel} ${className}`,
            )
          );
        })
        .slice(0, 40)
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 100),
          href: element.getAttribute("href"),
          ariaLabel: element.getAttribute("aria-label"),
          className: element.getAttribute("class"),
          outerHtml: element.outerHTML.slice(0, 500),
        })),
    ),

  resultTextSamples: await page
    .locator("body")
    .innerText()
    .then((text) => ({
      containsMiramare: /miramare/i.test(text),
      containsHotels: /hotel|results|sort by/i.test(text),
      last4000Characters: text.slice(-4000),
    })),
});

onStep("Hotel Only hedef oteli sonuç sayfalarında arama");

const hotelNameLocator = page.getByText(targetHotelName, {
  exact: true,
});

const currentResultsUrl = new URL(page.url());

if (!/^\/hotel_searches\/show\/\d+\/?$/.test(currentResultsUrl.pathname)) {
  throw new Error("Hotel Only sonuç sayfası doğrulanamadı.");
}

let currentPage = Number(
  currentResultsUrl.searchParams.get("pagination[page]") ?? "1",
);

let targetHotelFound = false;

const visitedPages = new Set<number>();

while (currentPage <= 3) {
  if (visitedPages.has(currentPage)) {
    throw new Error(`Sayfalama döngüsü algılandı: ${currentPage}`);
  }

  visitedPages.add(currentPage);

  const hotelMatches = await hotelNameLocator.allTextContents();

  console.log("[OnTheBeach] Hotel search page:", {
    page: currentPage,
    url: page.url(),
    targetHotel: targetHotelName,
    matches: hotelMatches,
  });

  if (hotelMatches.length > 0) {
    targetHotelFound = true;

    console.log("[OnTheBeach] TARGET HOTEL FOUND:", {
      hotel: targetHotelName,
      page: currentPage,
      url: page.url(),
    });

    break;
  }

  const nextButton = page.locator(
    'button.pagination__button[data-direction="1"]',
  );

  if (!(await nextButton.isVisible()) || !(await nextButton.isEnabled())) {
    console.log("[OnTheBeach] Last results page reached:", {
      page: currentPage,
      url: page.url(),
    });

    break;
  }

  const expectedNextPage = currentPage + 1;

const previousFirstHotel = await page
  .locator("#search_results .hotel-result.search-result")
  .first()
  .getAttribute("data-result-id");

await nextButton.click();

await page.waitForFunction(
  ({ expectedPage, previousFirstHotel }) => {
    const currentUrl = new URL(document.location.href);

    const currentPageNumber = Number(
      currentUrl.searchParams.get("pagination[page]"),
    );

    const firstHotel = document.querySelector(
      "#search_results .hotel-result.search-result",
    );

    const currentFirstHotel = firstHotel?.getAttribute("data-result-id");

    return (
      currentPageNumber === expectedPage &&
      firstHotel !== null &&
      currentFirstHotel !== null &&
      currentFirstHotel !== previousFirstHotel
    );
  },
  {
    expectedPage: expectedNextPage,
    previousFirstHotel,
  },
  {
    timeout: 30000,
  },
);

await assertSearchAccessible(page);

currentPage = expectedNextPage;

console.log("[OnTheBeach] Pagination completed:", {
  page: currentPage,
  url: page.url(),
  firstHotelId: await page
    .locator("#search_results .hotel-result.search-result")
    .first()
    .getAttribute("data-result-id"),
  hotelCards: await page
    .locator("#search_results .hotel-result.search-result")
    .count(),
});
}

if (!targetHotelFound) {
  throw new Error(
    `${targetHotelName} oteli taranan sonuç sayfalarında bulunamadı.`,
  );
}

onStep("Hotel Only hedef otel kartını inceleme");

const hotelCardInspection = await page
  .getByText(targetHotelName, { exact: true })
  .first()
  .evaluate((element) => {
    const ancestors = [];

    let current: Element | null = element;

    for (let level = 0; level < 8 && current; level++) {
      ancestors.push({
        level,
        tag: current.tagName,
        className: current.getAttribute("class"),
        id: current.getAttribute("id"),
        text: current.textContent?.trim().slice(0, 1200),
        html: current.outerHTML.slice(0, 1800),
      });

      current = current.parentElement;
    }

    return ancestors;
  });

console.log(
  "[OnTheBeach] Target hotel card inspection:",
  JSON.stringify(
    {
      hotel: targetHotelName,
      page: currentPage,
      ancestors: hotelCardInspection,
    },
    null,
    2,
  ),
);

onStep("Hotel Only hedef otelin oda ve fiyat alanlarını inceleme");

const targetHotelCard = page
  .locator(".hotel-result.search-result")
  .filter({
    has: page.locator("h3.hotel-result__title").filter({
      hasText: new RegExp(
        `^\\s*${targetHotelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
        "i",
      ),
    }),
  });

await targetHotelCard.waitFor({
  state: "visible",
  timeout: 15000,
});

console.log("[OnTheBeach] Target hotel price inspection:", {
  hotel: targetHotelName,
  page: currentPage,

  hotelId: await targetHotelCard.getAttribute("data-hotel-id"),
  initialRoomType: await targetHotelCard.getAttribute("data-room-type"),
  boardCode: await targetHotelCard.getAttribute("data-board-code"),

  cardText: (
    await targetHotelCard.innerText()
  ).slice(-4500),

  priceRelatedElements: await targetHotelCard
    .locator(
      '[class*="price"], [class*="room"], [class*="board"], input[type="radio"], label',
    )
    .evaluateAll((elements) =>
      elements.slice(0, 65).map((element) => ({
        tag: element.tagName,
        className: element.getAttribute("class"),
        text: element.textContent?.trim().slice(0, 150),
        outerHtml: element.outerHTML.slice(0, 500),
      })),
    ),

  buttons: await targetHotelCard.locator("button").evaluateAll((buttons) =>
    buttons.map((button) => ({
      text: button.textContent?.trim().slice(0, 100),
      className: button.getAttribute("class"),
      outerHtml: button.outerHTML.slice(0, 500),
    })),
  ),
});

onStep("Hotel Only toplam otel fiyatını seçme");

const priceToggle = targetHotelCard.locator(
  'input.toggle-switch__input[name="price[toggle]"]',
);

const priceToggleLabel = targetHotelCard.locator(
  "label.toggle-switch__label",
);

const getDisplayedPrices = async () =>
  targetHotelCard
    .locator(".board-option")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        room: element
          .querySelector(".board-option__title")
          ?.textContent?.trim()
          .replace(/\s+/g, " "),

        amount: element
          .querySelector(".board-option__amount")
          ?.textContent?.trim()
          .replace(/\s+/g, ""),

        priceLabel: element
          .querySelector(".board-option__price-label")
          ?.textContent?.trim(),
      })),
    );

const totalPriceSelected = await priceToggle.isChecked();

console.log("[OnTheBeach] Price toggle before:", {
  checked: totalPriceSelected,
  value: await priceToggle.getAttribute("value"),
  prices: (await getDisplayedPrices()).slice(0, 3),
});

if (!totalPriceSelected) {
  const priceModeUrl = page.url();

  await Promise.all([
    page.waitForURL((url) => url.toString() !== priceModeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }),
    priceToggleLabel.click(),
  ]);

  const totalPriceResultsUrl = new URL(page.url());
  totalPriceResultsUrl.searchParams.set("filters[hotel_name]", targetHotelName);
  totalPriceResultsUrl.searchParams.set("pagination[page]", "1");

  const totalPriceResponse = await page.goto(totalPriceResultsUrl.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await assertSearchAccessible(page, totalPriceResponse?.status());
  await targetHotelCard.waitFor({ state: "visible", timeout: 30000 });
  await priceToggle.waitFor({ state: "attached", timeout: 15000 });
}

if (!(await priceToggle.isChecked())) {
  throw new Error("Total Hotel Price seçimi etkinleşmedi.");
}

console.log("[OnTheBeach] Price toggle after:", {
  url: page.url(),
  checked: await priceToggle.isChecked().catch(() => null),
  prices: (await getDisplayedPrices()).slice(0, 6),
});

onStep("Hotel Only toplam oda fiyatlarını toplama");

const collectedOffers = await targetHotelCard
  .locator(".board-option")
  .evaluateAll((elements) =>
    elements.map((element) => {
      const title = element.querySelector(".board-option__title");

      const board =
        title?.querySelector("strong")?.textContent?.trim() ?? "";

      const roomName =
        title?.textContent
          ?.replace(board, "")
          .replace(/\s+/g, " ")
          .trim() ?? "";

      const amount =
        element
          .querySelector(".board-option__amount")
          ?.textContent?.replace(/\s+/g, "") ?? "";

      const priceLabel =
        element
          .querySelector(".board-option__price-label")
          ?.textContent?.trim() ?? "";

      return {
        roomName,
        board,
        priceText: `${amount}${priceLabel.replace(/\s+/g, "")}`,
      };
    }),
  );

console.log("[OnTheBeach] Collected offers:", collectedOffers);

const invalidOffers = collectedOffers.filter(
  (offer) =>
    !offer.roomName ||
    !offer.board ||
    !/^£[\d,]+(?:\.\d{2})?perparty$/i.test(offer.priceText),
);

if (invalidOffers.length > 0 || collectedOffers.length === 0) {
  throw new Error(
    "Hotel Only oda isimleri veya toplam fiyatları doğrulanamadı.",
  );
}

const snapshot: OnTheBeachSnapshot = {
  sourceUrl: page.url(),
  hotelName: targetHotelName,
  checkInLabel: dateLabel(window.checkIn),
  returnLabel: dateLabel(window.checkOut),
  nights: window.nights,
  adults: Number(hotelOnlyGuestValues.adults),
  children: Number(hotelOnlyGuestValues.children),
  infants: Number(hotelOnlyGuestValues.infants),
  rooms: Number(hotelOnlyGuestValues.rooms),
  totalSelected: await priceToggle.isChecked(),
  offers: collectedOffers,
};

console.log("[OnTheBeach] Final snapshot:", {
  hotel: snapshot.hotelName,
  checkIn: snapshot.checkInLabel,
  checkOut: snapshot.returnLabel,
  nights: snapshot.nights,
  totalSelected: snapshot.totalSelected,
  offerCount: snapshot.offers.length,
  offers: snapshot.offers,
});

return snapshot;

} // runHotelSearch fonksiyonunun kapanışı

async function createOnTheBeachBrowserPage(
  config: ReturnType<typeof resolveProviderLiveConfig>,
  scope: ReportScopeDefinition,
): Promise<PatchrightBrowserHandle> {
  return createPatchrightBrowserPage({
    profilePath:
      `./.benchmark-state/onthebeach-browser-profile-${scope.id}`,

    browserChannel: config.browserChannel,
    market: config.market,
    proxyUrl: config.proxyUrl,
    userAgent: config.userAgent,
    headless: false,
  });
}

export async function collectOnTheBeachLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
dependencies: {
  createPage?: typeof createOnTheBeachBrowserPage;
  search?: typeof runHotelSearch;
} = {},
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const warnings: string[] = [];
  const offers: CollectedOffer[] = [];
  for (const window of scope.windows) {
    let handle: PatchrightBrowserHandle | undefined;
    let step = "Otel arama sayfasını açma";
    try {
handle = await (
  dependencies.createPage ?? createOnTheBeachBrowserPage
)(
  resolveProviderLiveConfig(provider.key, scope.currency),
  scope,
);
      handle.page.setDefaultTimeout(15000);
      const snapshot = await (dependencies.search ?? runHotelSearch)(
        handle.page,
        scope,
        window,
        (next) => {
  step = next;

  console.log("[OnTheBeach] Step:", {
    step,
    hotel: scope.hotelName,
    checkIn: window.checkIn,
    checkOut: window.checkOut,
  });
},
      );
      const windowOffers = parseOnTheBeachOffers(
        provider,
        scope,
        window,
        snapshot,
      );

      console.log("[OnTheBeach] Offer parsing:", {
  rawOfferCount: snapshot.offers.length,
  parsedOfferCount: windowOffers.length,
  samples: snapshot.offers.slice(0, 3),
});

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
    console.error("[OnTheBeach] Collection FAILED:", {
  step,
  url: handle?.page.url(),
  error:
    error instanceof Error
      ? { name: error.name, message: error.message }
      : String(error),
});
  const blocked =
    error instanceof Error &&
    error.message === "ONTHEBEACH_BOT_CHALLENGE";

  let reason = blocked
    ? "On the Beach site doğrulaması istedi; otomatik oda fiyatı alınamadı."
    : error instanceof Error
      ? error.message.split("\n")[0]
      : "Arama tamamlanamadı.";

  if (handle && !blocked) {
    try {
      await assertPricePageAccessible(handle.page);
    } catch (diagnostic) {
      reason =
        diagnostic instanceof Error
          ? diagnostic.message
          : reason;
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
