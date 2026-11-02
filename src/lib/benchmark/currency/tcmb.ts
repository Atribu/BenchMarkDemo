
const TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

export type CurrencyConversion = {
  originalAmount: number;
  originalCurrency: "RUB";
  convertedAmount: number;
  convertedCurrency: "EUR";
  exchangeRate: number;
  rateDate: string;
  retrievedAt: string;
  rateType: "ForexSelling";
  rateSource: "TCMB";
};

function getRate(xml: string, code: string): number {
  const elements = xml.match(
    /<Currency\b[^>]*>[\s\S]*?<\/Currency>/g,
  ) ?? [];

  const element = elements.find((entry) =>
    new RegExp(`CurrencyCode=["']${code}["']`).test(entry),
  );

  if (!element) {
    throw new Error(`TCMB: ${code} kuru bulunamadı.`);
  }

  const value = element.match(
    /<ForexSelling>\s*([^<]+)\s*<\/ForexSelling>/,
  )?.[1];

  const unit = Number(
    element.match(/<Unit>\s*(\d+)\s*<\/Unit>/)?.[1] ?? "1",
  );

  const rate = Number(value?.trim().replace(",", "."));

  if (
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isFinite(unit) ||
    unit <= 0
  ) {
    throw new Error(`TCMB: ${code} kuru geçersiz.`);
  }

  return rate / unit;
}

export function parseRubEurRate(xml: string, retrievedAt = new Date().toISOString()) {
  const rubTry = getRate(xml, "RUB");
  const eurTry = getRate(xml, "EUR");
  const rateDate =
    xml.match(/<Tarih_Date\b[^>]*\bTarih=["']([^"']+)["']/)?.[1] ??
    xml.match(/<Tarih_Date\b[^>]*\bDate=["']([^"']+)["']/)?.[1];

  if (!rateDate) {
    throw new Error("TCMB kur tarihi bulunamadı.");
  }

  return {
    exchangeRate: rubTry / eurTry,
    rateDate,
    retrievedAt,
  };
}

export async function getRubEurRate() {
  const response = await fetch(TCMB_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`TCMB HTTP ${response.status}`);
  }

  const xml = await response.text();

  return parseRubEurRate(xml);
}

export function convertRubToEur(
  amount: number,
  rate: Awaited<ReturnType<typeof getRubEurRate>>,
): CurrencyConversion {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Geçersiz RUB fiyatı.");
  }

  return {
    originalAmount: amount,
    originalCurrency: "RUB",
    convertedAmount: Math.round(
      (amount * rate.exchangeRate + Number.EPSILON) * 100,
    ) / 100,
    convertedCurrency: "EUR",
    exchangeRate: rate.exchangeRate,
    rateDate: rate.rateDate,
    retrievedAt: rate.retrievedAt,
    rateType: "ForexSelling",
    rateSource: "TCMB",
  };
}
