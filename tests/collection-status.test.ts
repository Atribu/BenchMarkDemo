import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkStatusLabel } from "../src/lib/benchmark/status";

test("unavailable rates distinguish configuration, access, mapping and query failures", () => {
  const examples = [
    [
      "Booking otel sayfasini Turkiye ana sayfasina yonlendirdi; bu bir doluluk sonucu degil.",
      "Bölgesel erişim engeli",
    ],
    [
      "Hotelbeds API anahtarı, secret veya mTLS sertifikası eksik.",
      "API ayarı eksik",
    ],
    ["Hotelbeds otel kodu tanımlı değil.", "Otel eşleştirmesi eksik"],
    ["Queen için otel/pazar eşleştirmesi eksik.", "Otel eşleştirmesi eksik"],
    ["Expedia erişim doğrulaması istedi.", "Site doğrulaması gerekli"],
    [
      "Site erisim dogrulamasi veya hiz siniri uyguladi.",
      "Site doğrulaması gerekli",
    ],
    ["Site doğrulaması gerekiyor (CAPTCHA).", "Site doğrulaması gerekli"],
    ["locator.click: Timeout 15000ms exceeded.", "Sorgu zaman aşımı"],
    [
      "TUI oda servisine ulaşılamadı veya yanıt doğrulanamadı.",
      "Kaynağa erişilemedi",
    ],
    [
      "Otel bulundu ancak istenen oda için toplam fiyat eşleşmedi.",
      "Oda fiyatı eşleşmedi",
    ],
    ["Tanımlanamayan hata", "Kontrol bekliyor"],
  ];
  for (const [reason, expected] of examples)
    assert.equal(
      benchmarkStatusLabel({
        status: "manual-review",
        dataMode: "live",
        reason,
      }),
      expected,
    );
});

test("real, demo, manual and no-offer results retain their provenance", () => {
  assert.equal(
    benchmarkStatusLabel({ status: "available", dataMode: "live" }),
    "Canlı fiyat",
  );
  assert.equal(
    benchmarkStatusLabel({ status: "available", dataMode: "mock" }),
    "Örnek fiyat",
  );
  assert.equal(
    benchmarkStatusLabel({
      status: "available",
      dataMode: "live",
      captureMethod: "manual-browser",
    }),
    "Elle doğrulandı",
  );
  assert.equal(
    benchmarkStatusLabel({
      status: "manual-review",
      dataMode: "live",
      captureMethod: "manual-browser",
    }),
    "Eski elle kontrol",
  );
  assert.equal(
    benchmarkStatusLabel({ status: "sold_out", dataMode: "live" }),
    "Teklif bulunamadı",
  );
  assert.equal(
    benchmarkStatusLabel({ status: "missing", dataMode: "live" }),
    "Fiyat alınamadı",
  );
});
