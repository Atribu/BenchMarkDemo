import type { BenchmarkRunResult, BrowserImportedOffer } from "./types";

export const BROWSER_CAPTURE_MAX_AGE_MS = 30 * 60 * 1000;
export const BROWSER_CAPTURE_MAX_BYTES = 256 * 1024;

export function browserBatchKey(offer: BrowserImportedOffer) {
  return `${offer.providerKey}:${offer.scopeKey}:${offer.windowId}`;
}

export function assertBrowserCaptureFresh(
  observedAt: string,
  now = Date.now(),
) {
  const time = Date.parse(observedAt);
  if (
    !Number.isFinite(time) ||
    time > now + 60_000 ||
    now - time >= BROWSER_CAPTURE_MAX_AGE_MS
  )
    throw new Error(
      "Tarayıcı kaydı 30 dakikadan eski veya saati geçersiz. OTA sayfasını yenileyip yeniden dışa aktarın.",
    );
}

// Replace a whole search batch, not just equal prices: removed OTA offers must not linger.
export function mergeBrowserImport(
  current: BenchmarkRunResult | null,
  incoming: BenchmarkRunResult,
  now = Date.now(),
): BenchmarkRunResult {
  const offers = incoming.browserOffers ?? [];
  if (!offers.length || incoming.mode !== "live" || current?.mode === "mock")
    throw new Error(
      "Tarayıcı aktarımı yalnızca gerçek veri raporuna eklenebilir.",
    );
  const target = current ?? incoming;
  for (const offer of offers) {
    assertBrowserCaptureFresh(offer.observedAt, now);
    const scope = target.scopes.find((scope) => scope.id === offer.scopeKey);
    if (
      !scope ||
      !scope.providers.some((provider) => provider.key === offer.providerKey) ||
      !scope.windows.some(
        (window) =>
          window.id === offer.windowId &&
          window.checkIn === offer.checkIn &&
          window.checkOut === offer.checkOut,
      ) ||
      scope.currency !== offer.currency
    )
      throw new Error(
        "Aktarım mevcut raporun otel, kanal, tarih veya para birimiyle eşleşmiyor.",
      );
    const newer = current?.browserOffers?.some(
      (previous) =>
        browserBatchKey(previous) === browserBatchKey(offer) &&
        Date.parse(previous.observedAt) > Date.parse(offer.observedAt),
    );
    if (newer)
      throw new Error(
        "Raporda bu aramanın daha yeni bir tarayıcı kaydı var. Eski dosya uygulanmadı.",
      );
  }
  const replaced = new Set(offers.map(browserBatchKey));
  return {
    ...target,
    browserOffers: [
      ...(current?.browserOffers ?? []).filter(
        (offer) => !replaced.has(browserBatchKey(offer)),
      ),
      ...offers,
    ],
  };
}
