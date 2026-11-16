import test from "node:test";
import assert from "node:assert/strict";
import { __coralTravelDebugInternal as coralTravel } from "../src/lib/ota/coraltravel-debug";
import {
  CORAL_HOTEL_ONLY_LABELS,
  hasCoralHotelOnlyLabel,
} from "../src/lib/ota/coraltravel-search";

test("Coral Travel supports both legacy and current hotel-only labels", () => {
  assert.deepEqual(CORAL_HOTEL_ONLY_LABELS, ["Nur Hotel", "Hotels"]);
  assert.equal(hasCoralHotelOnlyLabel("Pauschalreisen\nHotels\nReiseziel"), true);
  assert.equal(hasCoralHotelOnlyLabel("Pauschalreisen\nNur Hotel\nReiseziel"), true);
  assert.equal(hasCoralHotelOnlyLabel("Pauschalreisen\nHotelangebote"), false);
});

test("Coral Travel calendar labels use the German month and display format", () => {
  assert.equal(coralTravel.monthLabel("2026-11-20"), "November, 2026");
  assert.equal(coralTravel.monthLabel("2027-03-05"), "März, 2027");
  assert.equal(coralTravel.germanDate("2026-11-20"), "20.11.2026");
});

test("Coral Travel calendar rejects normalized or malformed dates", () => {
  for (const value of ["2026-02-30", "2026-13-01", "20.11.2026", ""])
    assert.throws(() => coralTravel.parseIsoDate(value));
});
