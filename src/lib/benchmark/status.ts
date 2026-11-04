
import type {
  BenchmarkCell,
  BenchmarkErrorCode,
  ProviderQuote,
} from "./types";

const ERROR_LABELS: Record<BenchmarkErrorCode, string> = {
  hotel_mapping_missing: "Otel eşleştirmesi eksik",
  no_inventory: "Teklif bulunamadı",
  room_mapping_failed: "Oda eşleşmesi doğrulanamadı",
  access_blocked: "Site erişimi engellendi",
  rate_limited: "Sorgu hız sınırına ulaşıldı",
  timeout: "Sorgu zaman aşımı",
  invalid_response: "Geçersiz kaynak yanıtı",
  currency_mismatch: "Para birimi uyuşmuyor",
  configuration_missing: "Entegrasyon ayarı eksik",
};

export function benchmarkErrorLabel(errorCode: BenchmarkErrorCode): string {
  return ERROR_LABELS[errorCode];
}

function normalizeReason(reason?: string): string {
  return (reason ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

export function classifyBenchmarkErrorCode(
  quote: Pick<
    ProviderQuote,
    "status" | "dataMode" | "reason" | "errorCode"
  >,
): BenchmarkErrorCode | null {
  if (quote.status === "available") return null;
  if (quote.errorCode) return quote.errorCode;
  if (quote.status === "sold_out") return "no_inventory";

  const reason = normalizeReason(quote.reason);

  if (/http 429|rate.?limit|hiz siniri|cok fazla istek/.test(reason))
    return "rate_limited";
  if (/timeout|zaman asimi|timed out/.test(reason)) return "timeout";
  if (
    /captcha|bot challenge|access denied|erisim (?:engellendi|reddedildi)|dogrulama.*(?:istedi|gerek)|http 403|tr_redirected|turkiye ana sayfasina|current query blocked/.test(
      reason,
    )
  )
    return "access_blocked";
  if (/para birimi|currency.*mismatch|wrong currency/.test(reason))
    return "currency_mismatch";
  if (
    /(?:eur|gbp|rub) kapsami.*dogrulanmadi|pazari.*dogrulanmadi/.test(reason)
  )
    return "currency_mismatch";
  if (
    /otel (?:kodu|kimligi)|otel.*eslestirmesi.*(?:eksik|dogrulanmadi)|hotel.*mapping|hotel-only otel kimligi|kimligi.*dogrulanmadi/.test(
      reason,
    )
  )
    return "hotel_mapping_missing";
  if (
    /api.*(?:eksik|tanimli degil)|mtls.*eksik|collector.*(?:eklenmedi|tanimli degil)|entegrasyon.*eksik|configuration.*missing/.test(
      reason,
    )
  )
    return "configuration_missing";
  if (
    /teklif bulunamadi|no availability|no inventory|sold out|musaitlik (?:yok|bulunamadi)|secilen tarih.*fiyat alinamadi/.test(
      reason,
    )
  )
    return "no_inventory";
  if (
    /oda.*(?:eslesmedi|eslesme|dogrulanamadi|aday bulunamadi)|room.*mapping|manuel oda eslesmesi/.test(
      reason,
    )
  )
    return "room_mapping_failed";

  return "invalid_response";
}

export function withBenchmarkErrorCode<T extends ProviderQuote>(quote: T): T {
  return {
    ...quote,
    errorCode: classifyBenchmarkErrorCode(quote),
  };
}

export function benchmarkStatusLabel(
  cell: Pick<
    BenchmarkCell,
    "status" | "dataMode" | "captureMethod" | "reason" | "errorCode"
  >,
): string {
  if (cell.captureMethod === "manual-browser") {
    return cell.status === "available"
      ? "Elle doğrulandı"
      : "Eski elle kontrol";
  }

  if (cell.status === "available") {
    return cell.dataMode === "mock"
      ? "Örnek fiyat"
      : "Canlı fiyat";
  }

  if (cell.errorCode) {
    return ERROR_LABELS[cell.errorCode];
  }

  if (cell.status === "sold_out") {
    return "Teklif bulunamadı";
  }

  return cell.status === "missing"
    ? "Fiyat alınamadı"
    : "Kontrol bekliyor";
}
