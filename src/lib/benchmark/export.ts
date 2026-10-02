import type { BenchmarkRunResult } from "./types";
import { offerConditions } from "../ota/offer-matching";

function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  // Prevent spreadsheet formulas in externally supplied text.
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function benchmarkCsv(report: BenchmarkRunResult): string {
  const rows: (string | number | null)[][] = [
    [
      "Oluşturulma",
      "Veri türü",
      "Otel",
      "Pazar",
      "Giriş",
      "Çıkış",
      "Gece",
      "Oda",
      "Kişi",
      "OTA",
      "Para birimi",
      "Konaklama toplamı",
      "Durum",
      "Kaynak oda / pansiyon",
      "Teklif koşulları",
      "Kontrol zamanı (UTC)",
      "Açıklama",
      "Kaynak",
      "Kayıt sınıfı",
      "Manzara sınıfı",
      "Balkon (yes/no/unknown)",
    ],
  ];
  for (const scope of report.scopes)
    for (const window of scope.windows)
      for (const room of window.rows)
        for (const entry of room.entries) {
          rows.push([
            report.generatedAt,
            report.mode === "mock"
              ? "DEMO / GERÇEK DEĞİL"
              : report.collectionMethod === "browser-import"
                ? "OTOMATİK SORGU YAPILMADI"
                : entry.captureMethod === "manual-browser"
                  ? "ELLE KONTROL / ANLIK DEĞİL"
                  : "CANLI",
            scope.hotelName,
            scope.marketLabel,
            window.checkIn,
            window.checkOut,
            window.nights,
            room.roomName,
            room.occupancyLabel,
            entry.providerName,
            scope.currency,
            entry.scrapedPrice,
            entry.status,
            entry.offerDescription ?? null,
            entry.offerConditions ?? null,
            entry.observedAt ?? null,
            entry.reason ?? null,
            entry.sourceHint,
            "ODA SATIRI",
            entry.roomFeatures?.view ?? null,
            entry.roomFeatures?.balcony ?? null,
          ]);
        }
  for (const scope of report.scopes)
    for (const window of scope.windows)
      for (const offer of window.alternativeOffers ?? []) {
        rows.push([
          report.generatedAt,
          "CANLI",
          scope.hotelName,
          scope.marketLabel,
          window.checkIn,
          window.checkOut,
          window.nights,
          offer.roomName,
          "1 oda / 2 yetişkin",
          report.providers.find(
            (provider) => provider.key === offer.providerKey,
          )?.name ?? offer.providerKey,
          offer.currency,
          offer.price,
          "ALTERNATİF",
          offer.roomName,
          offerConditions(offer.terms),
          offer.observedAt,
          offer.matchReason,
          offer.sourceHint,
          "ALTERNATİF TEKLİF / ODA KAPSAMASINA DAHİL DEĞİL",
          offer.roomFeatures.view,
          offer.roomFeatures.balcony,
        ]);
      }
  for (const offer of report.secondaryOffers ?? []) {
    const providerName =
      report.providers.find(
        (provider) => provider.key === offer.advertisedProviderKey,
      )?.name ?? offer.advertisedProviderKey;
    rows.push([
      report.generatedAt,
      "EK KAYNAK / DOĞRUDAN OTA DOĞRULAMASI DEĞİL",
      offer.hotelName,
      "HolidayCheck / Avrupa",
      offer.checkIn,
      offer.checkOut,
      offer.nights,
      offer.roomName,
      "1 oda / 2 yetişkin",
      `${providerName} (HolidayCheck üzerinden)`,
      offer.currency,
      offer.price,
      "EK KAYNAK",
      offer.roomName,
      offerConditions(offer.terms),
      offer.observedAt,
      offer.matchReason,
      offer.sourceHint,
      "EK KAYNAK / ODA KAPSAMASINA DAHİL DEĞİL",
      offer.roomFeatures.view,
      offer.roomFeatures.balcony,
    ]);
  }
  for (const price of report.hotelPrices ?? []) {
    const scope = report.scopes.find((item) => item.id === price.scopeKey);
    const window = scope?.windows.find((item) => item.id === price.windowId);
    if (!scope || !window) continue;
    rows.push([
      report.generatedAt,
      "EK KAYNAK / OTEL BAŞLANGIÇ TOPLAMI",
      scope.hotelName,
      scope.marketLabel,
      window.checkIn,
      window.checkOut,
      window.nights,
      "Oda doğrulanmadı",
      "1 oda / 2 yetişkin",
      price.providerName,
      price.currency,
      price.price,
      "EK KAYNAK",
      null,
      "Oda, pansiyon ve vergi ayrıntıları ayrıca doğrulanmalı.",
      price.observedAt,
      price.collectedVia === "serpapi"
        ? "Google Hotels / SerpAPI"
        : "Google Hotels",
      price.offerUrl,
      "OTEL BAŞLANGIÇ TOPLAMI / ODA KAPSAMASINA DAHİL DEĞİL",
      null,
      null,
    ]);
  }
  for (const offer of report.browserOffers ?? [])
    rows.push([
      report.generatedAt,
      "TARAYICI AKTARIMI / KULLANICI BAŞLATIMLI / SUNUCUDAN DOĞRULANMADI",
      offer.hotelName,
      offer.currency === "EUR" ? "Avrupa" : "Birleşik Krallık",
      offer.checkIn,
      offer.checkOut,
      offer.nights,
      offer.roomName,
      "1 oda / 2 yetişkin",
      report.providers.find((provider) => provider.key === offer.providerKey)
        ?.name ?? offer.providerKey,
      offer.currency,
      offer.price,
      "TARAYICI KAYDI",
      offer.roomName,
      offerConditions(offer.terms),
      offer.observedAt,
      `${offer.matchReason} Aktarım zamanı: ${offer.importedAt}`,
      offer.sourceHint,
      "TARAYICI AKTARIMI / OTOMATİK ODA KAPSAMASINA DAHİL DEĞİL",
      offer.roomFeatures.view,
      offer.roomFeatures.balcony,
    ]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
