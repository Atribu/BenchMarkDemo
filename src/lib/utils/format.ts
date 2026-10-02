import type { CurrencyCode } from "@/src/lib/benchmark/types";

export function formatCurrency(
  value: number | null,
  currency: CurrencyCode,
): string {
  if (value === null) {
    return "--";
  }

  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  if (value === null) {
    return "--";
  }

  return new Intl.NumberFormat("tr-TR", {
    style: "percent",
    signDisplay: "always",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}
