import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCollectionPlan,
  supportedProviderKeysForScopes,
} from "../src/lib/benchmark/collection-plan";
import { buildBenchmarkResult } from "../src/lib/benchmark/engine";
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import { runBenchmarkJob } from "../src/lib/ota/run-benchmark";
import type { OtaKey, ScopeKey } from "../src/lib/benchmark/types";

const scope = (id: ScopeKey) => REPORT_SCOPES.find((item) => item.id === id)!;
const provider = (key: OtaKey) =>
  OTA_PROVIDERS.find((item) => item.key === key)!;
const window = {
  id: "custom",
  label: "custom",
  checkIn: "2026-10-16",
  checkOut: "2026-10-21",
  nights: 5,
};

test("EUR selection never redirects On the Beach to another market", () => {
  for (const id of ["beach-eu", "queen-eu", "port-nature-eu"] as const) {
    const requested = { ...scope(id), windows: [window] };
    const plan = buildCollectionPlan(
      [requested],
      [provider("onthebeach")],
      REPORT_SCOPES,
    );
    assert.equal(plan.tasks.length, 0);
    assert.equal(plan.scopes.length, 0);
    assert.match(plan.warnings[0], /desteklemediği için seçime dahil edilmedi/);
  }
});

test("GBP selection keeps only channels that directly support that scope", () => {
  const plan = buildCollectionPlan(
    [scope("queen-uk")],
    [provider("tui"), provider("holidaycheck")],
    REPORT_SCOPES,
  );
  assert.deepEqual(plan.providersByScope, {
    "queen-uk": ["tui"],
  });
  assert.ok(plan.tasks.every((task) => task.supported));
  assert.equal(
    plan.tasks.find((task) => task.provider.key === "tui")!.scope.currency,
    "GBP",
  );
  assert.equal(
    plan.tasks.some((task) => task.provider.key === "holidaycheck"),
    false,
  );
});

test("each scope includes only its directly supported channel columns", () => {
  const plan = buildCollectionPlan(
    [scope("beach-eu"), scope("queen-eu")],
    OTA_PROVIDERS,
    REPORT_SCOPES,
  );
  for (const id of ["beach-eu", "queen-eu"] as const) {
    const keys = plan.tasks
      .filter((task) => task.scope.id === id)
      .map((task) => task.provider.key);
    assert.deepEqual(
      keys,
      supportedProviderKeysForScopes([id], OTA_PROVIDERS),
    );
  }
  const report = buildBenchmarkResult({
    mode: "live",
    warnings: plan.warnings,
    scopes: plan.scopes,
    providers: OTA_PROVIDERS,
    quotes: [],
    providersByScope: plan.providersByScope,
  });
  assert.deepEqual(
    report.scopes.map((item) => item.id),
    ["beach-eu", "queen-eu"],
  );
});

test("explicit multiple markets deduplicate direct jobs", () => {
  const plan = buildCollectionPlan(REPORT_SCOPES, OTA_PROVIDERS, REPORT_SCOPES);
  assert.equal(
    new Set(plan.tasks.map((task) => `${task.scope.id}:${task.provider.key}`))
      .size,
    plan.tasks.length,
  );
  assert.equal(
    plan.tasks.filter((task) => task.provider.key === "tui").length,
    3,
  );
  assert.equal(
    plan.tasks.find(
      (task) =>
        task.provider.key === "tui" && task.scope.hotelKey === "port-nature",
    )?.supported,
    undefined,
  );
});

test("missing hotel mapping is skipped and never falls back to a different market", () => {
  const unmapped = {
    ...provider("onthebeach"),
    supportedScopes: ["beach-uk"] as ScopeKey[],
  };
  const plan = buildCollectionPlan(
    [scope("queen-eu")],
    [unmapped],
    REPORT_SCOPES,
  );
  assert.equal(plan.tasks.length, 0);
  assert.equal(plan.scopes.length, 0);
  assert.deepEqual(plan.providersByScope, {});
  assert.match(plan.warnings[0], /desteklemediği için seçime dahil edilmedi/);
});

test("Queen GBP scope never inherits EUR reference amounts", () => {
  assert.equal(scope("queen-uk").currency, "GBP");
  assert.ok(
    scope("queen-uk").rooms.every(
      (room) => Object.keys(room.referenceRates).length === 0,
    ),
  );
});

test("full benchmark flow keeps only exact-market channels for both hotels", async () => {
  const report = await runBenchmarkJob({
    mode: "mock",
    scopeKeys: ["beach-eu", "queen-eu"],
    providerKeys: OTA_PROVIDERS.map((item) => item.key),
    customWindow: { checkIn: window.checkIn, checkOut: window.checkOut },
  });
  assert.equal(report.summary.providerCount, 12);
  assert.equal(report.summary.expectedRateCount, 64);
  assert.equal(report.scopes.length, 2);
  for (const market of report.scopes) {
    assert.equal(market.windows[0].checkIn, window.checkIn);
    assert.equal(market.windows[0].checkOut, window.checkOut);
    assert.ok(
      market.windows[0].rows.every(
        (row) => row.entries.length === market.providers.length,
      ),
    );
  }
  for (const market of report.scopes)
    assert.deepEqual(
      market.providers.map((item) => item.key),
      supportedProviderKeysForScopes([market.id], OTA_PROVIDERS),
    );
});

test("Port Nature Russia automatically resolves only Russian-capable channels", () => {
  assert.deepEqual(
    supportedProviderKeysForScopes(["port-nature-ru"], OTA_PROVIDERS),
    ["anextour", "pegastour", "coraltravel"],
  );
});
