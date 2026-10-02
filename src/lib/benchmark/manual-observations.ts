import type {
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "./types";
import { hasCompatibleView } from "../ota/room-matching";
import { nightCount } from "./request";

// Manual observations are historical evidence, never a live collector result.
export const MANUAL_FRESHNESS_MS = 24 * 60 * 60 * 1000;

const SOURCE_HOSTS: Record<string, string[]> = {
  booking: ["booking.com"],
  expedia: ["expedia.com", "expedia.de", "expedia.co.uk"],
  onthebeach: ["onthebeach.co.uk"],
  loveholidays: ["loveholidays.com"],
  tui: ["tui.com"],
  holidaycheck: ["holidaycheck.de"],
  hotelbeds: ["hotelbeds.com"],
};

function key(
  quote: Pick<
    ProviderQuote,
    "providerKey" | "scopeKey" | "roomId" | "windowId"
  >,
) {
  return [quote.providerKey, quote.scopeKey, quote.roomId, quote.windowId].join(
    ":",
  );
}

export function mergeManualObservations(
  quotes: ProviderQuote[],
  scopes: ReportScopeDefinition[],
  providers: ProviderDescriptor[],
  records: unknown[],
  now = Date.now(),
): ProviderCollectionResult {
  const candidates = new Map<string, ProviderQuote>();
  for (const value of records) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const scope = scopes.find(
      (item) =>
        item.id === record.scopeKey && item.hotelKey === record.hotelKey,
    );
    const provider = providers.find(
      (item) =>
        item.key === record.providerKey &&
        scope &&
        item.supportedScopes.includes(scope.id),
    );
    const room = scope?.rooms.find((item) => item.id === record.roomId);
    const window = scope?.windows.find(
      (item) =>
        item.checkIn === record.checkIn && item.checkOut === record.checkOut,
    );
    if (
      !scope ||
      !provider ||
      !room ||
      !window ||
      record.currency !== scope.currency ||
      record.adults !== 2 ||
      record.children !== 0 ||
      record.rooms !== 1 ||
      record.hotelOnly !== true ||
      record.priceBasis !== "stay-total" ||
      typeof record.price !== "number" ||
      !Number.isFinite(record.price) ||
      record.price <= 0 ||
      typeof record.observedAt !== "string" ||
      typeof record.sourceUrl !== "string" ||
      typeof record.roomName !== "string" ||
      !hasCompatibleView(room.id, record.roomName) ||
      nightCount(window.checkIn, window.checkOut) !== window.nights
    )
      continue;
    const observed = Date.parse(record.observedAt);
    if (!Number.isFinite(observed) || observed > now) continue;
    try {
      const url = new URL(record.sourceUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !SOURCE_HOSTS[provider.key]?.some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
      )
        continue;
    } catch {
      continue;
    }
    const stale = now - observed >= MANUAL_FRESHNESS_MS;
    const candidate: ProviderQuote = {
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId: room.id,
      windowId: window.id,
      price: record.price,
      currency: scope.currency,
      status: stale ? "manual-review" : "available",
      dataMode: "live",
      captureMethod: "manual-browser",
      observedAt: record.observedAt,
      sourceHint: record.sourceUrl,
      offerDescription: record.roomName,
      offerConditions:
        typeof record.conditions === "string" ? record.conditions : undefined,
      reason: stale
        ? "Elle kontrolün üzerinden 24 saat geçti. Eski fiyat gösteriliyor; yeniden doğrulanmadan karşılaştırmaya alınmaz."
        : "Siteden elle doğrulandı; bu sorgu sırasında otomatik alınmadı. Fiyat ve müsaitlik değişebilir.",
    };
    const previous = candidates.get(key(candidate));
    if (!previous || observed > Date.parse(previous.observedAt!))
      candidates.set(key(candidate), candidate);
  }

  const merged = new Map(quotes.map((quote) => [key(quote), quote]));
  let manualCount = 0;
  for (const [id, candidate] of candidates) {
    const current = merged.get(id);
    // A current automated availability/no-offer response takes precedence.
    if (
      current &&
      current.captureMethod !== "manual-browser" &&
      current.currency === candidate.currency &&
      (current.status === "sold_out" ||
        (current.status === "available" &&
          current.price !== null &&
          Number.isFinite(current.price) &&
          current.price > 0))
    )
      continue;
    merged.set(id, candidate);
    manualCount++;
  }
  return {
    quotes: [...merged.values()],
    warnings: manualCount
      ? [
          `${manualCount} hücrede siteden elle kontrol edilmiş kayıt kullanıldı. Bunlar anlık otomatik fiyat değildir; kontrol saati hücrelerde ve CSV'de yer alır. 24 saatten eski kayıtlar karşılaştırma dışıdır.`,
        ]
      : [],
  };
}
