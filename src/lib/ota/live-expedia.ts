import type {
  BenchmarkWindowDefinition,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "../benchmark/types";
import type { Page } from "patchright";
import { EXPEDIA_HOTEL_CONFIG } from "./live-config";
import {
  normalizeInlineText,
  parsePriceFromText,
} from "./live-helpers";
import { namedRoomRank } from "./live-onthebeach";
import { assertPricePageAccessible } from "./browser-diagnostics";
import { createPatchrightBrowserPage } from "./patchright-browser";

export interface ExpediaRoomCard {
  name: string;
  text: string;
  priceText: string;
}
export interface ExpediaSnapshot {
  url: string;
  hotelName: string;
  travellers: string;
  startLabel: string;
  endLabel: string;
  currencyLabel: string;
  cards: ExpediaRoomCard[];
}

async function detectExpediaBotChallenge(
  page: Page,
): Promise<boolean> {
  const title = await page.title().catch(() => "");

  const body = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");

  return (
    /bot or not/i.test(title) ||
    /human or a bot/i.test(body) ||
    /verify.*human/i.test(body) ||
    /captcha/i.test(body) ||
    /are you a human/i.test(body) ||
    /security check/i.test(body)
  );
}

async function assertNoExpediaBotChallenge(
  page: Page,
): Promise<void> {
  if (await detectExpediaBotChallenge(page)) {
    throw new Error("EXPEDIA_BOT_CHALLENGE");
  }

  await page.waitForTimeout(2000);

  if (await detectExpediaBotChallenge(page)) {
    throw new Error("EXPEDIA_BOT_CHALLENGE");
  }
}

export function buildExpediaUrl(
  baseUrl: string,
  scope: ReportScopeDefinition,
  checkIn: string,
  checkOut: string,
) {
  const url = new URL(baseUrl);
  
if (scope.currency === "EUR") {
  url.hostname = "euro.expedia.net";
  url.pathname = `/${url.pathname
    .replace(/^\/en\//, "")
    .replace(/^\//, "")}`;
} else {
  url.hostname = "www.expedia.co.uk";
  url.pathname = `/en/${url.pathname
    .replace(/^\/en\//, "")
    .replace(/^\//, "")}`;
}
  url.search = new URLSearchParams({
    chkin: checkIn,
    chkout: checkOut,
    adults: "2",
    rm1: "a2",
    currency: scope.currency,
    locale: "en_GB",
    siteid: scope.currency === "EUR" ? "6" : "3",
    x_pwa: "1",
  }).toString();
  return url.toString();
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function parseExpediaQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  snapshot: ExpediaSnapshot,
): ProviderQuote[] {
  const requested = new URL(EXPEDIA_HOTEL_CONFIG[scope.hotelKey]!.pageUrl);
  const actual = new URL(snapshot.url);
  const hotelId = requested.pathname.match(/\.h(\d+)\./)?.[1];

  const expectedHost =
    scope.currency === "EUR"
      ? "euro.expedia.net"
      : "www.expedia.co.uk";

  const expectedStart =
    `Start date, ${dateLabel(window.checkIn)}`;

  const expectedEnd =
    `End date, ${dateLabel(window.checkOut)}`;

  const validationErrors: string[] = [];

  if (!hotelId) {
    validationErrors.push("hotelId missing");
  }

  if (actual.protocol !== "https:") {
    validationErrors.push(
      `protocol=${actual.protocol}`,
    );
  }

  if (
    hotelId &&
    !actual.pathname.includes(`.h${hotelId}.`)
  ) {
    validationErrors.push(
      `hotelId mismatch: expected=${hotelId}`,
    );
  }

  if (actual.hostname !== expectedHost) {
    validationErrors.push(
      `hostname: expected=${expectedHost}, actual=${actual.hostname}`,
    );
  }

  if (
    actual.searchParams.get("chkin") !== window.checkIn
  ) {
    validationErrors.push(
      `checkIn: expected=${window.checkIn}, actual=${actual.searchParams.get(
        "chkin",
      )}`,
    );
  }

  if (
    actual.searchParams.get("chkout") !==
    window.checkOut
  ) {
    validationErrors.push(
      `checkOut: expected=${window.checkOut}, actual=${actual.searchParams.get(
        "chkout",
      )}`,
    );
  }

  if (
    !normalizeInlineText(snapshot.hotelName)
      .toLowerCase()
      .startsWith(scope.hotelName.toLowerCase())
  ) {
    validationErrors.push(
      `hotelName: expected=${scope.hotelName}, actual=${snapshot.hotelName}`,
    );
  }

  if (
    !/^(?:Travellers,\s*)?2 travellers,\s*1 room$/i.test(
      normalizeInlineText(snapshot.travellers),
    )
  ) {
    validationErrors.push(
      `travellers=${JSON.stringify(
        snapshot.travellers,
      )}`,
    );
  }

  if (
    normalizeInlineText(snapshot.startLabel) !==
    expectedStart
  ) {
    validationErrors.push(
      `startLabel: expected=${expectedStart}, actual=${snapshot.startLabel}`,
    );
  }

  if (
    normalizeInlineText(snapshot.endLabel) !==
    expectedEnd
  ) {
    validationErrors.push(
      `endLabel: expected=${expectedEnd}, actual=${snapshot.endLabel}`,
    );
  }

  if (
    !snapshot.currencyLabel.startsWith(
      scope.currency,
    )
  ) {
    validationErrors.push(
      `currency: expected=${scope.currency}, actual=${snapshot.currencyLabel}`,
    );
  }

  if (validationErrors.length > 0) {
    throw new Error(
      `Expedia validation failed: ${validationErrors.join(
        " | ",
      )}`,
    );
  }


  return scope.rooms.map((room) => {
    console.log("[Expedia] Room matching:", {
  expectedRoomId: room.id,
  availableCardNames: snapshot.cards.map((card) => card.name),
});

    const matched = snapshot.cards.flatMap((card) => {
      const rank = namedRoomRank(room.id, card.name);
      return rank !== null ? [{ ...card, rank }] : [];
    });

    console.log("[Expedia] Matched cards:", {
  roomId: room.id,
  matched: matched.map((card) => ({
    name: card.name,
    rank: card.rank,
  })),
});

    const available = matched
      .flatMap((card) => {
        const current = card.priceText.match(
          /The current price is\s*([€£][\d.,]+)/i,
        )?.[1];
        
        const nightsMatch = new RegExp(
      `for ${window.nights} nights?, 1 room`,
      "i",
    ).test(card.priceText);

    
       const price =
      current && nightsMatch
        ? parsePriceFromText(current, scope.currency)
        : null;

    console.log("[Expedia] Price parsing:", {
      roomId: room.id,
      cardName: card.name,
      priceText: card.priceText,
      current,
      nightsMatch,
      parsedPrice: price,
    });

    return price !== null
      ? [{ ...card, price }]
      : [];
  })
  .sort(
    (a, b) =>
      a.rank - b.rank ||
      a.price - b.price,
  );

    const best = available[0];
    const soldOut =
      matched.length > 0 &&
      matched.every((card) => /We are sold out/i.test(card.text));

      console.log("[Expedia] Final room result:", {
  roomId: room.id,
  matchedCount: matched.length,
  availableCount: available.length,
  best: best
    ? {
        name: best.name,
        price: best.price,
        rank: best.rank,
      }
    : null,
  soldOut,
});


    return {
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId: room.id,
      windowId: window.id,
      price: best?.price ?? null,
      currency: scope.currency,
      status: best ? "available" : soldOut ? "sold_out" : "manual-review",
      dataMode: "live",
      captureMethod: "automated",
      observedAt: new Date().toISOString(),
      sourceHint: snapshot.url,
      offerDescription: best?.name,
      offerConditions: best
        ? [
            /All-inclusive/i.test(best.text) ? "All-inclusive" : null,
            /Non-refundable/.test(best.text)
              ? "Kartın varsayılan iptal seçeneğini kaynakta kontrol edin"
              : null,
            /includes taxes & fees/.test(best.priceText)
              ? "Vergiler ve ücretler dahil"
              : "Vergi ayrıntısı doğrulanmadı",
            `${window.nights} gece, 1 oda, 2 yetişkin; ekranda gösterilen toplam`,
          ]
            .filter(Boolean)
            .join("; ")
        : undefined,
      reason: best
        ? undefined
        : soldOut
          ? "Expedia bu oda için seçilen tarihte teklif olmadığını gösterdi."
          : "Oda veya konaklama toplamı doğrulanamadı.",
    };
  });
}

export async function collectExpediaLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const warnings: string[] = [];
  for (const window of scope.windows) {

    let handle: Awaited<ReturnType<typeof createPatchrightBrowserPage>> | undefined;
    
    const base = EXPEDIA_HOTEL_CONFIG[scope.hotelKey]?.pageUrl;

    const sourceHint = base
      ? buildExpediaUrl(base, scope, window.checkIn, window.checkOut)
      : "";
    try {
      if (!sourceHint) throw new Error("Expedia otel eşleştirmesi eksik.");




console.log("\n========== EXPEDIA DEBUG START ==========");


handle = await createPatchrightBrowserPage();

const page = handle.page;

page.setDefaultTimeout(15000);


const response = await page.goto(sourceHint, {
  waitUntil: "domcontentloaded",
  timeout: 45000,
});

console.log("[Expedia] HTTP status:", response?.status());
console.log("[Expedia] Final URL:", page.url());

console.log(
  "[Expedia] Page title:",
  await page.title().catch(() => ""),
);

await assertNoExpediaBotChallenge(page);

await assertPricePageAccessible(
  page,
  response?.status(),
);


const browserInfo = await page
  .evaluate(() => ({
    language: navigator.language,
    languages: navigator.languages,
    userAgent: navigator.userAgent,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }))
  .catch(() => null);

console.log("[Expedia] Browser info:", browserInfo);

const bodyText = await page
  .locator("body")
  .innerText({ timeout: 3000 })
  .catch(() => "");

console.log(
  "[Expedia] Body preview:",
  bodyText.slice(0, 1800),
);

const frames = page.frames().map((frame) => ({
  url: frame.url(),
  name: frame.name(),
}));

console.log("[Expedia] Frames:", frames);

await page
  .locator(
    '[data-stid="section-room-list"] [data-stid^="property-offer-"]',
  )
  .first()
  .waitFor({
    timeout: 30000,
  });

// Sayfa yüklenirken challenge sonradan çıkmış olabilir
await assertNoExpediaBotChallenge(page);

console.log("[Expedia] Access check: OK");
console.log(
  "========== EXPEDIA DEBUG END ==========\n",
);

const roomCards = page.locator(
  '[data-stid="section-room-list"] [data-stid^="property-offer-"]',
);

let previousCount = 0;

for (let attempt = 0; attempt < 6; attempt += 1) {
  const count = await roomCards.count();

  console.log("[Expedia] Room card load:", {
    attempt,
    count,
  });

  if (count > 0) {
    await roomCards
      .nth(count - 1)
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
  }

  await page.waitForTimeout(1000);

  const nextCount = await roomCards.count();

  if (nextCount === count && nextCount === previousCount) {
    break;
  }

  previousCount = count;
}

console.log(
  "[Expedia] Final room card count:",
  await roomCards.count(),
);

const snapshot = await page.evaluate(() => ({

        url: location.href,
        hotelName: document.querySelector("h1")?.textContent ?? "",
        travellers:
          Array.from(document.querySelectorAll("button"))
            .map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "")
           .find((text) =>
  /(?:Travellers,\s*)?2 travellers,\s*1 room/i.test(text),
) ?? "",
        startLabel:
          Array.from(document.querySelectorAll("button"))
            .map((el) => el.getAttribute("aria-label") ?? "")
            .find((text) => /^Start date,/.test(text)) ?? "",
        endLabel:
          Array.from(document.querySelectorAll("button"))
            .map((el) => el.getAttribute("aria-label") ?? "")
            .find((text) => /^End date,/.test(text)) ?? "",
        currencyLabel:
          Array.from(document.querySelectorAll("header button"))
            .map(
              (el) =>
                el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
            )
            .find((text) => /^(EUR|GBP)/.test(text)) ?? "",

            
        cards: Array.from(
          document.querySelectorAll(
            '[data-stid="section-room-list"] [data-stid^="property-offer-"]',
          ),
        ).map((card) => ({
          
        name: (() => {
  const photoLabel = Array.from(
    card.querySelectorAll("[aria-label]"),
  )
    .map((el) => el.getAttribute("aria-label")?.trim() ?? "")
    .find((text) =>
      /^View all photos for /i.test(text),
    );

  if (photoLabel) {
    return photoLabel.replace(
      /^View all photos for /i,
      "",
    );
  }

  return (
    Array.from(card.querySelectorAll("h3"))
      .map((el) => el.textContent?.trim() ?? "")
      .find(
        (text) =>
          !/^(View all photos|Frequently booked|Upgrade your stay|Great for two|Our lowest price)$/i.test(
            text,
          ),
      ) ?? ""
  );
})(),

          text: (card as HTMLElement).innerText,
         priceText:
  (card.querySelector('[role="status"]') as HTMLElement | null)
    ?.innerText?.trim() ||
  (card as HTMLElement).innerText,
        })),
      }));

      console.log("[Expedia] Snapshot validation:", {
  expected: {
    hotelName: scope.hotelName,
    checkIn: window.checkIn,
    checkOut: window.checkOut,
    currency: scope.currency,
  },

  actual: {
    url: snapshot.url,
    hotelName: snapshot.hotelName,
    travellers: snapshot.travellers,
    startLabel: snapshot.startLabel,
    endLabel: snapshot.endLabel,
    currencyLabel: snapshot.currencyLabel,
    cardCount: snapshot.cards.length,
  },
});

      quotes.push(...parseExpediaQuotes(provider, scope, window, snapshot));
    } catch (error) {
      console.error(
  "[Expedia] Collection FAILED:",
  error instanceof Error
    ? {
        name: error.name,
        message: error.message,
      }
    : error,
);

      const body =
        (await handle?.page
          .locator("body")
          .innerText({ timeout: 2000 })
          .catch(() => "")) ?? "";
     const blocked =
  (error instanceof Error &&
    error.message === "EXPEDIA_BOT_CHALLENGE") ||
  /human or a bot|bot or not|verify.*human|captcha|are you a human|security check/i.test(
    body,
  );
      const reason = blocked
        ? "Expedia erişim doğrulaması istedi; otomatik oda fiyatı alınamadı."
        : "Expedia oda fiyatı veya arama koşulları doğrulanamadı.";
      warnings.push(
        `Expedia / ${scope.hotelName} / ${window.checkIn}: ${blocked ? reason : error instanceof Error ? error.message.split("\n")[0] : reason}`,
      );
      quotes.push(
        ...scope.rooms.map((room): ProviderQuote => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: null,
          currency: scope.currency,
          status: "manual-review",
          dataMode: "live",
          sourceHint,
          reason,
        })),
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
  return { quotes, warnings };
}
