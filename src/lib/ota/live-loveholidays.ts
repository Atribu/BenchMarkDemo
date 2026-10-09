//live-holidays.ts
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
import { assertPricePageAccessible } from "./browser-diagnostics";
import {
  classifyRoom,
  deduplicateOffers,
  matchOfferRoom,
  selectOfferQuotes,
} from "./offer-matching";

// Verified through the hotel's public "Hotel Only" navigation, not name guessing.
const HOTEL_IDS: Partial<Record<ReportScopeDefinition["hotelKey"], string>> = {
  "miramare-beach": "371656",
  "miramare-queen": "371430",
};



export interface LoveholidaysSnapshot {
  url: string;
  hotelName: string;
  checkInLabel: string;
  nightsLabel: string;
  occupancyLabel: string;
  offers: { name: string; priceText: string; description: string }[];
}

async function detectLoveholidaysBotChallenge(
  page: Page,
): Promise<boolean> {
  const hasChallengeFrame = page.frames().some((frame) => {
  try {
    const url = new URL(frame.url());

    return (
      (url.hostname === "captcha-delivery.com" ||
        url.hostname.endsWith(".captcha-delivery.com")) &&
      url.pathname.startsWith("/captcha/")
    );
  } catch {
    return false;
  }
});

if (hasChallengeFrame) {
  console.warn(
    "[Loveholidays] CAPTCHA iframe detected; verification required.",
  );

  return true;
}

  const title = await page.title().catch(() => "");
  const body = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");

  const checks = {
    humanVerification: /verify.*human/i.test(body),
    humanQuestion: /are you human/i.test(body),
    securityCheck: /security check/i.test(body),
    botInTitle: /bot/i.test(title),
  };

const matched = Object.entries(checks)
  .filter(([, v]) => v)
  .map(([k]) => k)
  .filter(() => body.length < 1500);

  if (matched.length > 0) {
    console.warn("[Loveholidays] Verification detection:", {
      title,
      url: page.url(),
      matched,
      bodyPreview: body.slice(0, 1200),
    });
  }

  return matched.length > 0;
}

async function assertNoLoveholidaysBotChallenge(page: Page) {
  const deadline = Date.now() + 120_000;
  while (await detectLoveholidaysBotChallenge(page)) {
    if (Date.now() > deadline) throw new Error("LOVEHOLIDAYS_BOT_CHALLENGE");
    await page.waitForTimeout(3000);
  }
}

export function buildLoveholidaysUrl(
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
) {
  const masterId = HOTEL_IDS[scope.hotelKey];
  if (!masterId)
    throw new Error("Loveholidays hotel-only otel kimligi henuz dogrulanmadi.");
  const url = new URL(
    scope.currency === "EUR"
      ? "https://www.loveholidays.com/de/hotels/l/"
      : "https://www.loveholidays.com/hotels/l/",
  );
  url.search = new URLSearchParams({
    masterId,
    nights: String(window.nights),
    rooms: "2",
    date: window.checkIn,
  }).toString();
  return url.toString();
}

export function parseLoveholidaysOffers(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  snapshot: LoveholidaysSnapshot,
): CollectedOffer[] {
  const url = new URL(snapshot.url);
  const expected = new URL(buildLoveholidaysUrl(scope, window));
  const date = new Intl.DateTimeFormat(
    scope.currency === "EUR" ? "de-DE" : "en-GB",
    {
      ...(scope.currency === "EUR" ? {} : { weekday: "short" as const }),
      day: scope.currency === "EUR" ? "2-digit" : "numeric",
      month: scope.currency === "EUR" ? "2-digit" : "short",
      year: "numeric",
      timeZone: "UTC",
    },
  )
    .format(new Date(`${window.checkIn}T12:00:00Z`))
    .replace(/,/g, "");
  const nightWord =
    scope.currency === "EUR"
      ? window.nights === 1
        ? "Nacht"
        : "Nächte"
      : window.nights === 1
        ? "night"
        : "nights";
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    ["masterId", "nights", "rooms", "date"].some(
      (key) => url.searchParams.get(key) !== expected.searchParams.get(key),
    ) ||
    normalizeInlineText(snapshot.hotelName).toLowerCase() !==
      scope.hotelName.toLowerCase() ||
    normalizeInlineText(snapshot.checkInLabel)
      .replace(/,/g, "")
      .replace(/\b0(\d)\b/g, "$1") !== date.replace(/\b0(\d)\b/g, "$1") ||
    normalizeInlineText(snapshot.nightsLabel) !==
      `${window.nights} ${nightWord}` ||
    normalizeInlineText(snapshot.occupancyLabel) !==
      (scope.currency === "EUR" ? "1 Zimmer, 2 Erw." : "1 Room, 2 Adults")
  ) {
    throw new Error(
      "Loveholidays otel, tarih, kisi veya hotel-only secimi dogrulanamadi.",
    );
  }
  const offers: CollectedOffer[] = [];
  for (const offer of snapshot.offers) {
    // The same card advertises flights and a nightly rate: read ONLY room total.
    const total = normalizeInlineText(offer.priceText).match(
      scope.currency === "GBP"
        ? /(£[\d,.]+)\s+total\b/i
        : /([\d.,]+\s*€)\s+insgesamt\b/i,
    )?.[1];
    const price = total ? parsePriceFromText(total, scope.currency) : null;
    if (
      price === null ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !offer.name.trim()
    )
      continue;
    const roomFeatures = classifyRoom(
      offer.name.replace(/Blick ins Grüne/gi, "Garden View"),
    );
    offers.push({
      id: `loveholidays:${scope.id}:${window.id}:${offers.length}`,
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
      roomName: offer.name,
      roomFeatures,
      ...matchOfferRoom(scope, roomFeatures),
      sourceHint: snapshot.url,
      observedAt: new Date().toISOString(),
      terms: {
        board: /all[ -]inclusive plus/i.test(offer.description)
          ? "All Inclusive Plus"
          : /all[ -]inclusive/i.test(offer.description)
            ? "All inclusive"
            : "Belirtilmedi",
        cancellation: /non-refundable|nicht erstattungsf[aä]hig/i.test(
          offer.description,
        )
          ? "İadesiz"
          : "Belirtilmedi; esnek otel değişikliği ücretsiz iptal anlamına gelmez",
        taxes: "Vergi dökümü ayrıca doğrulanmadı",
        availability:
          "Hotel Only ekranındaki oda toplamı; rezervasyon adımında tekrar doğrulanmalı.",
      },
    });
  }
  return deduplicateOffers(offers);
}


export function parseLoveholidaysQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  snapshot: LoveholidaysSnapshot,
): ProviderQuote[] {
  return selectOfferQuotes(
    provider,
    scope,
    window,
    parseLoveholidaysOffers(provider, scope, window, snapshot),
    snapshot.url,
  );
}

async function createLoveholidaysBrowserPage(
  config: ReturnType<typeof resolveProviderLiveConfig>,
): Promise<PatchrightBrowserHandle> {
  return createPatchrightBrowserPage({
    profilePath:
      `./.benchmark-state/loveholidays-${config.market}-browser-profile`,
    browserChannel: config.browserChannel,
    market: config.market,
    proxyUrl: config.proxyUrl,
    userAgent: config.userAgent,
    headless: false,
  });
}

export async function collectLoveholidaysLiveQuotes(
  provider: ProviderDescriptor,
  scopeIn: ReportScopeDefinition,
  createPage: typeof createLoveholidaysBrowserPage =
    createLoveholidaysBrowserPage,
): Promise<ProviderCollectionResult> {
  const scope: ReportScopeDefinition = { ...scopeIn, currency: "GBP" };
  const quotes: ProviderQuote[] = [];
  const warnings: string[] = [];
  const offers: CollectedOffer[] = [];
 let handle: PatchrightBrowserHandle | undefined;
  try {
  handle = await createPage({
  ...resolveProviderLiveConfig(provider.key, scope.currency),
  market: scope.currency === "EUR" ? "de" : "uk",
});
const page = handle.page;
await page.goto(
  scope.currency === "EUR"
    ? "https://www.loveholidays.com/de/"
    : "https://www.loveholidays.com/",
  { waitUntil: "domcontentloaded", timeout: 45000 },
);
await page.waitForTimeout(3000 + Math.random() * 2000);

    for (const window of scope.windows) {
      let sourceHint = "";
      try {
        sourceHint = buildLoveholidaysUrl(scope, window);
        const page = handle.page;
        page.setDefaultTimeout(10000);
        const response = await page.goto(sourceHint, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
console.log("[Loveholidays] HTTP status:", response?.status());
console.log("[Loveholidays] Final URL:", page.url());

await page.waitForTimeout(2000);

console.log("[Loveholidays] Initial page:", {
  title: await page.title().catch(() => ""),
  bodyPreview: await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .then((text) => text.slice(0, 1200))
    .catch(() => ""),
});


if (response?.status() === 403) {
  console.log("[Loveholidays] 403 diagnostics:", {
    contentType: response.headers()["content-type"],
    frames: page.frames().map((frame) => ({
      name: frame.name(),
      url: frame.url(),
    })),
    bodyLength: await page
      .locator("body")
      .textContent({ timeout: 3000 })
      .then((text) => text?.length ?? 0)
      .catch(() => null),
  });

  await page
    .screenshot({
      path: ".benchmark-state/loveholidays-403.png",
      fullPage: true,
      timeout: 5000,
    })
    .catch((error) => {
      console.warn(
        "[Loveholidays] Screenshot failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
}
// Önce sayfada doğrulama belirtisi var mı kontrol et.
await assertNoLoveholidaysBotChallenge(page);

// Doğrulama belirtisi bulunmasa da HTTP erişim hatasını koru.
if (response?.status() === 403) {
  throw new Error(
    "Loveholidays HTTP 403: erişim reddedildi; doğrulama ekranı tespit edilmedi.",
  );
}

await assertPricePageAccessible(page, response?.status());

console.log("[Loveholidays] Initial access check: OK");

        console.log("[Loveholidays] Current URL:", page.url());

        const bodyText = await page
          .locator("body")
          .innerText({ timeout: 3000 })
          .catch(() => "");

        console.log("[Loveholidays] Body preview:", bodyText.slice(0, 2000));

    const reject = page.getByRole("button", {
  name: /^(Reject non-essential|Nur notwendige Cookies)$/,
});
await reject
  .waitFor({ state: "visible", timeout: 5000 })
  .then(() => reject.click())
  .catch(() => undefined);
        const options = page.getByRole("button", {
          name: /^(Room option|Zimmeroption) \d/,
        });
        await options.first().waitFor({ timeout: 35000 });
        // Sayfa açıldıktan sonra challenge sonradan çıkmış olabilir.
        await assertNoLoveholidaysBotChallenge(page);

        console.log("[Loveholidays] Access check: OK");
        console.log("[Loveholidays] Room option count:", await options.count());

      const more = page
  .getByRole("button", { name: /^(Show more|Mehr anzeigen)$/ })
  .first();

for (let attempt = 0; attempt < 8; attempt++) {
  if (!(await more.isVisible().catch(() => false))) break;

  const before = await options.count();

  try {
    await more.click({ timeout: 3000 });
  } catch {
    // Buton yeniden render olurken DOM'dan düştü: doğrudan DOM tıklaması dene.
    await more
      .evaluate((el) => (el as HTMLElement).click(), undefined, {
        timeout: 3000,
      })
      .catch(() => undefined);
  }

  // Yeni oda kartları gelene kadar en fazla ~5 sn bekle.
  let grew = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500);
    if ((await options.count()) > before) {
      grew = true;
      break;
    }
  }
  if (!grew) break; // Artan kart yoksa döngüden çık, mevcut kartlarla devam et.
}

console.log("[Loveholidays] Final room option count:", await options.count());

        const snapshotOffers = [];
        for (const card of await options.all()) {
          snapshotOffers.push({
            name: await card.getByRole("heading", { level: 3 }).innerText(),
            priceText: await card
              .getByRole("region", {
                name: /^(Room price information|Zimmerpreisinformationen)$/,
              })
              .last()
              .innerText(),
            description: await card.innerText(),
          });
        }
        console.log(
          "[Loveholidays] Offers collected:",
          snapshotOffers.map((offer) => ({
            name: offer.name,
            priceText: offer.priceText,
          })),
        );
        const snapshot: LoveholidaysSnapshot = {
          url: page.url(),
          hotelName: await page
            .getByRole("button", { name: scope.hotelName, exact: true })
            .getByRole("heading")
            .innerText(),
          checkInLabel: await page
            .getByRole("button", { name: /^(Check-in date|Check-in Datum)$/ })
            .innerText(),
          nightsLabel: await page
            .getByRole("button", { name: /^(How long|Wie lange)$/ })
            .innerText(),
          occupancyLabel: await page
            .getByRole("button", {
              name: scope.currency === "EUR" ? "Zimmer" : "Room(s)",
              exact: true,
            })
            .filter({ hasText: scope.currency === "EUR" ? "Erw." : "Adults" })
            .innerText(),
          offers: snapshotOffers,
        };
        const windowOffers = parseLoveholidaysOffers(
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
            snapshot.url,
          ),
        );
      } catch (error) {
        console.error("[Loveholidays] Collection FAILED:", {
  hotel: scope.hotelName,
  checkIn: window.checkIn,
  checkOut: window.checkOut,
  url: handle?.page.url(),
  message: error instanceof Error ? error.message : String(error),
});
        const blocked =
          error instanceof Error &&
          error.message === "LOVEHOLIDAYS_BOT_CHALLENGE";

        let reason = blocked
          ? "Loveholidays site doğrulaması istedi; otomatik oda fiyatı alınamadı."
          : error instanceof Error
            ? error.message.split("\n")[0]
            : "Loveholidays fiyatı okunamadı.";

        if (!blocked) {
          try {
            await assertPricePageAccessible(handle.page);
          } catch (diagnostic) {
            reason = (diagnostic as Error).message;
          }
        }
        warnings.push(
          `${provider.name} / ${scope.label} / ${window.checkIn}: ${reason}`,
        );
        quotes.push(
          ...scope.rooms.map(
            (room): ProviderQuote => ({
              providerKey: provider.key,
              scopeKey: scope.id,
              roomId: room.id,
              windowId: window.id,
              price: null,
              currency: scope.currency,
              status: "manual-review",
              dataMode: "live",
              sourceHint,
              reason,
            }),
          ),
        );
      }
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return { quotes, warnings, offers };
}
