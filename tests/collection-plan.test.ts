import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectionPlan } from "../src/lib/benchmark/collection-plan";
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

test("EUR selection routes On the Beach to GBP for the same hotel and dates", () => {
  for (const id of ["beach-eu", "queen-eu"] as const) {
    const requested = { ...scope(id), windows: [window] };
    const plan = buildCollectionPlan(
      [requested],
      [provider("onthebeach")],
      REPORT_SCOPES,
    );
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0].scope.hotelKey, requested.hotelKey);
    assert.equal(plan.tasks[0].scope.currency, "GBP");
    assert.deepEqual(plan.tasks[0].scope.windows, [window]);
    assert.equal(plan.tasks[0].supported, true);
    assert.match(plan.warnings[0], /EUR.*GBP/);
  }
});

test("GBP selection retains EUR-only channels without changing currency labels", () => {
  const plan = buildCollectionPlan(
    [scope("queen-uk")],
    [provider("tui"), provider("holidaycheck")],
    REPORT_SCOPES,
  );
  assert.deepEqual(plan.providersByScope, {
    "queen-eu": ["tui", "holidaycheck"],
  });
  assert.ok(
    plan.tasks.every((task) => task.scope.currency === "EUR" && task.supported),
  );
});

test("every selected channel is represented once per hotel without duplicate columns in fallback scopes", () => {
  const plan = buildCollectionPlan(
    [scope("beach-eu"), scope("queen-eu")],
    OTA_PROVIDERS,
    REPORT_SCOPES,
  );
  assert.equal(plan.tasks.length, 14);
  for (const hotel of ["miramare-beach", "miramare-queen"]) {
    const keys = plan.tasks
      .filter((task) => task.scope.hotelKey === hotel)
      .map((task) => task.provider.key);
    assert.deepEqual(keys.sort(), OTA_PROVIDERS.map((item) => item.key).sort());
  }
  assert.deepEqual(plan.providersByScope["beach-uk"], ["onthebeach"]);
  assert.deepEqual(plan.providersByScope["queen-uk"], ["onthebeach"]);
  const report = buildBenchmarkResult({
    mode: "live",
    warnings: plan.warnings,
    scopes: plan.scopes,
    providers: OTA_PROVIDERS,
    quotes: [],
    providersByScope: plan.providersByScope,
  });
  assert.deepEqual(
    report.scopes
      .find((item) => item.id === "queen-uk")!
      .providers.map((item) => item.key),
    ["onthebeach"],
  );
});

test("explicit multiple markets deduplicate fallback jobs", () => {
  const plan = buildCollectionPlan(REPORT_SCOPES, OTA_PROVIDERS, REPORT_SCOPES);
  assert.equal(
    new Set(plan.tasks.map((task) => `${task.scope.id}:${task.provider.key}`))
      .size,
    plan.tasks.length,
  );
  assert.equal(
    plan.tasks.filter((task) => task.provider.key === "tui").length,
    2,
  );
});

test("missing hotel mapping stays visible and never falls back to a different hotel", () => {
  const unmapped = {
    ...provider("onthebeach"),
    supportedScopes: ["beach-uk"] as ScopeKey[],
  };
  const plan = buildCollectionPlan(
    [scope("queen-eu")],
    [unmapped],
    REPORT_SCOPES,
  );
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].supported, false);
  assert.equal(plan.tasks[0].scope.id, "queen-eu");
  assert.match(plan.tasks[0].reason!, /eşleştirmesi eksik/);
  assert.deepEqual(plan.providersByScope["queen-eu"], ["onthebeach"]);
});

test("Queen GBP scope never inherits EUR reference amounts", () => {
  assert.equal(scope("queen-uk").currency, "GBP");
  assert.ok(
    scope("queen-uk").rooms.every(
      (room) => Object.keys(room.referenceRates).length === 0,
    ),
  );
});

test("full benchmark flow keeps all seven channels for both hotels", async () => {
  const report = await runBenchmarkJob({
    mode: "mock",
    scopeKeys: ["beach-eu", "queen-eu"],
    providerKeys: OTA_PROVIDERS.map((item) => item.key),
    customWindow: { checkIn: window.checkIn, checkOut: window.checkOut },
  });
  assert.equal(report.summary.providerCount, 7);
  assert.equal(report.summary.expectedRateCount, 28);
  assert.equal(report.scopes.length, 4);
  for (const market of report.scopes) {
    assert.equal(market.windows[0].checkIn, window.checkIn);
    assert.equal(market.windows[0].checkOut, window.checkOut);
    assert.ok(
      market.windows[0].rows.every(
        (row) => row.entries.length === market.providers.length,
      ),
    );
    if (market.currency === "GBP")
      assert.deepEqual(
        market.providers.map((item) => item.key),
        ["onthebeach"],
      );
  }
});
