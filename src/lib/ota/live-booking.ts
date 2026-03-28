import type {
  BenchmarkWindowDefinition,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition
} from "@/src/lib/benchmark/types";
import { BOOKING_HOTEL_CONFIG } from "@/src/lib/ota/live-config";
import {
  buildManualReviewQuotes,
  createBrowserPage,
  extractNightCountPrice,
  normalizeInlineText,
  resolveProviderLiveConfig
} from "@/src/lib/ota/live-helpers";

function buildBookingSearchUrl(
  searchQuery: string,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition
) {
  const url = new URL("https://www.booking.com/searchresults.html");
  url.searchParams.set("ss", searchQuery);
  url.searchParams.set("checkin", window.checkIn);
  url.searchParams.set("checkout", window.checkOut);
  url.searchParams.set("group_adults", "2");
  url.searchParams.set("req_adults", "2");
  url.searchParams.set("no_rooms", "1");
  url.searchParams.set("group_children", "0");
  url.searchParams.set("selected_currency", scope.currency);
  return url.toString();
}

async function dismissBookingModal(
  page: Awaited<ReturnType<typeof createBrowserPage>>["page"]
) {
  const dismissButton = page.locator('button[aria-label="Dismiss sign-in info."]');

  if (await dismissButton.count()) {
    await dismissButton.first().click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

function buildWindowQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  sourceHint: string,
  status: ProviderQuote["status"],
  price: number | null = null
): ProviderQuote[] {
  return scope.rooms.map((room) => {
    return {
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId: room.id,
      windowId: window.id,
      price,
      currency: scope.currency,
      status,
      dataMode: "live" as const,
      sourceHint
    };
  });
}

export async function collectBookingLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition
): Promise<ProviderCollectionResult> {
  const config = BOOKING_HOTEL_CONFIG[scope.hotelKey];

  if (!config?.searchQuery) {
    return buildManualReviewQuotes(
      provider,
      scope,
      "",
      `Booking icin ${scope.hotelName} search mapping'i bulunamadi.`
    );
  }

  let browserHandle: Awaited<ReturnType<typeof createBrowserPage>> | null = null;
  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];
  const liveConfig = resolveProviderLiveConfig("booking");

  try {
    browserHandle = await createBrowserPage(liveConfig);

    for (const window of scope.windows) {
      const sourceHint = buildBookingSearchUrl(config.searchQuery, scope, window);

      await browserHandle.page.goto(sourceHint, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
      await browserHandle.page.waitForTimeout(2500);
      await dismissBookingModal(browserHandle.page);

      const title = await browserHandle.page.title();
      const currentUrl = browserHandle.page.url();
      if (
        /challenge|blocked|captcha/i.test(title) ||
        (!currentUrl.includes("/searchresults.html") && currentUrl.includes("/index.html"))
      ) {
        warnings.push(
          `Booking search akisi challenge veya redirect verdi: ${scope.label} / ${window.label}`
        );
        quotes.push(...buildWindowQuotes(provider, scope, window, sourceHint, "manual-review"));
        continue;
      }

      const cardLocator = browserHandle.page
        .locator('[data-testid="property-card"]')
        .filter({
          hasText: config.cardName ?? scope.hotelName
        })
        .first();

      const cardCount = await cardLocator.count();

      if (!cardCount) {
        warnings.push(`Booking property card bulunamadi: ${scope.label} / ${window.label}`);
        quotes.push(...buildWindowQuotes(provider, scope, window, sourceHint, "manual-review"));
        continue;
      }

      const cardText = normalizeInlineText(await cardLocator.innerText());

      if (
        /unavailable on our site for your dates/i.test(cardText) ||
        /has no availability on our site from/i.test(cardText)
      ) {
        warnings.push(
          `Booking property card'i requested dates icin sold-out dondu: ${scope.label} / ${window.label}`
        );
        quotes.push(...buildWindowQuotes(provider, scope, window, sourceHint, "sold_out"));
        continue;
      }

      const hotelLevelPrice = extractNightCountPrice(
        cardText,
        window.nights,
        scope.currency
      );

      if (hotelLevelPrice !== null) {
        warnings.push(
          `Booking searchresults yalnizca hotel-level fiyat verdi: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...buildWindowQuotes(
            provider,
            scope,
            window,
            sourceHint,
            "manual-review",
            hotelLevelPrice
          )
        );
        continue;
      }

      quotes.push(...buildWindowQuotes(provider, scope, window, sourceHint, "manual-review"));
    }
  } catch (error) {
    return buildManualReviewQuotes(
      provider,
      scope,
      config.searchQuery,
      `Booking live collector hatasi: ${
        error instanceof Error ? error.message : "bilinmeyen hata"
      }`
    );
  } finally {
    if (browserHandle) {
      await browserHandle.browser.close().catch(() => undefined);
    }
  }

  return {
    quotes,
    warnings
  };
}
