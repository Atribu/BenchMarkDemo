import type { BenchmarkCell } from "./types";

export function benchmarkStatusLabel(
  cell: Pick<BenchmarkCell, "status" | "dataMode" | "captureMethod" | "reason">,
) {
  if (cell.captureMethod === "manual-browser")
    return cell.status === "available"
      ? "Elle doğrulandı"
      : "Eski elle kontrol";
  if (cell.status === "available")
    return cell.dataMode === "mock" ? "Örnek fiyat" : "Canlı fiyat";
  if (cell.status === "sold_out") return "Teklif bulunamadı";

  const reason = (cell.reason ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
  if (/turkiye ana sayfasina|tr_redirected/.test(reason))
    return "Bölgesel erişim engeli";
  if (/api.*(?:eksik|tanimli degil)|mtls.*eksik/.test(reason))
    return "API ayarı eksik";
  if (/otel kodu|eslestirmesi eksik|kimligi.*dogrulanmadi/.test(reason))
    return "Otel eşleştirmesi eksik";
  if (
    /captcha|erisim dogrulamasi|site dogrulamasi|hiz siniri|http (403|429)/.test(
      reason,
    )
  )
    return "Site doğrulaması gerekli";
  if (/timeout|zaman asimi/.test(reason)) return "Sorgu zaman aşımı";
  if (/servisine ulasilamadi|fetch failed|econnrefused/.test(reason))
    return "Kaynağa erişilemedi";
  if (/oda.*(?:eslesmedi|dogrulanamadi)/.test(reason))
    return "Oda fiyatı eşleşmedi";
  return cell.status === "missing" ? "Fiyat alınamadı" : "Kontrol bekliyor";
}
