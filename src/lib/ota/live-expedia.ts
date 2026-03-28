import type {
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition
} from "@/src/lib/benchmark/types";
import { EXPEDIA_HOTEL_CONFIG } from "@/src/lib/ota/live-config";
import {
  buildManualReviewQuotes,
  createBrowserPage,
  findSnippet,
  normalizeTextLines,
  parsePriceFromText,
  resolveProviderLiveConfig
} from "@/src/lib/ota/live-helpers";

function buildExpediaUrl(baseUrl: string, scope: ReportScopeDefinition, checkIn: string, checkOut: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("chkin", checkIn);
  url.searchParams.set("chkout", checkOut);
  url.searchParams.set("adults", "2");
  url.searchParams.set("x_pwa", "1");
  url.searchParams.set("rfrr", "HSR");
  url.searchParams.set("pwa_ts", "0");
  url.searchParams.set("destination", scope.hotelName);
  url.searchParams.set("sort", "RECOMMENDED");
  return url.toString();
}

export async function collectExpediaLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition
): Promise<ProviderCollectionResult> {
  const config = EXPEDIA_HOTEL_CONFIG[scope.hotelKey];

  if (!config) {
    return buildManualReviewQuotes(
      provider,
      scope,
      "",
      `Expedia icin ${scope.hotelName} mapping'i bulunamadi.`
    );
  }

  let browserHandle: Awaited<ReturnType<typeof createBrowserPage>> | null = null;
  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];
  const liveConfig = resolveProviderLiveConfig("expedia");

  try {
    browserHandle = await createBrowserPage(liveConfig);

    for (const window of scope.windows) {
      const sourceHint = buildExpediaUrl(
        config.pageUrl,
        scope,
        window.checkIn,
        window.checkOut
      );

      await browserHandle.page.goto(sourceHint, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
      await browserHandle.page.waitForTimeout(2500);

      const title = await browserHandle.page.title();
      const bodyText = await browserHandle.page.locator("body").innerText();

      if (/bot or not/i.test(title) || /human or a bot/i.test(bodyText)) {
        warnings.push(
          `Expedia bot korumasi tetiklendi: ${scope.label} / ${window.label}`
        );
        quotes.push(
          ...scope.rooms.map((room) => ({
            providerKey: provider.key,
            scopeKey: scope.id,
            roomId: room.id,
            windowId: window.id,
            price: null,
            currency: scope.currency,
            status: "manual-review" as const,
            dataMode: "live" as const,
            sourceHint
          }))
        );
        continue;
      }

      const lines = normalizeTextLines(bodyText);
      for (const room of scope.rooms) {
        const snippet = findSnippet(lines, config.roomAliases[room.id] ?? [room.name]);
        const price = snippet ? parsePriceFromText(snippet, scope.currency) : null;

        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price,
          currency: scope.currency,
          status: price ? "available" : "manual-review",
          dataMode: "live" as const,
          sourceHint
        });
      }
    }
  } catch (error) {
    return buildManualReviewQuotes(
      provider,
      scope,
      config.pageUrl,
      `Expedia live collector hatasi: ${
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
