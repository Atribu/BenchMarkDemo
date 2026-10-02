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

export async function collectLoveholidaysLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  createPage: typeof createBrowserPage = createBrowserPage,
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const warnings: string[] = [];
  const offers: CollectedOffer[] = [];
  let handle: Awaited<ReturnType<typeof createBrowserPage>> | undefined;
  try {
    handle = await createPage({
      ...resolveProviderLiveConfig(provider.key, scope.currency),
      market: scope.currency === "EUR" ? "de" : "uk",
    });
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
        await assertPricePageAccessible(page, response?.status());
        const reject = page.getByRole("button", {
          name: /^(Reject non-essential|Nur notwendige Cookies)$/,
        });
        if (await reject.isVisible()) await reject.click();
        const options = page.getByRole("button", {
          name: /^(Room option|Zimmeroption) \d/,
        });
        await options.first().waitFor({ timeout: 35000 });
        const more = page.getByRole("button", {
          name: /^(Show more|Mehr anzeigen)$/,
        });
        for (let count = 0; count < 8 && (await more.isVisible()); count++)
          await more.click();
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
        let reason =
          error instanceof Error
            ? error.message.split("\n")[0]
            : "Loveholidays fiyatı okunamadı.";
        try {
          await assertPricePageAccessible(handle.page);
        } catch (diagnostic) {
          reason = (diagnostic as Error).message;
        }
        warnings.push(
          `${provider.name} / ${scope.label} / ${window.checkIn}: ${reason}`,
        );
        quotes.push(
          ...scope.rooms.map((room): ProviderQuote => ({
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
          })),
        );
      }
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return { quotes, warnings, offers };
}
