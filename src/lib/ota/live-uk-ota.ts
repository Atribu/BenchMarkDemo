import type {
  BenchmarkWindowDefinition,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition
} from "@/src/lib/benchmark/types";
import {
  LOVEHOLIDAYS_HOTEL_CONFIG,
  ONTHEBEACH_HOTEL_CONFIG
} from "@/src/lib/ota/live-config";
import {
  buildManualReviewQuotes,
  createBrowserPage,
  normalizeInlineText,
  parsePriceFromText,
  resolveProviderLiveConfig
} from "@/src/lib/ota/live-helpers";

function buildUkSearchUrl(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition
) {
  if (provider.searchTemplate) {
    return provider.searchTemplate
      .replace("{hotelName}", encodeURIComponent(scope.hotelName))
      .replace("{checkIn}", window.checkIn)
      .replace("{checkOut}", window.checkOut);
  }

  const mappedPageUrl =
    provider.key === "loveholidays"
      ? LOVEHOLIDAYS_HOTEL_CONFIG[scope.hotelKey]?.pageUrl
      : provider.key === "onthebeach"
        ? ONTHEBEACH_HOTEL_CONFIG[scope.hotelKey]?.pageUrl
        : undefined;

  return mappedPageUrl ?? "";
}

function buildWindowQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  sourceHint: string,
  status: ProviderQuote["status"],
  price: number | null = null
) {
  return scope.rooms.map((room) => ({
    providerKey: provider.key,
    scopeKey: scope.id,
    roomId: room.id,
    windowId: window.id,
    price,
    currency: scope.currency,
    status,
    dataMode: "live" as const,
    sourceHint
  }));
}

function detectChallengeReason(text: string, title: string) {
  const normalized = `${title} ${text}`.toLowerCase();

  if (
    /captcha|challenge|access denied|forbidden|blocked|enable js|disable any ad blocker|geo\.captcha-delivery/i.test(
      normalized
    )
  ) {
    return "anti-bot veya captcha duvari";
  }

  return null;
}

async function collectUkBrowserQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition
): Promise<ProviderCollectionResult> {
  let browserHandle: Awaited<ReturnType<typeof createBrowserPage>> | null = null;
  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];
  const liveConfig = resolveProviderLiveConfig(provider.key);

  try {
    browserHandle = await createBrowserPage(liveConfig);

    for (const window of scope.windows) {
      const sourceHint = buildUkSearchUrl(provider, scope, window);

      const response = await browserHandle.page.goto(sourceHint, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
      await browserHandle.page.waitForTimeout(2500);

      const title = await browserHandle.page.title();
      const bodyText = normalizeInlineText(
        await browserHandle.page.locator("body").innerText().catch(() => "")
      );
      const html = normalizeInlineText(await browserHandle.page.content().catch(() => ""));
      const currentUrl = browserHandle.page.url();
      const cookieNames = (
        await browserHandle.context.cookies(sourceHint).catch(() => [])
      ).map((cookie) => cookie.name);
      const challengeReason = detectChallengeReason(`${bodyText} ${html}`, title);
      const protectionCookieHint = cookieNames.length
        ? ` / cookies: ${cookieNames.join(", ")}`
        : "";

      if (challengeReason) {
        warnings.push(
          `${provider.name} sayfasi ${challengeReason} verdi: ${scope.label} / ${window.label}${protectionCookieHint}`
        );
        quotes.push(
          ...buildWindowQuotes(provider, scope, window, currentUrl || sourceHint, "manual-review")
        );
        continue;
      }

      if (response && response.status() === 404) {
        warnings.push(
          `${provider.name} sayfasi 404 dondu. URL veya hotel mapping'i guncellenmeli: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...buildWindowQuotes(provider, scope, window, currentUrl || sourceHint, "manual-review")
        );
        continue;
      }

      if (response && response.status() >= 400) {
        warnings.push(
          `${provider.name} sayfasi HTTP ${response.status()} dondu: ${scope.label} / ${window.label}${protectionCookieHint}`
        );
        quotes.push(
          ...buildWindowQuotes(provider, scope, window, currentUrl || sourceHint, "manual-review")
        );
        continue;
      }

      if (!bodyText) {
        warnings.push(
          `${provider.name} sayfasi yuklendi ama parse edilebilir body text donmedi: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...buildWindowQuotes(provider, scope, window, currentUrl || sourceHint, "manual-review")
        );
        continue;
      }

      const price = parsePriceFromText(bodyText, scope.currency);

      if (price !== null) {
        warnings.push(
          `${provider.name} su an yalnizca hotel-level veya search-level fiyat sinyali verdi: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...buildWindowQuotes(
            provider,
            scope,
            window,
            currentUrl || sourceHint,
            "manual-review",
            price
          )
        );
        continue;
      }

      warnings.push(
        `${provider.name} sayfasi acildi ama parse edilebilir fiyat bulunamadi: ${scope.label} / ${window.label}`
      );
      quotes.push(
        ...buildWindowQuotes(provider, scope, window, currentUrl || sourceHint, "manual-review")
      );
    }
  } catch (error) {
    return buildManualReviewQuotes(
      provider,
      scope,
      provider.searchTemplate ?? "",
      `${provider.name} live collector hatasi: ${
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

export async function collectLoveholidaysLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition
) {
  return collectUkBrowserQuotes(provider, scope);
}

export async function collectOnTheBeachLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition
) {
  return collectUkBrowserQuotes(provider, scope);
}
