import assert from "node:assert/strict";
import test from "node:test";
import {
  convertRubToEur,
  parseRubEurRate,
} from "../src/lib/benchmark/currency/tcmb";

const tcmbXml = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="02.11.2026" Date="11/02/2026">
  <Currency CurrencyCode="EUR">
    <Unit>1</Unit>
    <ForexSelling>50.0000</ForexSelling>
  </Currency>
  <Currency CurrencyCode="RUB">
    <Unit>10</Unit>
    <ForexSelling>4.5000</ForexSelling>
  </Currency>
</Tarih_Date>`;

test("TCMB XML satış kurundan RUB/EUR çapraz kurunu hesaplar", () => {
  const rate = parseRubEurRate(tcmbXml, "2026-11-02T12:00:00.000Z");

  assert.ok(Math.abs(rate.exchangeRate - 0.009) < Number.EPSILON);
  assert.equal(rate.rateDate, "02.11.2026");
  assert.equal(rate.retrievedAt, "2026-11-02T12:00:00.000Z");
});

test("RUB fiyatını EUR'a çevirirken kaynak tutarı ve kur izini korur", () => {
  const conversion = convertRubToEur(128_637.93, {
    exchangeRate: 0.009,
    rateDate: "02.11.2026",
    retrievedAt: "2026-11-02T12:00:00.000Z",
  });

  assert.deepEqual(conversion, {
    originalAmount: 128_637.93,
    originalCurrency: "RUB",
    convertedAmount: 1_157.74,
    convertedCurrency: "EUR",
    exchangeRate: 0.009,
    rateDate: "02.11.2026",
    retrievedAt: "2026-11-02T12:00:00.000Z",
    rateType: "ForexSelling",
    rateSource: "TCMB",
  });
});
