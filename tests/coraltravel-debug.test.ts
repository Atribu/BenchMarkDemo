import test from "node:test";
import assert from "node:assert/strict";
import { __coralTravelDebugInternal as coralTravel } from "../src/lib/ota/coraltravel-debug";

test("Coral Travel calendar labels use the German month and display format", () => {
  assert.equal(coralTravel.monthLabel("2026-11-20"), "November, 2026");
  assert.equal(coralTravel.monthLabel("2027-03-05"), "März, 2027");
  assert.equal(coralTravel.germanDate("2026-11-20"), "20.11.2026");
});

test("Coral Travel calendar rejects normalized or malformed dates", () => {
  for (const value of ["2026-02-30", "2026-13-01", "20.11.2026", ""])
    assert.throws(() => coralTravel.parseIsoDate(value));
});
