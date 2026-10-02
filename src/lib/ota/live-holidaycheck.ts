import type {
  BenchmarkWindowDefinition,
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";
import { HOLIDAYCHECK_HOTEL_CONFIG } from "./live-config";
import {
  buildManualReviewQuotes,
  createBrowserPage,
  normalizeInlineText,
  resolveProviderLiveConfig,
} from "./live-helpers";
import {
  classifyRoom,
  deduplicateOffers,
  matchOfferRoom,
  selectOfferQuotes,
} from "./offer-matching";

type DateValue =
  | { day?: number; month?: number; year?: number; formatted?: string }
  | string
  | null;
export interface HolidayCheckOffer {
  travelkind?: string;
  hotelId?: string;
  numberOfRooms?: number;
  adults?: number;
  children?: unknown[];
  totalPrice?: { amount?: number; currency?: string };
  room?: { description?: string; name?: string };
  rooms?: { description?: string; name?: string }[];
  departureDate?: DateValue;
  returnDate?: DateValue;
  stayStartDate?: DateValue;
  stayEndDate?: DateValue;
  mealTypeName?: string;
  tourOperator?: { name?: string };
  cancellationInformation?: { freeCancellationUntilISO?: string | null };
  availability?: { checkNeeded?: boolean; status?: string };
  specials?: {
    specialType?: string;
    specialTexts?: { key?: string; text?: string }[];
    discount?: { amount?: number; currency?: string };
  }[];
}

function normalizeDate(value?: DateValue): string | null {
  if (!value) return null;
  if (typeof value === "string")
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  if (
    typeof value.year === "number" &&
    typeof value.month === "number" &&
    typeof value.day === "number"
  )
    return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  const match = value.formatted?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function buildHolidayCheckHotelOnlyUrl(
  pageUrl: string,
  checkIn: string,
  checkOut: string,
): string | null {
  const match = pageUrl.match(
    /^https:\/\/www\.holidaycheck\.de\/hi\/([^/]+)\/([a-f0-9-]+)\/?$/i,
  );
  return match
    ? `https://www.holidaycheck.de/ho/angebote-${match[1]}/${match[2]}/hotelonly?_offer=departureDate:${checkIn},duration:exactly,returnDate:${checkOut},rooms:a-a`
    : null;
}

export function parseHolidayCheckOffers(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  rawOffers: HolidayCheckOffer[],
  sourceHint: string,
): CollectedOffer[] {
  const expectedHotelId = HOLIDAYCHECK_HOTEL_CONFIG[scope.hotelKey]?.pageUrl
    .split("/")
    .filter(Boolean)
    .at(-1);
  const offers: CollectedOffer[] = [];
  const observedAt = new Date().toISOString();
  for (const offer of rawOffers) {
    const price = offer?.totalPrice?.amount;
    if (
      !offer ||
      (normalizeDate(offer.stayStartDate) ??
        normalizeDate(offer.departureDate)) !== window.checkIn ||
      (normalizeDate(offer.stayEndDate) ?? normalizeDate(offer.returnDate)) !==
        window.checkOut ||
      offer.travelkind !== "hotelonly" ||
      offer.hotelId !== expectedHotelId ||
      offer.numberOfRooms !== 1 ||
      offer.adults !== 2 ||
      !Array.isArray(offer.children) ||
      offer.children.length !== 0 ||
      offer.totalPrice?.currency !== scope.currency ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0 ||
      (offer.availability?.status &&
        !["AVAILABLE", "UNKNOWN"].includes(offer.availability.status))
    )
      continue;
    const roomName = normalizeInlineText(
      offer.room?.description ??
        offer.room?.name ??
        offer.rooms?.[0]?.description ??
        offer.rooms?.[0]?.name ??
        "",
    );
    if (!roomName) continue;
    // Do not infer room identity from HolidayCheck's LLM-generated room details.
    const roomFeatures = classifyRoom(roomName);
    const cancellation = offer.specials?.find(
      (special) => special.specialType === "CANCELLATION",
    );
    const cashback = offer.specials?.find(
      (special) => special.specialType === "PERSONAL_CASH_BACK",
    );
    const cashbackAmount = cashback?.discount?.amount;
    const cancellationText = cancellation?.specialTexts
      ?.filter((text) =>
        ["label", "description", "subLabel"].includes(text.key ?? ""),
      )
      .map((text) => normalizeInlineText(text.text ?? ""))
      .filter(Boolean)
      .join(" / ");
    offers.push({
      id: `holidaycheck:${scope.id}:${window.id}:${offers.length}`,
      providerKey: provider.key,
      scopeKey: scope.id,
      windowId: window.id,
      checkIn: window.checkIn,
      checkOut: window.checkOut,
      nights: window.nights,
      rooms: 1,
      adults: 2,
      price,
      currency: scope.currency,
      roomName,
      roomFeatures,
      sourceHint,
      observedAt,
      ...matchOfferRoom(scope, roomFeatures),
      terms: {
        board: offer.mealTypeName || "Belirtilmedi",
        operator: offer.tourOperator?.name,
        cancellation:
          cancellationText ||
          (offer.cancellationInformation?.freeCancellationUntilISO
            ? `Ücretsiz iptal son tarihi: ${offer.cancellationInformation.freeCancellationUntilISO}`
            : "Belirtilmedi"),
        taxes: "Vergi ve ek ücret dökümü ayrıca doğrulanmadı",
        availability:
          offer.availability?.status === "AVAILABLE" &&
          offer.availability.checkNeeded === false
            ? "Kaynak serviste müsait; önbellekli olabilir, rezervasyon adımında tekrar doğrulanmalı."
            : "Teklif fiyatı; kaynakta müsaitlik kontrolü gerekiyor.",
        cashback:
          typeof cashbackAmount === "number" &&
          Number.isFinite(cashbackAmount) &&
          cashbackAmount > 0 &&
          cashback?.discount?.currency === scope.currency
            ? {
                amount: cashbackAmount,
                currency: scope.currency,
                conditions:
                  cashback.specialTexts
                    ?.filter((text) => text.key === "description")
                    .map((text) => normalizeInlineText(text.text ?? ""))
                    .join(" ") ||
                  "Koşullu iade; şartları kaynakta kontrol edilmeli.",
              }
            : undefined,
      },
    });
  }
  return deduplicateOffers(offers);
}

function extractOffers(payload: unknown): HolidayCheckOffer[] {
  const data =
    payload && typeof payload === "object" && "data" in payload
      ? payload.data
      : null;
  return data &&
    typeof data === "object" &&
    "offers" in data &&
    Array.isArray(data.offers)
    ? data.offers
    : [];
}

async function readWindow(
  page: Awaited<ReturnType<typeof createBrowserPage>>["page"],
  url: string,
) {
  const responsePromise = page
    .waitForResponse(
      (response) =>
        response.url().includes("holidaycheck.de/api/all-offers-service"),
      { timeout: 25000 },
    )
    .catch(() => null);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  const response = await responsePromise;
  const payload = response?.ok()
    ? await response.json().catch(() => null)
    : null;
  const apiOffers = extractOffers(payload);
  const pageOffers = (await page.evaluate(() => {
    const state = (
      window as unknown as {
        __FLUXIBLE_STATE__?: {
          dispatcher?: {
            stores?: { HotelOfferStore?: { offers?: unknown[] } };
          };
        };
      }
    ).__FLUXIBLE_STATE__;
    const offers = state?.dispatcher?.stores?.HotelOfferStore?.offers;
    return Array.isArray(offers) ? offers : [];
  })) as HolidayCheckOffer[];
  return {
    offers: apiOffers.length ? apiOffers : pageOffers,
    confirmedEmpty:
      Array.isArray(payload?.data?.offers) &&
      payload.data.offers.length === 0 &&
      !pageOffers.length,
    currentUrl: page.url(),
    title: await page.title(),
  };
}

export async function collectHolidayCheckLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const config = HOLIDAYCHECK_HOTEL_CONFIG[scope.hotelKey];
  if (!config)
    return buildManualReviewQuotes(
      provider,
      scope,
      "",
      "HolidayCheck otel eşleştirmesi bulunamadı.",
    );
  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];
  let handle: Awaited<ReturnType<typeof createBrowserPage>> | undefined;
  try {
    handle = await createBrowserPage(resolveProviderLiveConfig("holidaycheck"));
    for (const window of scope.windows) {
      const sourceHint = buildHolidayCheckHotelOnlyUrl(
        config.pageUrl,
        window.checkIn,
        window.checkOut,
      );
      try {
        if (!sourceHint)
          throw new Error(
            "HolidayCheck uçaksız arama bağlantısı oluşturulamadı.",
          );
        const state = await readWindow(handle.page, sourceHint);
        const actualUrl = new URL(state.currentUrl);
        const expectedUrl = new URL(sourceHint);
        if (
          /captcha|blocked|challenge/i.test(state.title) ||
          actualUrl.origin !== expectedUrl.origin ||
          actualUrl.pathname !== expectedUrl.pathname ||
          actualUrl.searchParams.get("_offer") !==
            expectedUrl.searchParams.get("_offer")
        )
          throw new Error(
            "HolidayCheck doğrulama ekranı veya beklenmeyen yönlendirme döndürdü.",
          );
        const windowOffers = parseHolidayCheckOffers(
          provider,
          scope,
          window,
          state.offers,
          sourceHint,
        );
        offers.push(...windowOffers);
        const windowQuotes = selectOfferQuotes(
          provider,
          scope,
          window,
          windowOffers,
          sourceHint,
        );
        quotes.push(
          ...windowQuotes.map((quote) =>
            state.confirmedEmpty
              ? {
                  ...quote,
                  status: "sold_out" as const,
                  reason:
                    "HolidayCheck bu arama için uçaksız teklif döndürmedi; otelin tüm kanallarda dolu olduğu anlamına gelmez.",
                }
              : quote,
          ),
        );
        if (!windowOffers.length)
          warnings.push(
            `HolidayCheck / ${scope.hotelName} / ${window.label}: ${state.confirmedEmpty ? "Uçaksız teklif yok." : "Otel, tarih, kişi ve toplam fiyat doğrulamasından geçen teklif yok."}`,
          );
      } catch (error) {
        const reason = `HolidayCheck: ${error instanceof Error ? error.message.split("\n")[0] : "Fiyat okunamadı."}`;
        const failure = buildManualReviewQuotes(
          provider,
          { ...scope, windows: [window] },
          sourceHint ?? config.pageUrl,
          reason,
          reason,
        );
        quotes.push(...failure.quotes);
        warnings.push(...failure.warnings);
      }
    }
  } catch (error) {
    return buildManualReviewQuotes(
      provider,
      scope,
      config.pageUrl,
      `HolidayCheck: ${error instanceof Error ? error.message : "Tarayıcı başlatılamadı."}`,
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return { quotes, offers, warnings };
}
