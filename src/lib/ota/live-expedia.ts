import type {
  BenchmarkWindowDefinition,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "../benchmark/types";
import { EXPEDIA_HOTEL_CONFIG } from "./live-config";
import {
  createBrowserPage,
  normalizeInlineText,
  parsePriceFromText,
  resolveProviderLiveConfig,
} from "./live-helpers";
import { namedRoomRank } from "./live-onthebeach";
import { assertPricePageAccessible } from "./browser-diagnostics";

export interface ExpediaRoomCard {
  name: string;
  text: string;
  priceText: string;
}
export interface ExpediaSnapshot {
  url: string;
  hotelName: string;
  travellers: string;
  startLabel: string;
  endLabel: string;
  currencyLabel: string;
  cards: ExpediaRoomCard[];
}

export function buildExpediaUrl(
  baseUrl: string,
  scope: ReportScopeDefinition,
  checkIn: string,
  checkOut: string,
) {
  const url = new URL(baseUrl);
  url.hostname =
    scope.currency === "EUR" ? "www.expedia.de" : "www.expedia.co.uk";
  url.pathname = `/en/${url.pathname.replace(/^\/en\//, "").replace(/^\//, "")}`;
  url.search = new URLSearchParams({
    chkin: checkIn,
    chkout: checkOut,
    adults: "2",
    rm1: "a2",
    currency: scope.currency,
    locale: "en_GB",
    siteid: scope.currency === "EUR" ? "6" : "3",
    x_pwa: "1",
  }).toString();
  return url.toString();
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function parseExpediaQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  snapshot: ExpediaSnapshot,
): ProviderQuote[] {
  const requested = new URL(EXPEDIA_HOTEL_CONFIG[scope.hotelKey]!.pageUrl);
  const actual = new URL(snapshot.url);
  const hotelId = requested.pathname.match(/\.h(\d+)\./)?.[1];
  if (
    !hotelId ||
    actual.protocol !== "https:" ||
    !actual.pathname.includes(`.h${hotelId}.`) ||
    actual.hostname !==
      (scope.currency === "EUR" ? "www.expedia.de" : "www.expedia.co.uk") ||
    actual.searchParams.get("chkin") !== window.checkIn ||
    actual.searchParams.get("chkout") !== window.checkOut ||
    !normalizeInlineText(snapshot.hotelName)
      .toLowerCase()
      .startsWith(scope.hotelName.toLowerCase()) ||
    !/^Travellers, 2 travellers, 1 room$/i.test(
      normalizeInlineText(snapshot.travellers),
    ) ||
    normalizeInlineText(snapshot.startLabel) !==
      `Start date, ${dateLabel(window.checkIn)}` ||
    normalizeInlineText(snapshot.endLabel) !==
      `End date, ${dateLabel(window.checkOut)}` ||
    !snapshot.currencyLabel.startsWith(scope.currency)
  )
    throw new Error(
      "Expedia otel, tarih, kişi veya para birimi doğrulanamadı.",
    );
  return scope.rooms.map((room) => {
    const matched = snapshot.cards.flatMap((card) => {
      const rank = namedRoomRank(room.id, card.name);
      return rank !== null ? [{ ...card, rank }] : [];
    });
    const available = matched
      .flatMap((card) => {
        const current = card.priceText.match(
          /The current price is\s*([€£][\d.,]+)/i,
        )?.[1];
        const price =
          current &&
          new RegExp(`for ${window.nights} nights?, 1 room`).test(
            card.priceText,
          )
            ? parsePriceFromText(current, scope.currency)
            : null;
        return price !== null ? [{ ...card, price }] : [];
      })
      .sort((a, b) => a.rank - b.rank || a.price - b.price);
    const best = available[0];
    const soldOut =
      matched.length > 0 &&
      matched.every((card) => /We are sold out/i.test(card.text));
    return {
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId: room.id,
      windowId: window.id,
      price: best?.price ?? null,
      currency: scope.currency,
      status: best ? "available" : soldOut ? "sold_out" : "manual-review",
      dataMode: "live",
      captureMethod: "automated",
      observedAt: new Date().toISOString(),
      sourceHint: snapshot.url,
      offerDescription: best?.name,
      offerConditions: best
        ? [
            /All-inclusive/i.test(best.text) ? "All-inclusive" : null,
            /Non-refundable/.test(best.text)
              ? "Kartın varsayılan iptal seçeneğini kaynakta kontrol edin"
              : null,
            /includes taxes & fees/.test(best.priceText)
              ? "Vergiler ve ücretler dahil"
              : "Vergi ayrıntısı doğrulanmadı",
            `${window.nights} gece, 1 oda, 2 yetişkin; ekranda gösterilen toplam`,
          ]
            .filter(Boolean)
            .join("; ")
        : undefined,
      reason: best
        ? undefined
        : soldOut
          ? "Expedia bu oda için seçilen tarihte teklif olmadığını gösterdi."
          : "Oda veya konaklama toplamı doğrulanamadı.",
    };
  });
}

export async function collectExpediaLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const warnings: string[] = [];
  for (const window of scope.windows) {
    let handle: Awaited<ReturnType<typeof createBrowserPage>> | undefined;
    const base = EXPEDIA_HOTEL_CONFIG[scope.hotelKey]?.pageUrl;
    const sourceHint = base
      ? buildExpediaUrl(base, scope, window.checkIn, window.checkOut)
      : "";
    try {
      if (!sourceHint) throw new Error("Expedia otel eşleştirmesi eksik.");
      handle = await createBrowserPage(resolveProviderLiveConfig("expedia", scope.currency));
      const page = handle.page;
      page.setDefaultTimeout(15000);
      const response = await page.goto(sourceHint, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await assertPricePageAccessible(page, response?.status());
      await page
        .locator(
          '[data-stid="section-room-list"] [data-stid^="property-offer-"]',
        )
        .first()
        .waitFor({ timeout: 30000 });
      const snapshot = await page.evaluate(() => ({
        url: location.href,
        hotelName: document.querySelector("h1")?.textContent ?? "",
        travellers:
          Array.from(document.querySelectorAll("button"))
            .map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "")
            .find((text) => /Travellers, 2 travellers, 1 room/.test(text)) ??
          "",
        startLabel:
          Array.from(document.querySelectorAll("button"))
            .map((el) => el.getAttribute("aria-label") ?? "")
            .find((text) => /^Start date,/.test(text)) ?? "",
        endLabel:
          Array.from(document.querySelectorAll("button"))
            .map((el) => el.getAttribute("aria-label") ?? "")
            .find((text) => /^End date,/.test(text)) ?? "",
        currencyLabel:
          Array.from(document.querySelectorAll("header button"))
            .map(
              (el) =>
                el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
            )
            .find((text) => /^(EUR|GBP)/.test(text)) ?? "",
        cards: Array.from(
          document.querySelectorAll(
            '[data-stid="section-room-list"] [data-stid^="property-offer-"]',
          ),
        ).map((card) => ({
          name:
            Array.from(card.querySelectorAll("h3"))
              .map((el) => el.textContent ?? "")
              .find(
                (text) =>
                  !/^(View all photos|Frequently booked|Upgrade your stay)/.test(
                    text,
                  ),
              ) ?? "",
          text: (card as HTMLElement).innerText,
          priceText:
            (card.querySelector('[role="status"]') as HTMLElement | null)
              ?.innerText ?? "",
        })),
      }));
      quotes.push(...parseExpediaQuotes(provider, scope, window, snapshot));
    } catch (error) {
      const body =
        (await handle?.page
          .locator("body")
          .innerText({ timeout: 2000 })
          .catch(() => "")) ?? "";
      const blocked = /human or a bot|bot or not|verify.*human|captcha/i.test(
        body,
      );
      const reason = blocked
        ? "Expedia erişim doğrulaması istedi; otomatik oda fiyatı alınamadı."
        : "Expedia oda fiyatı veya arama koşulları doğrulanamadı.";
      warnings.push(
        `Expedia / ${scope.hotelName} / ${window.checkIn}: ${blocked ? reason : error instanceof Error ? error.message.split("\n")[0] : reason}`,
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
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
  return { quotes, warnings };
}
