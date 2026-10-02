import type {
  BenchmarkWindowDefinition,
  HotelPriceObservation,
  ProviderDescriptor,
  ReportScopeDefinition,
} from "../benchmark/types";
import {
  createBrowserPage,
  normalizeInlineText,
  parsePriceFromText,
  resolveProviderLiveConfig,
} from "./live-helpers";
import { assertPricePageAccessible } from "./browser-diagnostics";
import { GOOGLE_HOTEL_IDS } from "./google-hotel-config";
import {
  BOOKING_HOTEL_CONFIG,
  EXPEDIA_HOTEL_CONFIG,
  TUI_HOTEL_CONFIG,
} from "./live-config";

export interface GoogleHotelsSnapshot {
  url: string;
  hotelName: string;
  checkInLabel: string;
  checkOutLabel: string;
  adults: number;
  children: number;
  priceDisplay: string;
  offers: { provider: string; priceText: string; href: string }[];
}

const dateLabel = (date: string, full = false) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: full ? "long" : "short",
    month: full ? "long" : "short",
    day: "numeric",
    ...(full ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

function verifiedOfferUrl(
  href: string,
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
) {
  try {
    const click = new URL(href, "https://www.google.com");
    if (
      click.origin !== "https://www.google.com" ||
      !/^\/travel\/(?:lodging\/clk|clk)$/.test(click.pathname)
    )
      return false;
    const destination = new URL(click.searchParams.get("pcurl") ?? "");
    const q = destination.searchParams;
    if (destination.protocol !== "https:") return false;
    if (provider.key === "tui") {
      return (
        destination.hostname === "www.tui.com" &&
        destination.pathname.includes(
          `/hotel/${TUI_HOTEL_CONFIG[scope.hotelKey]?.giataId}/`,
        ) &&
        q.get("startDate") === window.checkIn &&
        q.get("endDate") === window.checkOut &&
        q.get("duration") === String(window.nights) &&
        q.get("travellers") === "2" &&
        q.get("searchScope") === "HOTEL"
      );
    }
    if (provider.key === "booking") {
      const property = (path: string) =>
        path.replace(/(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.html$/, "");
      return (
        /^(www\.)?booking\.com$/.test(destination.hostname) &&
        property(destination.pathname) ===
          property(
            new URL(BOOKING_HOTEL_CONFIG[scope.hotelKey]!.pageUrl).pathname,
          ) &&
        q.get("checkin") === window.checkIn &&
        q.get("checkout") === window.checkOut &&
        q.get("group_adults") === "2" &&
        q.get("group_children") === "0" &&
        q.get("no_rooms") === "1"
      );
    }
    if (provider.key === "expedia") {
      const hotelId =
        EXPEDIA_HOTEL_CONFIG[scope.hotelKey]!.pageUrl.match(/\.h(\d+)\./)?.[1];
      return (
        /^www\.expedia\.(com|de|co\.uk)$/.test(destination.hostname) &&
        !!hotelId &&
        destination.pathname.includes(`.h${hotelId}.`) &&
        q.get("chkin") === window.checkIn &&
        q.get("chkout") === window.checkOut &&
        q.get("rm1") === "a2"
      );
    }
    return false;
  } catch {
    return false;
  }
}

function matchesProvider(label: string, provider: ProviderDescriptor) {
  const names: Partial<Record<ProviderDescriptor["key"], RegExp>> = {
    booking: /^booking\.com$/i,
    expedia: /^expedia(?:\.(?:com|de|co\.uk))?$/i,
    tui: /^tui(?:\.com)?$/i,
  };
  return names[provider.key]?.test(label.trim()) ?? false;
}

export function parseGoogleHotelPrices(
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  providers: ProviderDescriptor[],
  snapshot: GoogleHotelsSnapshot,
): HotelPriceObservation[] {
  const url = new URL(snapshot.url);
  if (
    url.origin !== "https://www.google.com" ||
    !url.pathname.startsWith("/travel/") ||
    ![
      scope.hotelName.toLowerCase(),
      `${scope.hotelName.toLowerCase()} hotel`,
    ].includes(normalizeInlineText(snapshot.hotelName).toLowerCase()) ||
    snapshot.checkInLabel !== dateLabel(window.checkIn) ||
    snapshot.checkOutLabel !== dateLabel(window.checkOut) ||
    snapshot.adults !== 2 ||
    snapshot.children !== 0 ||
    snapshot.priceDisplay !== "Stay total"
  ) {
    throw new Error(
      "Google Hotels otel, tarih, kisi veya konaklama toplami dogrulanamadi.",
    );
  }
  return providers.flatMap((provider) => {
    const candidates = snapshot.offers
      .flatMap((offer) => {
        if (
          !matchesProvider(offer.provider, provider) ||
          !verifiedOfferUrl(offer.href, provider, scope, window)
        )
          return [];
        const text = normalizeInlineText(offer.priceText);
        // Reject mixed nightly/total or hidden amounts, even if the first is parseable.
        if (!/^(?:[€£]\s*[\d.,]+|[\d.,]+\s*(?:EUR|GBP))$/.test(text)) return [];
        const price = parsePriceFromText(text, scope.currency);
        return price !== null && price > 0
          ? [{ price, offerUrl: new URL(offer.href, snapshot.url).toString() }]
          : [];
      })
      .sort((a, b) => a.price - b.price);
    const best = candidates[0];
    return best
      ? [
          {
            scopeKey: scope.id,
            windowId: window.id,
            providerKey: provider.key,
            providerName: provider.name,
            price: best.price,
            currency: scope.currency,
            source: "google-hotels" as const,
            sourceUrl: snapshot.url,
            offerUrl: best.offerUrl,
            observedAt: new Date().toISOString(),
          },
        ]
      : [];
  });
}

export async function collectGoogleHotelPrices(
  scope: ReportScopeDefinition,
  providers: ProviderDescriptor[],
) {
  const hotelPrices: HotelPriceObservation[] = [];
  const warnings: string[] = [];
  for (const window of scope.windows) {
    let handle: Awaited<ReturnType<typeof createBrowserPage>> | undefined;
    let step = "Otel sayfasi";
    try {
      handle = await createBrowserPage({
        ...resolveProviderLiveConfig("google-hotels", scope.currency),
        useStealth: false,
        userAgent: undefined,
        market: "us",
      });
      const page = handle.page;
      page.setDefaultTimeout(8000);
      // Google's date dialog exposes Done inconsistently to ARIA locators.
      const done = page
        .locator("button")
        .filter({ hasText: /^Done$/, visible: true });
      const search = new URL(
        `https://www.google.com/travel/hotels/entity/${GOOGLE_HOTEL_IDS[scope.hotelKey]}`,
      );
      search.searchParams.set("hl", "en");
      const response = await page.goto(search.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await assertPricePageAccessible(page, response?.status());
      const reject = page.getByRole("button", {
        name: "Reject all",
        exact: true,
      });
      if (await reject.isVisible()) await reject.click();
      const hotelName = await page
        .getByRole("heading", {
          level: 1,
          name: new RegExp(`^${scope.hotelName}( Hotel)?$`, "i"),
        })
        .innerText();
      step = "Fiyatlar sekmesi";
      await page.getByRole("tab", { name: "Prices", exact: true }).click();
      const panel = page.locator('[role="tabpanel"][id="prices"]');
      step = "Takvim";
      await panel
        .getByRole("textbox", { name: "Check-in", exact: true })
        .click();
      for (const date of [window.checkIn, window.checkOut]) {
        step = `Takvim ${date}`;
        await page.locator(`[aria-label^="${dateLabel(date, true)}"]`).click();
      }
      step = "Tarihleri uygulama";
      await done.click();
      // Google replaces the panel after a debounced navigation on Done.
      await page.waitForTimeout(1200);
      await page.getByRole("tab", { name: "Prices", exact: true }).click();
      step = "Toplam fiyat ve para birimi";
      await panel.getByRole("button", { name: /^Price displayed/ }).click();
      await page.getByRole("radio", { name: /^Stay total/ }).click();
      await page
        .getByRole("radio", {
          name: scope.currency === "EUR" ? "Euro" : "British Pound",
          exact: true,
        })
        .first()
        .click();
      await done.click();
      await page.waitForTimeout(1200);
      await page.getByRole("tab", { name: "Prices", exact: true }).click();
      step = "Kisi sayisi";
      await panel.getByRole("button", { name: /^Number of travelers/ }).click();
      const party = async (label: string) =>
        page
          .getByRole("button", { name: label, exact: true })
          .evaluate((button) =>
            Number(
              button.parentElement?.parentElement?.querySelector(
                '[aria-live="polite"]',
              )?.textContent,
            ),
          );
      const adults = await party("Remove adult");
      const children = await party("Remove child");
      await done.click();
      // Wait for displayed offers to settle after changing dates/currency.
      step = "Teklifler";
      await panel
        .locator('a[data-is-organic="true"]')
        .first()
        .waitFor({ timeout: 20000 });
      await page.waitForTimeout(1500);
      const offers = [];
      for (const link of await panel
        .locator('a[data-is-organic="true"]')
        .all()) {
        if (!(await link.isVisible())) continue;
        offers.push({
          provider:
            (
              await link
                .getByRole("button", { name: /^Visit site for / })
                .getAttribute("aria-label")
            )?.replace(/^Visit site for /, "") ?? "",
          priceText:
            (await link.innerText())
              .split("\n")
              .map((line) => line.trim())
              .find((line) => /^[€£][\d.,]+$/.test(line)) ?? "",
          href: (await link.getAttribute("href")) ?? "",
        });
      }
      const snapshot: GoogleHotelsSnapshot = {
        url: page.url(),
        hotelName,
        checkInLabel: await panel
          .getByRole("textbox", { name: "Check-in", exact: true })
          .inputValue(),
        checkOutLabel: await panel
          .getByRole("textbox", { name: "Check-out", exact: true })
          .inputValue(),
        priceDisplay: await panel
          .getByRole("button", { name: /^Price displayed/ })
          .innerText(),
        adults,
        children,
        offers,
      };
      hotelPrices.push(
        ...parseGoogleHotelPrices(scope, window, providers, snapshot),
      );
      if (!hotelPrices.some((price) => price.windowId === window.id))
        warnings.push(
          `Google Hotels / ${scope.label} / ${window.checkIn}: Secilen OTA'lar icin tarih ve toplam fiyati dogrulanmis ek teklif bulunamadi.`,
        );
    } catch (error) {
      if (process.env.OTA_DEBUG === "true") {
        console.warn(
          `[Google Hotels / ${step}]`,
          error instanceof Error ? error.message : error,
        );
      }
      warnings.push(
        `Google Hotels / ${scope.label} / ${window.checkIn} / ${step}: ${error instanceof Error ? error.message.split("\n")[0] : "Ikinci kaynak okunamadi."}`,
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
  return { hotelPrices, warnings };
}
