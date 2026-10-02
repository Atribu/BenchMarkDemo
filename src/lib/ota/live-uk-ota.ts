import type {
  BenchmarkWindowDefinition,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";
import {
  LOVEHOLIDAYS_HOTEL_CONFIG,
  ONTHEBEACH_HOTEL_CONFIG,
} from "@/src/lib/ota/live-config";
import {
  buildManualReviewQuotes,
  createBrowserPage,
  normalizeInlineText,
  resolveProviderLiveConfig,
} from "@/src/lib/ota/live-helpers";

function buildUkSearchUrl(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
) {
  // The old On the Beach /holidays/search route returns 404. This is only an
  // access probe: a hotel landing page is NOT a dated, hotel-only price source.
  if (provider.key === "onthebeach")
    return ONTHEBEACH_HOTEL_CONFIG[scope.hotelKey]?.pageUrl ?? "";
  if (provider.searchTemplate)
    return provider.searchTemplate
      .replace("{hotelName}", encodeURIComponent(scope.hotelName))
      .replace("{checkIn}", window.checkIn)
      .replace("{checkOut}", window.checkOut);
  return LOVEHOLIDAYS_HOTEL_CONFIG[scope.hotelKey]?.pageUrl ?? "";
}

function pageDiagnostic(status: number, title: string, visibleText: string) {
  const text = `${title} ${visibleText}`;
  // Never scan raw HTML: bot-library names also appear on working pages.
  // A 404 is a URL error, not a captcha.
  if (
    status === 404 ||
    /we can[’']t find that page|page not found/i.test(text)
  ) {
    return "Sayfa bulunamadı (404). Otel bağlantısı güncellenmeli.";
  }
  if (
    /captcha|access denied|verify (?:that )?you are (?:a )?human|human or a bot|enable javascript.*continue|disable any ad blocker|checking your browser|security verification/i.test(
      text,
    )
  ) {
    return "Site erişim doğrulaması istedi; seçilen tarih için oda fiyatına ulaşılamadı.";
  }
  if (status >= 400) return `Site HTTP ${status} döndürdü; fiyat alınamadı.`;
  if (!visibleText.trim())
    return "Sayfa içeriği yüklenmedi; fiyat doğrulanamadı.";
  return "Sayfa açıldı; seçilen tarihe ait uçaksız oda toplamını okuyan entegrasyon henüz tamamlanmadı. Genel kampanya fiyatları kullanılmadı.";
}

async function collectUkBrowserQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  let browserHandle: Awaited<ReturnType<typeof createBrowserPage>> | null =
    null;
  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];
  try {
    browserHandle = await createBrowserPage(
      resolveProviderLiveConfig(provider.key),
    );
    for (const window of scope.windows) {
      let sourceHint = buildUkSearchUrl(provider, scope, window);
      let reason: string;
      try {
        if (!sourceHint) throw new Error("Otel bağlantısı tanımlı değil.");
        const response = await browserHandle.page.goto(sourceHint, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await browserHandle.page.waitForTimeout(2500);
        const title = await browserHandle.page.title();
        const bodyText = normalizeInlineText(
          await browserHandle.page.locator("body").innerText(),
        );
        sourceHint = browserHandle.page.url() || sourceHint;
        reason = pageDiagnostic(response?.status() ?? 0, title, bodyText);
      } catch (error) {
        reason =
          "Sayfa bağlantısı veya yanıtı doğrulanamadı. Bu bir müsaitlik sonucu değildir.";
        warnings.push(
          `${provider.name} / ${scope.label} / ${window.label}: ${error instanceof Error ? error.message : "Bağlantı hatası"}`,
        );
      }
      warnings.push(
        `${provider.name} / ${scope.label} / ${window.label}: ${reason}`,
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
  } catch (error) {
    return buildManualReviewQuotes(
      provider,
      scope,
      "",
      `${provider.name}: ${error instanceof Error ? error.message : "Tarayıcı başlatılamadı."}`,
    );
  } finally {
    await browserHandle?.browser.close().catch(() => undefined);
  }
  return { quotes, warnings };
}

export { collectLoveholidaysLiveQuotes } from "./live-loveholidays";
export { collectOnTheBeachLiveQuotes } from "./live-onthebeach";
export const __ukOtaInternal = { buildUkSearchUrl, pageDiagnostic };
