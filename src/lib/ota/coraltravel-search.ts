
import type { Page } from "patchright";
import type { HotelKey } from "@/src/lib/benchmark/types";

const GERMAN_MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

const HOTEL_NAMES: Record<
  HotelKey,
  { query: string; suggestion: string }
> = {
  "miramare-beach": {
    query: "Miramare Beach",
    suggestion: "Miramare Beach Hotel",
  },
  "miramare-queen": {
    query: "Miramare Queen",
    suggestion: "Miramare Queen Hotel",
  },
};

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`Geçersiz tarih: ${value}`);
  }

  const [year, month, day] = match.slice(1).map(Number);

  const actual = new Date(
    Date.UTC(year, month - 1, day),
  );

  if (
    actual.getUTCFullYear() !== year ||
    actual.getUTCMonth() !== month - 1 ||
    actual.getUTCDate() !== day
  ) {
    throw new Error(`Geçersiz takvim tarihi: ${value}`);
  }

  return { year, month, day };
}

function germanDate(value: string) {
  const { year, month, day } = parseIsoDate(value);

  return (
    `${String(day).padStart(2, "0")}.` +
    `${String(month).padStart(2, "0")}.` +
    `${year}`
  );
}

async function selectDate(
  page: Page,
  value: string,
) {
  const { year, month, day } = parseIsoDate(value);

  const label = `${GERMAN_MONTHS[month - 1]}, ${year}`;

  const wrappers = page.locator(
    ".calwrapper:visible .first-cal-wrapper, " +
      ".calwrapper:visible .sec-cal-wrapper",
  );

  for (let attempt = 0; attempt < 18; attempt++) {
    const found = wrappers.filter({
      has: page.locator(".month_header", {
        hasText: label,
      }),
    });

    if ((await found.count()) > 0) {
      const button = found
        .first()
        .locator(
          "button.mday-btn:not(.disabledday)",
        )
        .filter({
          hasText: new RegExp(`^0?${day}$`),
        })
        .first();

      await button.click({
        timeout: 10_000,
      });

      console.log("[CORALTRAVEL] Date selected:", {
        date: value,
        month: label,
      });

      return;
    }

    const headers = await wrappers
      .locator(".month_header")
      .allTextContents();

    const visibleMonths = headers.flatMap(
      (header) => {
        const clean = header
          .replace(/chevron_(?:left|right)/g, "")
          .trim();

        const index = GERMAN_MONTHS.findIndex(
          (name) => clean.startsWith(`${name},`),
        );

        const y = Number(
          clean.split(",")[1]?.trim(),
        );

        return index >= 0 && Number.isInteger(y)
          ? [y * 12 + index]
          : [];
      },
    );

    if (!visibleMonths.length) {
      throw new Error(
        "Takvim ay başlıkları okunamadı.",
      );
    }

    const targetMonth =
      year * 12 + month - 1;

    const direction =
      targetMonth < Math.min(...visibleMonths)
        ? "left"
        : "right";

    await page
      .locator(".calwrapper:visible .month_header")
      .getByText(
        `chevron_${direction}`,
        { exact: true },
      )
      .first()
      .click();

    await page.waitForTimeout(150);
  }

  throw new Error(
    `Takvimde tarih bulunamadı: ${value}`,
  );
}

export async function searchCoralTravel(
  page: Page,
  hotelKey: HotelKey,
  checkIn: string,
  checkOut: string,
): Promise<void> {
  const hotel = HOTEL_NAMES[hotelKey];

  // 1. Yalnızca konaklama modu
  await page
    .getByText("Nur Hotel", { exact: true })
    .click();

  console.log("[CORALTRAVEL] Nur Hotel selected.");

  // 2. Otel arama panelini aç
  await page
    .getByText("Reiseziel oder Hotelname", {
      exact: true,
    })
    .click();

  // 3. Otel ismini yaz
  await page
    .locator('input[placeholder="Wohin?"]:visible')
    .fill(hotel.query);

  console.log(
    "[CORALTRAVEL] Hotel name entered:",
    hotel.query,
  );

  // 4. Doğru oteli önerilerden seç
  const suggestion = page
    .getByText(hotel.suggestion, {
      exact: true,
    })
    .last();

  await suggestion.waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await suggestion.click();

  console.log(
    "[CORALTRAVEL] Hotel selected:",
    hotel.suggestion,
  );

  // 5. Tarih seçiciyi aç
  await page
    .getByText(
      /\d{2}\.\d{2}\.\d{4}\s*-\s*\d{2}\.\d{2}\.\d{4}/,
    )
    .first()
    .click();

  console.log("[CORALTRAVEL] Datepicker opened.");

  // 6. Check-in ve check-out seç
  await selectDate(page, checkIn);
  await selectDate(page, checkOut);

  // 7. Seçilen tarihleri doğrula
  const expectedRange =
    `${germanDate(checkIn)} - ` +
    germanDate(checkOut);

  await page
    .getByText(expectedRange, {
      exact: true,
    })
    .first()
    .waitFor({
      state: "visible",
      timeout: 10_000,
    });

  console.log("[CORALTRAVEL] Dates verified:", {
    checkIn,
    checkOut,
    displayedRange: expectedRange,
  });

  // Arama formunun Hotel Only modunda olduğunu kontrol et.
  // Bu kontrol yetişkin ve oda sayısını bağımsız doğrulamaz.
  const guestText = await page
    .locator("body")
    .innerText();

  if (!guestText.includes("Nur Hotel")) {
    throw new Error(
      "Hotel-only modu doğrulanamadı.",
    );
  }

  // 8. Aramayı başlat
  await page
    .getByText("URLAUB FINDEN", {
      exact: true,
    })
    .first()
    .click();

  console.log("[CORALTRAVEL] Search submitted.");

  // 9. Sonuç sayfasına geçişi bekle
  await page.waitForURL(
    (url) => url.pathname.startsWith("/offers"),
    { timeout: 45_000 },
  );

  console.log("[CORALTRAVEL] Offers page opened.");

  // 10. Detaylı teklifleri aç
  const details = page
    .getByText("Zu den Angeboten", {
      exact: true,
    })
    .first();

  await details.waitFor({
    state: "visible",
    timeout: 25_000,
  });

  await details.click();

  console.log("[CORALTRAVEL] Offer details opened.");
}
