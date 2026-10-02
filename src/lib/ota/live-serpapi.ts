import type {
  BenchmarkWindowDefinition,
  HotelPriceObservation,
  OtaKey,
  ProviderDescriptor,
  ReportScopeDefinition,
} from "../benchmark/types";
import { readBoundedJson } from "../server/bounded-json";
import { GOOGLE_HOTEL_IDS } from "./google-hotel-config";
import { parsePriceFromText } from "./live-helpers";
import { reserveSerpApiRequest } from "./serpapi-budget";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const SELLERS: Partial<Record<OtaKey, RegExp>> = {
  booking: /^booking\.com$/i,
  expedia: /^expedia(?:\.(?:com|de|co\.uk))?$/i,
  tui: /^tui(?:\.com)?$/i,
  holidaycheck: /^holidaycheck(?:\.de)?$/i,
  loveholidays: /^loveholidays(?:\.com)?$/i,
  onthebeach: /^on\s?the\s?beach(?:\.co\.uk)?$/i,
};

export const serpApiEnabled = () => process.env.SERPAPI_ENABLED === "true";
export const serpApiConfigured = () =>
  serpApiEnabled() && !!process.env.SERPAPI_API_KEY?.trim();

function safeOfferUrl(value: unknown, provider: OtaKey): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null;
    const hosts: Partial<Record<OtaKey, string[]>> = {
      booking: ["booking.com", "www.booking.com"],
      expedia: ["www.expedia.com", "www.expedia.de", "www.expedia.co.uk"],
      tui: ["www.tui.com"],
      holidaycheck: ["www.holidaycheck.de"],
      loveholidays: ["www.loveholidays.com"],
      onthebeach: ["www.onthebeach.co.uk"],
    };
    if (url.hostname === "www.google.com") {
      if (
        !["/aclk", "/travel/clk", "/travel/lodging/clk"].includes(url.pathname)
      )
        return null;
    } else if (!hosts[provider]?.includes(url.hostname)) return null;
    if (
      [...url.searchParams.keys()].some((key) =>
        /api.?key|token|secret|password/i.test(key),
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseSerpApiHotelPrices(
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  providers: ProviderDescriptor[],
  payload: unknown,
  now = Date.now(),
): HotelPriceObservation[] {
  const data = object(payload);
  const params = object(data.search_parameters);
  const metadata = object(data.search_metadata);
  const observed =
    typeof metadata.created_at === "string"
      ? Date.parse(metadata.created_at)
      : NaN;
  const token = GOOGLE_HOTEL_IDS[scope.hotelKey];
  const name =
    typeof data.name === "string"
      ? data.name.toLowerCase().replace(/\s+/g, " ").trim()
      : "";
  if (
    data.error ||
    metadata.status !== "Success" ||
    !Number.isFinite(observed) ||
    now - observed > 15 * 60_000 ||
    observed - now > 60_000 ||
    params.engine !== "google_hotels" ||
    params.check_in_date !== window.checkIn ||
    params.check_out_date !== window.checkOut ||
    params.currency !== scope.currency ||
    params.adults !== 2 ||
    params.children !== 0 ||
    params.gl !== (scope.currency === "GBP" ? "uk" : "de") ||
    (params.property_token !== undefined && params.property_token !== token) ||
    data.property_token !== token ||
    data.type !== "hotel" ||
    ![
      scope.hotelName.toLowerCase(),
      `${scope.hotelName.toLowerCase()} hotel`,
    ].includes(name)
  )
    throw new Error(
      "SerpAPI otel, tarih, kişi, pazar, para birimi veya veri zamanı doğrulanamadı.",
    );

  // Never use rate_per_night, a hotel-wide minimum, or an unknown seller as an OTA rate.
  const candidates = [...list(data.prices), ...list(data.featured_prices)];
  return providers.flatMap((provider) => {
    const valid = candidates
      .flatMap((raw) => {
        const offer = object(raw);
        if (
          typeof offer.source !== "string" ||
          !SELLERS[provider.key]?.test(offer.source.trim()) ||
          offer.num_guests !== 2 ||
          (offer.num_rooms !== undefined && offer.num_rooms !== 1)
        )
          return [];
        const total = object(offer.total_rate);
        const price = total.extracted_lowest;
        const label = total.lowest;
        const url = safeOfferUrl(offer.link, provider.key);
        if (
          !url ||
          typeof price !== "number" ||
          !Number.isFinite(price) ||
          price <= 0 ||
          price > 1_000_000 ||
          typeof label !== "string" ||
          !/^(?:[€£]\s*[\d., ]+|[\d., ]+\s*(?:EUR|GBP))$/.test(label.trim()) ||
          parsePriceFromText(label, scope.currency) !== price
        )
          return [];
        return [{ price, url }];
      })
      .sort((a, b) => a.price - b.price);
    if (!valid.length) return [];
    return [
      {
        scopeKey: scope.id,
        windowId: window.id,
        providerKey: provider.key,
        providerName: provider.name,
        price: valid[0].price,
        currency: scope.currency,
        source: "google-hotels" as const,
        collectedVia: "serpapi" as const,
        sourceUrl: `https://www.google.com/travel/hotels/entity/${token}`,
        offerUrl: valid[0].url,
        observedAt: new Date(observed).toISOString(),
      },
    ];
  });
}

export async function collectSerpApiHotelPrices(
  scope: ReportScopeDefinition,
  providers: ProviderDescriptor[],
  dependencies = {
    fetch: globalThis.fetch,
    reserve: reserveSerpApiRequest,
    key: process.env.SERPAPI_API_KEY?.trim() || "",
    now: Date.now,
  },
) {
  const hotelPrices: HotelPriceObservation[] = [];
  const warnings: string[] = [];
  if (!providers.some((provider) => SELLERS[provider.key]))
    return { hotelPrices, warnings };
  if (!dependencies.key)
    return {
      hotelPrices,
      warnings: ["SerpAPI API anahtarı eksik; ek fiyat servisi sorgulanmadı."],
    };
  for (const window of scope.windows) {
    // Reserve before making a request, including unsuccessful requests. No paid retry loop.
    try {
      await dependencies.reserve();
    } catch {
      warnings.push(
        "SerpAPI sorgusu yapılmadı: günlük/aylık deneme sınırı doldu veya kalıcı kullanım sayacına erişilemiyor.",
      );
      break;
    }
    const url = new URL("https://serpapi.com/search.json");
    url.search = new URLSearchParams({
      engine: "google_hotels",
      api_key: dependencies.key,
      q: `${scope.hotelName} Side Turkey`,
      property_token: GOOGLE_HOTEL_IDS[scope.hotelKey],
      check_in_date: window.checkIn,
      check_out_date: window.checkOut,
      adults: "2",
      children: "0",
      currency: scope.currency,
      gl: scope.currency === "GBP" ? "uk" : "de",
      hl: "en",
      no_cache: "true",
      output: "json",
    }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await dependencies.fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        warnings.push(
          `SerpAPI / ${scope.label}: ${response.status === 401 || response.status === 403 ? "API erişimi reddedildi" : response.status === 429 ? "Servis kotası doldu" : "Servis isteği tamamlanamadı"}.`,
        );
        continue;
      }
      const payload = await readBoundedJson(response, 4 * 1024 * 1024);
      const prices = parseSerpApiHotelPrices(
        scope,
        window,
        providers,
        payload,
        dependencies.now(),
      );
      hotelPrices.push(...prices);
      if (!prices.length)
        warnings.push(
          `SerpAPI / ${scope.label} / ${window.checkIn}: seçilen OTA'lar için doğrulanmış konaklama toplamı bulunamadı; bu bir doluluk sonucu değildir.`,
        );
    } catch {
      // Never expose upstream payloads, exceptions or the URL: they can contain the key.
      warnings.push(
        `SerpAPI / ${scope.label} / ${window.checkIn}: servis yanıtı alınamadı veya otel/tarih/toplam fiyat doğrulanamadı.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return { hotelPrices, warnings };
}
