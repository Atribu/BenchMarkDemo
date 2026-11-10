import test from "node:test";
import assert from "node:assert/strict";
import { getChannelMarketEligibility } from "../src/lib/hotels/channel-eligibility";

const turkey = { countryCode: "TR" };

test("currency-specific collectors expose supported markets", () => {
  assert.equal(getChannelMarketEligibility("check24", "EUR", turkey).eligible, true);
  assert.equal(getChannelMarketEligibility("check24", "GBP", turkey).eligible, false);
  assert.equal(getChannelMarketEligibility("onthebeach", "GBP", turkey).eligible, true);
  assert.equal(getChannelMarketEligibility("pegastour", "RUB", turkey).eligible, true);
  assert.equal(getChannelMarketEligibility("pegastour", "EUR", turkey).eligible, false);
});

test("a market is required before eligibility can be decided", () => {
  const result = getChannelMarketEligibility("tui", undefined, turkey);
  assert.equal(result.eligible, false);
  assert.equal(result.label, "Pazar seçin");
});

test("Turkey-only collectors reject hotels in another country", () => {
  const result = getChannelMarketEligibility("coraltravel", "EUR", {
    countryCode: "ES",
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /yalnızca TR/);
});
