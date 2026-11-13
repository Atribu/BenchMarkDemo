import ExcelJS from "exceljs";
import type {
  CurrencyCode,
  ProviderQuote,
} from "@/src/lib/benchmark/types";
import { benchmarkStatusLabel } from "@/src/lib/benchmark/status";

export interface BenchmarkXlsxEntry {
  providerName: string;
  price: number | null;
  status: ProviderQuote["status"];
  sourceHint: string;
  reason?: string;
}

export interface BenchmarkXlsxRoom {
  roomName: string;
  referencePrice: number;
  entries: BenchmarkXlsxEntry[];
}

export interface BenchmarkXlsxGroup {
  hotelName: string;
  marketLabel: string;
  currency: CurrencyCode;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: BenchmarkXlsxRoom[];
}

export interface BenchmarkXlsxPayload {
  runId: string;
  generatedAt: string;
  groups: BenchmarkXlsxGroup[];
}

const CURRENCIES = new Set<CurrencyCode>(["EUR", "GBP", "RUB"]);
const STATUSES = new Set<ProviderQuote["status"]>([
  "available",
  "missing",
  "sold_out",
  "manual-review",
]);

function text(value: unknown, label: string, maxLength = 300): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength)
    throw new Error(`${label} geçersiz.`);
  return value.trim();
}

function optionalText(value: unknown, maxLength = 500): string | undefined {
  if (value === undefined || value === null) return undefined;
  // Provider diagnostics are informative only. Unexpected runtime values must
  // never prevent the user from exporting otherwise valid prices.
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value.trim() || undefined;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`${label} geçersiz.`);
  return value;
}

function sourceUrl(value: string): string | null {
  const match = value.match(/https:\/\/[^\s|]+/);
  if (!match || match[0].length > 2048 || /[{}]/.test(match[0])) return null;
  try {
    const url = new URL(match[0]);
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseBenchmarkXlsxPayload(value: unknown): BenchmarkXlsxPayload {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Geçerli bir Excel raporu gönderin.");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.groups) || input.groups.length < 1 || input.groups.length > 50)
    throw new Error("Excel raporu için geçerli otel grupları gönderin.");

  let roomCount = 0;
  let entryCount = 0;
  const groups = input.groups.map((rawGroup) => {
    if (!rawGroup || typeof rawGroup !== "object" || Array.isArray(rawGroup))
      throw new Error("Excel otel grubu geçersiz.");
    const group = rawGroup as Record<string, unknown>;
    if (!CURRENCIES.has(group.currency as CurrencyCode))
      throw new Error("Excel para birimi geçersiz.");
    if (
      typeof group.checkIn !== "string" ||
      typeof group.checkOut !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(group.checkIn) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(group.checkOut)
    )
      throw new Error("Excel tarih aralığı geçersiz.");
    if (!Array.isArray(group.rooms) || group.rooms.length < 1)
      throw new Error("Excel oda listesi boş olamaz.");
    roomCount += group.rooms.length;
    if (roomCount > 500) throw new Error("Excel oda sınırı aşıldı.");

    const rooms = group.rooms.map((rawRoom) => {
      if (!rawRoom || typeof rawRoom !== "object" || Array.isArray(rawRoom))
        throw new Error("Excel oda kaydı geçersiz.");
      const room = rawRoom as Record<string, unknown>;
      if (!Array.isArray(room.entries) || room.entries.length > 100)
        throw new Error("Excel kanal listesi geçersiz.");
      entryCount += room.entries.length;
      if (entryCount > 5000) throw new Error("Excel kanal satırı sınırı aşıldı.");
      const entries = room.entries.map((rawEntry) => {
        if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry))
          throw new Error("Excel kanal kaydı geçersiz.");
        const entry = rawEntry as Record<string, unknown>;
        if (!STATUSES.has(entry.status as ProviderQuote["status"]))
          throw new Error("Excel kanal durumu geçersiz.");
        const price =
          entry.price === null ? null : positiveNumber(entry.price, "OTA fiyatı");
        return {
          providerName: text(entry.providerName, "OTA adı", 120),
          price,
          status: entry.status as ProviderQuote["status"],
          sourceHint:
            typeof entry.sourceHint === "string" && entry.sourceHint.length <= 4096
              ? entry.sourceHint
              : "",
          reason: optionalText(entry.reason),
        };
      });
      return {
        roomName: text(room.roomName, "Oda adı", 180),
        referencePrice: positiveNumber(room.referencePrice, "Referans fiyat"),
        entries,
      };
    });

    const nights = positiveNumber(group.nights, "Gece sayısı");
    if (!Number.isInteger(nights) || nights > 60)
      throw new Error("Gece sayısı geçersiz.");
    return {
      hotelName: text(group.hotelName, "Otel adı", 180),
      marketLabel: text(group.marketLabel, "Pazar adı", 120),
      currency: group.currency as CurrencyCode,
      checkIn: group.checkIn,
      checkOut: group.checkOut,
      nights,
      rooms,
    };
  });

  return {
    runId: text(input.runId, "Rapor kimliği", 120),
    generatedAt: text(input.generatedAt, "Rapor zamanı", 80),
    groups,
  };
}

function dateLabel(checkIn: string, checkOut: string): string {
  const format = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${format.format(new Date(`${checkIn}T00:00:00Z`))} – ${format.format(
    new Date(`${checkOut}T00:00:00Z`),
  )}`.toLocaleUpperCase("tr-TR");
}

function currencyFormat(currency: CurrencyCode): string {
  if (currency === "GBP") return '"£"#,##0.00;[Red]-"£"#,##0.00';
  if (currency === "RUB") return '"₽"#,##0.00;[Red]-"₽"#,##0.00';
  return '"€"#,##0.00;[Red]-"€"#,##0.00';
}

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF7A7A7A" } },
  left: { style: "thin", color: { argb: "FF7A7A7A" } },
  bottom: { style: "thin", color: { argb: "FF7A7A7A" } },
  right: { style: "thin", color: { argb: "FF7A7A7A" } },
};

function styleTableRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = BORDER;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

export function buildBenchmarkXlsxWorkbook(payload: BenchmarkXlsxPayload) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DGTLFACE Hotel Benchmark";
  workbook.created = new Date(payload.generatedAt);
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet("Fiyat Karşılaştırma", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: {
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    },
  });
  sheet.columns = [
    { key: "channel", width: 38 },
    { key: "price", width: 18 },
    { key: "difference", width: 14 },
  ];

  let currentRow = 1;
  for (const group of payload.groups) {
    sheet.mergeCells(currentRow, 1, currentRow, 3);
    const hotelCell = sheet.getCell(currentRow, 1);
    hotelCell.value = group.hotelName;
    hotelCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
    hotelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4D86E6" } };
    hotelCell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(currentRow).height = 25;
    currentRow++;

    sheet.mergeCells(currentRow, 1, currentRow, 3);
    const periodCell = sheet.getCell(currentRow, 1);
    periodCell.value = `${dateLabel(group.checkIn, group.checkOut)} · ${group.nights} GECE · ${group.marketLabel} / ${group.currency}`;
    periodCell.font = { bold: true, size: 11 };
    periodCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCEAD7" } };
    periodCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    styleTableRow(sheet.getRow(currentRow));
    currentRow++;

    for (const room of group.rooms) {
      const header = sheet.getRow(currentRow);
      header.values = [room.roomName, "Fiyat", "Fark"];
      header.font = { bold: true };
      header.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4B183" } };
      header.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      header.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      styleTableRow(header);
      currentRow++;

      const referenceRowNumber = currentRow;
      const reference = sheet.getRow(referenceRowNumber);
      reference.values = ["Otel satış fiyatı", room.referencePrice, 0];
      reference.getCell(2).numFmt = currencyFormat(group.currency);
      reference.getCell(3).numFmt = "0.00%";
      reference.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
      reference.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      styleTableRow(reference);
      currentRow++;

      const firstEntryRow = currentRow;
      for (const entry of room.entries) {
        const row = sheet.getRow(currentRow);
        const url = sourceUrl(entry.sourceHint);

       row.getCell(1).value = url
  ? {
      text: entry.providerName,
      hyperlink: url,
    }
  : entry.providerName;

if (url) {
  row.getCell(1).font = {
    color: { argb: "FF0563C1" },
    underline: true,
  };
}
          
        if (entry.status === "available" && entry.price !== null) {
          const difference = (entry.price - room.referencePrice) / room.referencePrice;
          row.getCell(2).value = entry.price;
          row.getCell(2).numFmt = currencyFormat(group.currency);
          row.getCell(3).value = {
            formula: `(B${currentRow}-B${referenceRowNumber})/B${referenceRowNumber}`,
            result: difference,
          };
          row.getCell(3).numFmt = "0.00%";
          row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
          row.getCell(3).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb:
                difference < 0
                  ? "FFF4CCCC"
                  : difference === 0
                    ? "FFFFF2CC"
                    : "FFD9EAD3",
            },
          };
        } else {
          row.getCell(2).value =
            entry.reason ||
            benchmarkStatusLabel({
              status: entry.status,
              dataMode: "live",
              reason: entry.reason,
            });
          row.getCell(2).font = { color: { argb: "FF6F6878" }, italic: true };
          row.getCell(3).value = "—";
          row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
          row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
        }
        styleTableRow(row);
        currentRow++;
      }
      if (currentRow > firstEntryRow) {
        sheet.addConditionalFormatting({
          ref: `C${firstEntryRow}:C${currentRow - 1}`,
          rules: [
            {
              type: "cellIs",
              priority: 1,
              operator: "lessThan",
              formulae: [0],
              style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } } },
            },
            {
              type: "cellIs",
              priority: 2,
              operator: "greaterThan",
              formulae: [0],
              style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } } },
            },
          ],
        });
      }
      currentRow++;
    }
    currentRow++;
  }

  sheet.mergeCells(currentRow, 1, currentRow, 3);
  const note = sheet.getCell(currentRow, 1);
  note.value =
    "Fark = (OTA fiyatı - otel satış fiyatı) / otel satış fiyatı. Oda eşleşmesi aynı tarife anlamına gelmez; pansiyon, iptal, vergi ve para birimi koşullarını ayrıca kontrol edin.";
  note.font = { italic: true, color: { argb: "FF6F6878" }, size: 9 };
  note.alignment = { wrapText: true, vertical: "top" };
  sheet.getRow(currentRow).height = 34;
  sheet.autoFilter = undefined;
  return workbook;
}

export async function benchmarkXlsx(payload: BenchmarkXlsxPayload) {
  return buildBenchmarkXlsxWorkbook(payload).xlsx.writeBuffer();
}
