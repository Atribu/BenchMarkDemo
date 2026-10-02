import { REPORT_SCOPES } from "./sample-data";
import { OTA_PROVIDERS } from "../ota/registry";
import { parseBenchmarkRequest, nightCount, todayInIstanbul } from "./request";
import { buildCollectionPlan } from "./collection-plan";
import { buildBenchmarkResult } from "./engine";
import { assertBrowserCaptureFresh } from "./browser-import-merge";
import { parseLoveholidaysOffers } from "../ota/live-loveholidays";
import { parseOnTheBeachOffers } from "../ota/live-onthebeach";
import type {
  BenchmarkRunResult,
  BrowserImportedOffer,
  ProviderQuote,
} from "./types";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Geçersiz aktarım dosyası.");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 500): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > limit ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error("Aktarımda eksik veya geçersiz metin alanı var.");
  return value;
}
function number(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 60
  )
    throw new Error("Aktarımın gece, oda veya kişi bilgisi geçersiz.");
  return value;
}

export function prepareBrowserImport(
  input: unknown,
  now = new Date(),
): BenchmarkRunResult {
  const payload = record(input);
  const request = parseBenchmarkRequest(payload.request, todayInIstanbul(now));
  if (request.mode !== "live")
    throw new Error("Demo raporuna gerçek tarayıcı kaydı eklenemez.");
  const capture = record(payload.capture);
  if (
    capture.format !== "dgtlface-ota-capture" ||
    capture.version !== 1 ||
    (capture.providerKey !== "loveholidays" &&
      capture.providerKey !== "onthebeach")
  )
    throw new Error(
      "Bu dosya desteklenen Loveholidays / On the Beach aktarımı değil.",
    );
  const providerKey = capture.providerKey;
  if (!request.providerKeys.includes(providerKey))
    throw new Error("Dosyadaki OTA seçili değil. Önce ilgili kanalı seçin.");
  const observedAt = text(capture.observedAt, 40);
  assertBrowserCaptureFresh(observedAt, now.getTime());
  const snapshot = record(capture.snapshot);
  const hotelName = text(snapshot.hotelName, 100).trim();
  const source = new URL(
    text(
      providerKey === "loveholidays" ? snapshot.url : snapshot.sourceUrl,
      2000,
    ),
  );
  if (source.username || source.password || source.hash)
    throw new Error(
      "Kaynak bağlantısı kimlik bilgisi veya beklenmeyen bölüm içeriyor.",
    );
  // Export only search parameters, not tracking identifiers or unrelated page data.
  const allowed =
    providerKey === "loveholidays"
      ? ["masterId", "nights", "rooms", "date"]
      : ["filters[hotel_name]", "ordering", "pagination[page]"];
  if (
    [...source.searchParams.keys()].some(
      (key) =>
        !allowed.includes(key) || source.searchParams.getAll(key).length !== 1,
    )
  )
    throw new Error(
      "Kaynak bağlantısında beklenmeyen arama parametresi var. Yardımcıyla yeniden dışa aktarın.",
    );
  if (
    !Array.isArray(snapshot.offers) ||
    snapshot.offers.length === 0 ||
    snapshot.offers.length > 200
  )
    throw new Error(
      "Dosyada 1–200 oda teklifi bulunmalı. Fiyatların yüklenmesini bekleyin.",
    );
  const rawOffers = snapshot.offers.map(record);
  const dates = request.customWindow!;
  const window = {
    id: `${dates.checkIn}_${dates.checkOut}`,
    label: `${dates.checkIn} -> ${dates.checkOut}`,
    ...dates,
    nights: nightCount(dates.checkIn, dates.checkOut)!,
  };
  const providers = OTA_PROVIDERS.filter((provider) =>
    request.providerKeys.includes(provider.key),
  );
  const plan = buildCollectionPlan(
    REPORT_SCOPES.filter((scope) => request.scopeKeys.includes(scope.id)).map(
      (scope) => ({ ...scope, windows: [window] }),
    ),
    providers,
    REPORT_SCOPES,
  );
  const currency =
    providerKey === "onthebeach"
      ? "GBP"
      : source.pathname.startsWith("/de/")
        ? "EUR"
        : "GBP";
  if (providerKey === "loveholidays") {
    for (const offer of rawOffers) {
      const priceText = text(offer.priceText, 300);
      const totals = priceText.match(/\b(total|insgesamt)\b/gi) ?? [];
      if (
        totals.length !== 1 ||
        /flights?|flug|per person|pro person|deposit|anzahlung|per party/i.test(
          priceText,
        ) ||
        (currency === "EUR"
          ? /[£$]|\b(GBP|USD)\b/i
          : /[€$]|\b(EUR|USD)\b/i
        ).test(priceText)
      )
        throw new Error(
          "Loveholidays fiyat alanı tek bir uçaksız oda toplamı içermeli; uçaklı, kişi başı, depozito veya karışık para birimi kabul edilmez.",
        );
    }
  }
  const task = plan.tasks.find(
    (task) =>
      task.provider.key === providerKey &&
      task.scope.hotelName.toLowerCase() === hotelName.toLowerCase() &&
      task.scope.currency === currency,
  );
  if (!task)
    throw new Error(
      "Dosyanın oteli veya para birimi seçiminizle eşleşmiyor. EUR ve GBP birbirine çevrilmez.",
    );
  if (providerKey === "onthebeach" && (window.nights < 2 || window.nights > 28))
    throw new Error("On the Beach aktarımı 2–28 gece destekler.");
  const parsed =
    providerKey === "loveholidays"
      ? parseLoveholidaysOffers(task.provider, task.scope, window, {
          url: source.href,
          hotelName,
          checkInLabel: text(snapshot.checkInLabel, 100),
          nightsLabel: text(snapshot.nightsLabel, 100),
          occupancyLabel: text(snapshot.occupancyLabel, 100),
          offers: rawOffers.map((offer) => ({
            name: text(offer.name, 300),
            priceText: text(offer.priceText, 300),
            description: text(offer.description, 2000),
          })),
        })
      : parseOnTheBeachOffers(task.provider, task.scope, window, {
          sourceUrl: source.href,
          hotelName,
          checkInLabel: text(snapshot.checkInLabel, 100),
          returnLabel: text(snapshot.returnLabel, 100),
          nights: number(snapshot.nights),
          adults: number(snapshot.adults),
          children: number(snapshot.children),
          infants: number(snapshot.infants),
          rooms: number(snapshot.rooms),
          totalSelected: snapshot.totalSelected === true,
          offers: rawOffers.map((offer) => ({
            roomName: text(offer.roomName, 300),
            priceText: text(offer.priceText, 300),
            board: text(offer.board, 200),
          })),
        });
  if (!parsed.length)
    throw new Error(
      "Doğru para biriminde uçaksız konaklama toplamı bulunamadı. Kişi başı, gecelik veya uçaklı fiyatlar kabul edilmez.",
    );
  const browserOffers: BrowserImportedOffer[] = parsed.map((offer, index) => ({
    ...offer,
    id: `browser:${providerKey}:${task.scope.id}:${window.id}:${index}`,
    providerKey,
    captureMethod: "browser-assisted",
    hotelName: task.scope.hotelName,
    observedAt: new Date(observedAt).toISOString(),
    importedAt: now.toISOString(),
    terms: {
      ...offer.terms,
      availability:
        "Kullanıcı başlatımlı tarayıcı aktarımı; sunucu OTA'ya bağlanmadı. Dosya kaynağı imzalı değildir. Son fiyat ve müsaitlik yeniden kontrol edilmeli.",
    },
  }));
  const quotes: ProviderQuote[] = plan.tasks.flatMap(({ scope, provider }) =>
    scope.rooms.map((room) => ({
      scopeKey: scope.id,
      providerKey: provider.key,
      windowId: window.id,
      roomId: room.id,
      currency: scope.currency,
      price: null,
      status: "manual-review",
      dataMode: "live",
      sourceHint: "",
      reason:
        "Bu rapor tarayıcı aktarımıyla oluşturuldu; otomatik OTA sorgusu yapılmadı. Aktarılan teklifler ayrı bölümde.",
    })),
  );
  return {
    ...buildBenchmarkResult({
      mode: "live",
      scopes: plan.scopes,
      providers,
      providersByScope: plan.providersByScope,
      quotes,
      warnings: [
        ...plan.warnings,
        `Tarayıcı aktarımı: ${browserOffers.length} teklif kabul edildi. ${rawOffers.length - parsed.length} geçersiz veya tekrarlanan teklif dışarıda bırakıldı. Otomatik oda kapsamasına eklenmez.`,
      ],
    }),
    collectionMethod: "browser-import",
    browserOffers,
  };
}
