import {
  parseBenchmarkRequest,
  todayInIstanbul,
} from "../src/lib/benchmark/request";
import type { BenchmarkRunResult } from "../src/lib/benchmark/types";

// Use the running application so the smoke test shares its environment and API
// validation. Arguments: check-in, check-out, provider CSV, scope CSV.
async function main() {
  const addDays = (date: string, days: number) =>
    new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000)
      .toISOString()
      .slice(0, 10);
  const [
    checkIn = addDays(todayInIstanbul(), 7),
    checkOut = addDays(checkIn, 5),
    providers = "tui,holidaycheck",
    scopes = "beach-eu,queen-eu",
  ] = process.argv.slice(2);
  const request = parseBenchmarkRequest({
    mode: "live",
    customWindow: { checkIn, checkOut },
    providerKeys: providers.split(","),
    scopeKeys: scopes.split(","),
  });
  const response = await fetch(
    new URL(
      "/api/benchmark/run",
      process.env.BENCHMARK_BASE_URL ?? "http://localhost:3000",
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(300000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Benchmark HTTP ${response.status}: ${await response.text()}`,
    );
  const result = (await response.json()) as BenchmarkRunResult;
  const entries = result.scopes.flatMap((scope) =>
    scope.windows.flatMap((window) =>
      window.rows.flatMap((room) => room.entries),
    ),
  );
  const automatedCount = entries.filter(
    (entry) =>
      entry.status === "available" && entry.captureMethod !== "manual-browser",
  ).length;
  const alternativeCount = result.scopes.reduce(
    (count, scope) =>
      count +
      scope.windows.reduce(
        (total, window) => total + (window.alternativeOffers?.length ?? 0),
        0,
      ),
    0,
  );
  console.log(
    JSON.stringify(
      {
        dates: request.customWindow,
        summary: result.summary,
        automatedCount,
        alternativeCount,
        secondaryOfferCount: result.secondaryOffers?.length ?? 0,
        manualCount: entries.filter(
          (entry) => entry.captureMethod === "manual-browser",
        ).length,
        warnings: result.warnings,
        hotelPrices: result.hotelPrices ?? [],
      },
      null,
      2,
    ),
  );
  console.table(
    result.scopes.flatMap((scope) =>
      scope.windows.flatMap((window) =>
        window.rows.flatMap((room) =>
          room.entries.map((entry) => ({
            hotel: scope.hotelName,
            room: room.roomName,
            channel: entry.providerName,
            price: entry.scrapedPrice,
            currency: scope.currency,
            status: entry.status,
            method: entry.captureMethod ?? "automated",
            observedAt: entry.observedAt ?? "",
            detail: entry.reason ?? entry.offerDescription ?? "",
          })),
        ),
      ),
    ),
  );
  console.table(
    result.scopes.flatMap((scope) =>
      scope.windows.flatMap((window) =>
        (window.alternativeOffers ?? []).slice(0, 6).map((offer) => ({
          hotel: scope.hotelName,
          channel: offer.providerKey,
          room: offer.roomName,
          price: offer.price,
          currency: offer.currency,
          board: offer.terms.board,
          reason: offer.matchReason,
        })),
      ),
    ),
  );
  console.table(
    (result.secondaryOffers ?? []).map((offer) => ({
      hotel: offer.hotelName,
      advertisedSeller: offer.advertisedProviderKey,
      source: offer.source,
      price: offer.price,
      currency: offer.currency,
      room: offer.roomName,
      board: offer.terms.board,
    })),
  );
  if (
    automatedCount === 0 &&
    alternativeCount === 0 &&
    !result.secondaryOffers?.length
  )
    process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
