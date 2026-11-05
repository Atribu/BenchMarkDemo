import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHotelStatusTransition,
  canTransitionHotelStatus,
  HOTEL_LIFECYCLE_LABELS,
  HOTEL_LIFECYCLE_STATUSES,
  isHotelAvailableForBenchmark,
  isHotelLifecycleStatus,
} from "../src/lib/hotels/lifecycle";

test("hotel lifecycle exposes the four product states", () => {
  assert.deepEqual(HOTEL_LIFECYCLE_STATUSES, [
    "draft",
    "ready",
    "active",
    "archived",
  ]);
  assert.equal(HOTEL_LIFECYCLE_LABELS.draft, "Taslak");
  assert.equal(HOTEL_LIFECYCLE_LABELS.active, "Aktif");
});

test("hotel lifecycle accepts only controlled forward and rollback transitions", () => {
  const allowed = [
    ["draft", "ready"],
    ["draft", "archived"],
    ["ready", "draft"],
    ["ready", "active"],
    ["ready", "archived"],
    ["active", "ready"],
    ["active", "archived"],
    ["archived", "draft"],
  ] as const;

  for (const [current, next] of allowed) {
    assert.equal(canTransitionHotelStatus(current, next), true);
    assert.doesNotThrow(() => assertHotelStatusTransition(current, next));
  }
});

test("hotel lifecycle prevents unsafe activation and restoration", () => {
  assert.equal(canTransitionHotelStatus("draft", "active"), false);
  assert.equal(canTransitionHotelStatus("archived", "active"), false);
  assert.equal(canTransitionHotelStatus("active", "draft"), false);
  assert.equal(canTransitionHotelStatus("ready", "ready"), false);

  assert.throws(
    () => assertHotelStatusTransition("archived", "active"),
    /Arşivlenmiş durumundan Aktif durumuna geçirilemez/,
  );
});

test("only active hotels are available to benchmark queries", () => {
  assert.equal(isHotelAvailableForBenchmark("draft"), false);
  assert.equal(isHotelAvailableForBenchmark("ready"), false);
  assert.equal(isHotelAvailableForBenchmark("active"), true);
  assert.equal(isHotelAvailableForBenchmark("archived"), false);
});

test("hotel lifecycle validates values received at runtime", () => {
  assert.equal(isHotelLifecycleStatus("draft"), true);
  assert.equal(isHotelLifecycleStatus("active"), true);
  assert.equal(isHotelLifecycleStatus("deleted"), false);
  assert.equal(isHotelLifecycleStatus(null), false);
});
