// import type { Page } from "playwright";

// export function pricePageAccessError(
//   pageUrl: string,
//   status: number | undefined,
//   body: string,
//   visibleChallenge: boolean,
// ): string | null {
//   const url = new URL(pageUrl);
//   if (
//     /(^|\.)booking\.com$/.test(url.hostname) &&
//     url.searchParams.get("tr_redirected") === "1"
//   ) {
//     return "Booking otel sayfasini Turkiye ana sayfasina yonlendirdi; bu bir doluluk sonucu degil. Dil/para birimi ayari cikis IP ulkesini degistirmez.";
//   }
//   if (
//     status === 403 ||
//     status === 429 ||
//     visibleChallenge ||
//     /human or a bot|bot or not|verify (?:that )?you are human|access denied|unusual traffic|security check/i.test(
//       body,
//     )
//   ) {
//     return "Site erisim dogrulamasi veya hiz siniri uyguladi; otomatik islem durduruldu. Bu bir doluluk sonucu degil.";
//   }
//   if (status && status >= 400) return `Fiyat sayfasi HTTP ${status} dondurdu.`;
//   return null;
// }

// export async function assertPricePageAccessible(page: Page, status?: number) {
//   const body = await page
//     .locator("body")
//     .innerText({ timeout: 3000 })
//     .catch(() => "");
//   let visibleChallenge = false;
//   for (const frame of await page
//     .locator(
//       'iframe[src*="captcha"], iframe[title="Verification system"], iframe[title="Device check"]',
//     )
//     .all()) {
//     if (await frame.isVisible()) visibleChallenge = true;
//   }
//   const reason = pricePageAccessError(
//     page.url(),
//     status,
//     body,
//     visibleChallenge,
//   );
//   if (reason) throw new Error(reason);
// }


type PricePageLike = {
  url(): string;

  locator(selector: string): {
    innerText(options?: { timeout?: number }): Promise<string>;

    all(): Promise<
      Array<{
        isVisible(): Promise<boolean>;
      }>
    >;
  };
};

export function pricePageAccessError(
  pageUrl: string,
  status: number | undefined,
  body: string,
  visibleChallenge: boolean,
): string | null {
  const url = new URL(pageUrl);

  if (
    /(^|\.)booking\.com$/.test(url.hostname) &&
    url.searchParams.get("tr_redirected") === "1"
  ) {
    return "Booking otel sayfasini Turkiye ana sayfasina yonlendirdi; bu bir doluluk sonucu degil. Dil/para birimi ayari cikis IP ulkesini degistirmez.";
  }

  if (
    status === 403 ||
    status === 429 ||
    visibleChallenge ||
    /human or a bot|bot or not|verify (?:that )?you are human|access denied|unusual traffic|security check/i.test(
      body,
    )
  ) {
    return "Site erisim dogrulamasi veya hiz siniri uyguladi; otomatik islem durduruldu. Bu bir doluluk sonucu degil.";
  }

  if (status && status >= 400) {
    return `Fiyat sayfasi HTTP ${status} dondurdu.`;
  }

  return null;
}

export async function assertPricePageAccessible(
  page: PricePageLike,
  status?: number,
) {
  const body = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");

  let visibleChallenge = false;

  for (const frame of await page
    .locator(
      'iframe[src*="captcha"], iframe[title="Verification system"], iframe[title="Device check"]',
    )
    .all()) {
    if (await frame.isVisible()) {
      visibleChallenge = true;
    }
  }

  const reason = pricePageAccessError(
    page.url(),
    status,
    body,
    visibleChallenge,
  );

  if (reason) {
    throw new Error(reason);
  }
}