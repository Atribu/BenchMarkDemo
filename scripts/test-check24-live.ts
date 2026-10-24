
import { chromium } from "patchright";

import {
  collectCheck24Beach,
} from "../src/lib/ota/live-check24";

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
  });

  try {
    const context = await browser.newContext({
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      viewport: {
        width: 1440,
        height: 900,
      },
    });

    try {
      const page = await context.newPage();

      const result = await collectCheck24Beach(
        page,
        "2026-10-31",
        "2026-11-05",
      );

      console.log("\n[CHECK24 LIVE] Result:", {
        apiVersion: result.apiVersion,
        nights: result.nights,
        totalOffers: result.totalOffers,
        url: result.url,
      });

      console.log("\n[CHECK24 LIVE] Beach rooms:");

      console.table(
        Object.entries(result.bestOffers).map(
          ([roomId, offer]) => ({
            roomId,
            room: offer.roomName,
            category: offer.roomCategoryName,
            supplier: offer.supplierName,
            price: offer.totalPrice,
            currency: offer.currency,
            nights: offer.nights,
          }),
        ),
      );
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    "[CHECK24 LIVE] Failed:",
    error instanceof Error
      ? error.message
      : error,
  );

  process.exitCode = 1;
});
