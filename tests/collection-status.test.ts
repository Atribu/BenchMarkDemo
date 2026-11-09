
import test from "node:test";
import assert from "node:assert/strict";

import {
  benchmarkStatusLabel,
  classifyBenchmarkErrorCode,
} from "../src/lib/benchmark/status";
import type { BenchmarkErrorCode } from "../src/lib/benchmark/types";
import { runBenchmarkJob } from "../src/lib/ota/run-benchmark";

test("unavailable rates use structured error codes", () => {
  const examples: {
    errorCode: BenchmarkErrorCode;
    expected: string;
  }[] = [
    {
      errorCode: "hotel_mapping_missing",
      expected: "Otel eşleştirmesi eksik",
    },
    {
      errorCode: "no_inventory",
      expected: "Teklif bulunamadı",
    },
    {
      errorCode: "room_mapping_failed",
      expected: "Oda eşleşmesi doğrulanamadı",
    },
    {
      errorCode: "access_blocked",
      expected: "Site erişimi engellendi",
    },
    {
      errorCode: "rate_limited",
      expected: "Sorgu hız sınırına ulaşıldı",
    },
    {
      errorCode: "timeout",
      expected: "Sorgu zaman aşımı",
    },
    {
      errorCode: "invalid_response",
      expected: "Geçersiz kaynak yanıtı",
    },
    {
      errorCode: "currency_mismatch",
      expected: "Para birimi uyuşmuyor",
    },
    {
      errorCode: "configuration_missing",
      expected: "Entegrasyon ayarı eksik",
    },
  ];

  for (const { errorCode, expected } of examples) {
    assert.equal(
      benchmarkStatusLabel({
        status: "manual-review",
        dataMode: "live",
        errorCode,
      }),
      expected,
      `Incorrect label for ${errorCode}`,
    );
  }
});

test("missing error codes retain generic status labels", () => {
  assert.equal(
    benchmarkStatusLabel({
      status: "manual-review",
      dataMode: "live",
    }),
    "Kontrol bekliyor",
  );

  assert.equal(
    benchmarkStatusLabel({
      status: "missing",
      dataMode: "live",
    }),
    "Fiyat alınamadı",
  );
});

test("collector reasons are classified centrally when no explicit code exists", () => {
  const examples = [
    ["Booking HTTP 429 döndürdü.", "rate_limited"],
    ["Site doğrulaması gerekiyor (CAPTCHA).", "access_blocked"],
    ["locator.click: Timeout 15000ms exceeded.", "timeout"],
    ["Queen için otel eşleştirmesi eksik.", "hotel_mapping_missing"],
    ["Servis API anahtarı eksik.", "configuration_missing"],
    ["İstenen oda için fiyat eşleşmedi.", "room_mapping_failed"],
    ["Teklif bulunamadı.", "no_inventory"],
    [
      "Delphin Imperial seçili tarihlerde Hotel Only envanterinde listelenmedi.",
      "no_inventory",
    ],
    ["Kaynak yanıtı ayrıştırılamadı.", "invalid_response"],
  ] as const;

  for (const [reason, expected] of examples) {
    assert.equal(
      classifyBenchmarkErrorCode({
        status: "manual-review",
        dataMode: "live",
        reason,
      }),
      expected,
      reason,
    );
  }
});

test("collector errors reach report cells with structured status labels", async () => {
  const previousGoogle = process.env.OTA_GOOGLE_HOTELS;
  const previousSecondary = process.env.OTA_HOLIDAYCHECK_SECONDARY;
  process.env.OTA_GOOGLE_HOTELS = "false";
  process.env.OTA_HOLIDAYCHECK_SECONDARY = "false";

  try {
    const report = await runBenchmarkJob(
      {
        mode: "live",
        providerKeys: ["booking"],
        scopeKeys: ["queen-eu"],
        customWindow: {
          checkIn: "2027-05-10",
          checkOut: "2027-05-15",
        },
      },
      async (provider, scope) => ({
        quotes: scope.windows.flatMap((window) =>
          scope.rooms.map((room, index) => ({
            providerKey: provider.key,
            scopeKey: scope.id,
            roomId: room.id,
            windowId: window.id,
            price: index === 0 ? null : 1000,
            currency: index === 0 ? scope.currency : "GBP",
            status: index === 0 ? "manual-review" as const : "available" as const,
            dataMode: "live" as const,
            sourceHint: "https://example.test",
            reason:
              index === 0
                ? "locator.click: Timeout 15000ms exceeded."
                : undefined,
          })),
        ),
        warnings: [],
      }),
    );

    const entries = report.scopes[0].windows[0].rows.map(
      (row) => row.entries[0],
    );
    assert.equal(entries[0].errorCode, "timeout");
    assert.equal(benchmarkStatusLabel(entries[0]), "Sorgu zaman aşımı");
    assert.equal(entries[1].errorCode, "currency_mismatch");
    assert.equal(benchmarkStatusLabel(entries[1]), "Para birimi uyuşmuyor");
    assert.equal(report.collectionAttempts?.length, 1);
    assert.equal(report.collectionAttempts?.[0].status, "partial");
    assert.equal(report.reliability?.[0].queryAttemptCount, 1);
    assert.equal(report.reliability?.[0].queryReliabilityPct, 100);
    assert.equal(report.reliability?.[0].reliabilityPct, 0);
  } finally {
    if (previousGoogle === undefined) delete process.env.OTA_GOOGLE_HOTELS;
    else process.env.OTA_GOOGLE_HOTELS = previousGoogle;
    if (previousSecondary === undefined)
      delete process.env.OTA_HOLIDAYCHECK_SECONDARY;
    else process.env.OTA_HOLIDAYCHECK_SECONDARY = previousSecondary;
  }
});

test("CHECK24 retries once after a timeout and keeps the successful result", async () => {
  const previousGoogle = process.env.OTA_GOOGLE_HOTELS;
  const previousSecondary = process.env.OTA_HOLIDAYCHECK_SECONDARY;
  process.env.OTA_GOOGLE_HOTELS = "false";
  process.env.OTA_HOLIDAYCHECK_SECONDARY = "false";
  let calls = 0;

  try {
    const report = await runBenchmarkJob(
      {
        mode: "live",
        providerKeys: ["check24"],
        scopeKeys: ["queen-eu"],
        customWindow: {
          checkIn: "2027-05-10",
          checkOut: "2027-05-15",
        },
      },
      async (provider, scope) => {
        calls++;
        return {
          quotes: scope.rooms.map((room) => ({
            providerKey: provider.key,
            scopeKey: scope.id,
            roomId: room.id,
            windowId: scope.windows[0].id,
            price: calls === 1 ? null : 1400,
            currency: scope.currency,
            status:
              calls === 1
                ? ("manual-review" as const)
                : ("available" as const),
            errorCode: calls === 1 ? ("timeout" as const) : undefined,
            dataMode: "live" as const,
            sourceHint: "https://hotels.check24.de/",
            reason: calls === 1 ? "Timeout 60000ms exceeded." : undefined,
          })),
          warnings: calls === 1 ? ["İlk CHECK24 çağrısı zaman aşımı."] : [],
        };
      },
    );

    assert.equal(calls, 2);
    assert.ok(
      report.scopes[0].windows[0].rows.every(
        (row) => row.entries[0].status === "available",
      ),
    );
    assert.ok(
      report.warnings.some((warning) => warning.includes("yeniden denendi")),
    );
  } finally {
    if (previousGoogle === undefined) delete process.env.OTA_GOOGLE_HOTELS;
    else process.env.OTA_GOOGLE_HOTELS = previousGoogle;
    if (previousSecondary === undefined)
      delete process.env.OTA_HOLIDAYCHECK_SECONDARY;
    else process.env.OTA_HOLIDAYCHECK_SECONDARY = previousSecondary;
  }
});

test("real, demo, manual and no-offer results retain their provenance", () => {
  assert.equal(
    benchmarkStatusLabel({
      status: "available",
      dataMode: "live",
    }),
    "Canlı fiyat",
  );

  assert.equal(
    benchmarkStatusLabel({
      status: "available",
      dataMode: "mock",
    }),
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
    benchmarkStatusLabel({
      status: "sold_out",
      dataMode: "live",
    }),
    "Teklif bulunamadı",
  );

  assert.equal(
    benchmarkStatusLabel({
      status: "missing",
      dataMode: "live",
    }),
    "Fiyat alınamadı",
  );
});

test("status and provenance take priority over error codes", () => {
  assert.equal(
    benchmarkStatusLabel({
      status: "available",
      dataMode: "live",
      errorCode: "timeout",
    }),
    "Canlı fiyat",
  );

  assert.equal(
    benchmarkStatusLabel({
      status: "available",
      dataMode: "live",
      captureMethod: "manual-browser",
      errorCode: "access_blocked",
    }),
    "Elle doğrulandı",
  );

  assert.equal(
    benchmarkStatusLabel({
      status: "manual-review",
      dataMode: "live",
      captureMethod: "manual-browser",
      errorCode: "timeout",
    }),
    "Eski elle kontrol",
  );
});
