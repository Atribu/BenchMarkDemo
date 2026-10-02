import type {
  BenchmarkWindowDefinition,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "../benchmark/types";
import { BOOKING_HOTEL_CONFIG } from "./live-config";
import {
  createBrowserPage,
  normalizeInlineText,
  parsePriceFromText,
  resolveProviderLiveConfig,
} from "./live-helpers";
import { assertPricePageAccessible } from "./browser-diagnostics";
import { namedRoomRank } from "./live-onthebeach";

export interface BookingSnapshot {
  url: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  occupancy: string;
  stayLabel: string;
  rows: {
    name: string;
    priceText: string;
    conditions: string;
    selectable: boolean;
  }[];
}

export function buildBookingUrl(
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
) {
  const config = BOOKING_HOTEL_CONFIG[scope.hotelKey];
  if (!config) throw new Error("Booking otel eslestirmesi eksik.");
  const url = new URL(config.pageUrl);
  url.pathname = url.pathname.replace(
    /(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.html$/,
    ".en-gb.html",
  );
  url.search = new URLSearchParams({
    checkin: window.checkIn,
    checkout: window.checkOut,
    group_adults: "2",
    group_children: "0",
    no_rooms: "1",
    selected_currency: scope.currency,
    lang: "en-gb",
    sb_price_type: "total",
  }).toString();
  return url.toString();
}

function propertyPath(url: URL) {
  return url.pathname.replace(/(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.html$/, "");
}

export function parseBookingQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  snapshot: BookingSnapshot,
): ProviderQuote[] {
  const url = new URL(snapshot.url);
  const expected = new URL(buildBookingUrl(scope, window));
  const stay = normalizeInlineText(snapshot.stayLabel);
  if (
    url.origin !== expected.origin ||
    propertyPath(url) !== propertyPath(expected) ||
    [
      "checkin",
      "checkout",
      "group_adults",
      "group_children",
      "no_rooms",
      "selected_currency",
    ].some(
      (key) => url.searchParams.get(key) !== expected.searchParams.get(key),
    ) ||
    ![
      scope.hotelName,
      `${scope.hotelName} Hotel`,
      BOOKING_HOTEL_CONFIG[scope.hotelKey]?.cardName,
      BOOKING_HOTEL_CONFIG[scope.hotelKey]?.searchQuery,
    ]
      .filter(Boolean)
      .map((name) => name!.toLowerCase())
      .includes(normalizeInlineText(snapshot.hotelName).toLowerCase()) ||
    snapshot.checkIn !== window.checkIn ||
    snapshot.checkOut !== window.checkOut ||
    !/^2 adults\s*[·,]\s*0 children\s*[·,]\s*1 room$/i.test(
      normalizeInlineText(snapshot.occupancy),
    ) ||
    !new RegExp(`\\b(?:price for|for) ${window.nights} nights?\\b`, "i").test(
      stay,
    )
  ) {
    throw new Error(
      "Booking otel, tarih, kisi veya oda toplam fiyati dogrulanamadi.",
    );
  }
  return scope.rooms.map((room) => {
    const offers = snapshot.rows
      .flatMap((row) => {
        const rank = namedRoomRank(room.id, row.name);
        const text = normalizeInlineText(row.priceText);
        // Never use a search-card/calendar price or multiply a nightly estimate.
        const amount =
          /^(?:(?:€|£|EUR|GBP)\s*[\d.,]+|[\d.,]+\s*(?:€|£|EUR|GBP))$/.test(text)
            ? parsePriceFromText(text, scope.currency)
            : null;
        return row.selectable && rank !== null && amount !== null && amount > 0
          ? [{ ...row, price: amount, rank }]
          : [];
      })
      .sort((a, b) => a.rank - b.rank || a.price - b.price);
    const best = offers[0];
    return {
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId: room.id,
      windowId: window.id,
      price: best?.price ?? null,
      currency: scope.currency,
      status: best ? "available" : "manual-review",
      dataMode: "live",
      captureMethod: "automated",
      observedAt: new Date().toISOString(),
      sourceHint: snapshot.url,
      offerDescription: best?.name,
      offerConditions: best
        ? `${window.nights} gece, 1 oda, 2 yetiskin; ${normalizeInlineText(best.conditions)}; vergi ve iptal ayrintilari kaynakta kontrol edilmeli`
        : undefined,
      reason: best
        ? undefined
        : "Oda tablosunda bu kategori için seçilebilir ve doğrulanmış toplam fiyat bulunamadı.",
    };
  });
}

export async function collectBookingLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const warnings: string[] = [];
  let handle: Awaited<ReturnType<typeof createBrowserPage>> | undefined;
  try {
    handle = await createBrowserPage(
      resolveProviderLiveConfig("booking", scope.currency),
    );
    for (const window of scope.windows) {
      let sourceHint = "";
      try {
        sourceHint = buildBookingUrl(scope, window);
        const page = handle.page;
        const response = await page.goto(sourceHint, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await assertPricePageAccessible(page, response?.status());
        const dismiss = page.getByRole("button", {
          name: "Dismiss sign-in info.",
          exact: true,
        });
        if (await dismiss.isVisible()) await dismiss.click();
        const reject = page.getByRole("button", {
          name: /^(Reject all|Only necessary cookies)$/i,
        });
        if (await reject.isVisible()) await reject.click();
        await page
          .locator(
            "#hprt-table tr[data-block-id], #rooms_table tr[data-block-id]",
          )
          .first()
          .waitFor({ timeout: 25000 });
        const snapshot = await page.evaluate((): BookingSnapshot => {
          const value = (name: string) =>
            (
              document.querySelector(
                `input[name="${name}"]`,
              ) as HTMLInputElement | null
            )?.value ?? "";
          const buttons = Array.from(document.querySelectorAll("button"));
          const occupancy =
            buttons.find((button) =>
              /2 adults.*0 children.*1 room/i.test(button.innerText),
            )?.innerText ?? "";
          const table = document.querySelector("#hprt-table, #rooms_table");
          let name = "";
          const rows = Array.from(
            table?.querySelectorAll("tr[data-block-id]") ?? [],
          ).map((row) => {
            name =
              row
                .querySelector(
                  '[data-testid="rt-name-link"], .hprt-roomtype-link',
                )
                ?.textContent?.trim() || name;
            const prices = Array.from(
              row.querySelectorAll(
                '[data-testid="price-and-discounted-price"], .bui-price-display__value, .prco-valign-middle-helper',
              ),
            ).filter(
              (node) =>
                (node as HTMLElement).checkVisibility() &&
                !node.closest("s, del, .bui-price-display__original"),
            );
            const select = row.querySelector("select");
            return {
              name,
              priceText:
                (prices[0] as HTMLElement | undefined)?.innerText ?? "",
              conditions: (row as HTMLElement).innerText,
              selectable:
                !!select &&
                !select.disabled &&
                Array.from(select.options).some(
                  (option) => !option.disabled && Number(option.value) > 0,
                ),
            };
          });
          return {
            url: location.href,
            hotelName:
              document.querySelector("#hp_hotel_name, h2.pp-header__title, h1")
                ?.textContent ?? "",
            checkIn: value("checkin"),
            checkOut: value("checkout"),
            occupancy,
            stayLabel: table?.querySelector("thead")?.textContent ?? "",
            rows,
          };
        });
        quotes.push(...parseBookingQuotes(provider, scope, window, snapshot));
      } catch (error) {
        let reason =
          error instanceof Error
            ? error.message.split("\n")[0]
            : "Booking oda fiyatı alınamadı.";
        try {
          await assertPricePageAccessible(handle.page);
        } catch (diagnostic) {
          reason = (diagnostic as Error).message;
        }
        warnings.push(
          `Booking / ${scope.label} / ${window.checkIn}: ${reason}`,
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
  return { quotes, warnings };
}
