import assert from "node:assert/strict";
import test from "node:test";

import { buildPortfolios } from "@/src/components/benchmark-dashboard";
import { REPORT_SCOPES } from "@/src/lib/benchmark/sample-data";

test("default Miramare Europe selection has an accurate portfolio label", () => {
  const portfolio = buildPortfolios(REPORT_SCOPES).find(
    (option) => option.value === "miramare-eu",
  );

  assert.deepEqual(portfolio, {
    value: "miramare-eu",
    label: "Miramare Beach + Miramare Queen · Avrupa",
    scopes: ["beach-eu", "queen-eu"],
  });
});

test("four-hotel portfolio options still include all four hotels", () => {
  const portfolios = buildPortfolios(REPORT_SCOPES);

  assert.equal(
    portfolios.find((option) => option.value === "all")?.scopes.length,
    10,
  );
  assert.equal(
    portfolios.find((option) => option.value === "all-eur")?.scopes.length,
    4,
  );
});
