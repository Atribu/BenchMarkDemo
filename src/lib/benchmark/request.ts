import { REPORT_SCOPES } from "./sample-data";
import type { BenchmarkRequest } from "./types";
import { OTA_PROVIDERS } from "../ota/registry";

export function todayInIstanbul(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function nightCount(checkIn: string, checkOut: string): number | null {
  const dates = [checkIn, checkOut];
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) return null;
  const timestamps = dates.map((date) => Date.parse(`${date}T00:00:00Z`));
  if (
    timestamps.some(
      (time, i) =>
        !Number.isFinite(time) ||
        new Date(time).toISOString().slice(0, 10) !== dates[i],
    )
  )
    return null;
  const nights = (timestamps[1] - timestamps[0]) / 86400000;
  return nights > 0 && nights <= 60 ? nights : null;
}

export function parseBenchmarkRequest(
  value: unknown,
  today = todayInIstanbul(),
): BenchmarkRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Geçerli bir sorgu gönderin.");
  const input = value as Record<string, unknown>;
  if (input.mode !== "live" && input.mode !== "mock")
    throw new Error("Sorgu türü canlı veya demo olmalı.");
  const validKeys = (keys: unknown, allowed: string[]): keys is string[] =>
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.length <= allowed.length &&
    keys.every((key) => typeof key === "string" && allowed.includes(key));
  if (
    !validKeys(
      input.providerKeys,
      OTA_PROVIDERS.map((provider) => provider.key),
    )
  )
    throw new Error("En az bir geçerli OTA seçin.");
  if (
    !validKeys(
      input.scopeKeys,
      REPORT_SCOPES.map((scope) => scope.id),
    )
  )
    throw new Error("En az bir geçerli otel ve pazar seçin.");
  const window = input.customWindow as Record<string, unknown> | undefined;
  if (
    !window ||
    typeof window.checkIn !== "string" ||
    typeof window.checkOut !== "string" ||
    !nightCount(window.checkIn, window.checkOut)
  ) {
    throw new Error(
      "Giriş ve çıkış tarihleri geçerli olmalı; konaklama 1–60 gece olabilir.",
    );
  }
  if (input.mode === "live" && window.checkIn < today)
    throw new Error("Canlı sorgu için geçmiş bir giriş tarihi seçilemez.");
  const request = {
    mode: input.mode,
    providerKeys: [...new Set(input.providerKeys)],
    scopeKeys: [...new Set(input.scopeKeys)],
    customWindow: { checkIn: window.checkIn, checkOut: window.checkOut },
  } as BenchmarkRequest;
  // The collection planner resolves an OTA's native market or returns an
  // explicit mapping error. Do not reject valid hotel/OTA selections here.
  return request;
}
