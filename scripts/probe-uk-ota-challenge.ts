import { createBrowserPage, normalizeInlineText } from "../src/lib/ota/live-helpers";

const TARGETS = {
  loveholidays:
    "https://www.loveholidays.com/de/urlaub/tuerkei/antalya/side/miramare-beach/",
  "loveholidays-search":
    "https://www.loveholidays.com/holidays/?query=Miramare%20Beach&date=2026-05-10",
  onthebeach: "https://www.onthebeach.co.uk/hotels/turkey/antalya/side/miramare-beach",
  "onthebeach-search":
    "https://www.onthebeach.co.uk/holidays/search?query=Miramare%20Beach&depart=2026-05-10"
} as const;

type TargetKey = keyof typeof TARGETS;

function resolveTargetKey(input?: string): TargetKey {
  if (input === "loveholidays-search") {
    return "loveholidays-search";
  }

  if (input === "onthebeach") {
    return "onthebeach";
  }

  if (input === "onthebeach-search") {
    return "onthebeach-search";
  }

  return "loveholidays";
}

async function snapshot(
  page: Awaited<ReturnType<typeof createBrowserPage>>["page"],
  context: Awaited<ReturnType<typeof createBrowserPage>>["context"],
  url: string
) {
  const bodyText = normalizeInlineText(
    await page.locator("body").innerText().catch(() => "")
  ).slice(0, 800);

  return {
    title: await page.title(),
    url: page.url(),
    bodyText,
    cookies: (await context.cookies(url)).map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      valuePreview: cookie.value.slice(0, 16)
    }))
  };
}

async function main() {
  const targetKey = resolveTargetKey(process.argv[2]);
  const url = TARGETS[targetKey];
  const { browser, context, page } = await createBrowserPage({
    market: "uk",
    browserChannel: "chrome",
    useStealth: true
  });
  const responses: Array<{ url: string; status: number }> = [];

  page.on("response", (response) => {
    const responseUrl = response.url();

    if (
      responseUrl.includes("captcha-delivery.com") ||
      responseUrl.includes("cdn-cgi/challenge-platform") ||
      responseUrl.includes(targetKey.startsWith("loveholidays") ? "loveholidays.com" : "onthebeach.co.uk")
    ) {
      responses.push({
        url: responseUrl,
        status: response.status()
      });
    }
  });

  try {
    const initialResponse = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.waitForTimeout(8000);
    const beforeReload = await snapshot(page, context, url);

    const reloadResponse = await page.reload({
      waitUntil: "domcontentloaded",
      timeout: 45000
    }).catch(() => null);
    await page.waitForTimeout(6000);
    const afterReload = await snapshot(page, context, url);

    console.log(
      JSON.stringify(
        {
          targetKey,
          initialStatus: initialResponse?.status() ?? null,
          reloadStatus: reloadResponse?.status() ?? null,
          beforeReload,
          afterReload,
          responses: responses.filter(
            (response, index, list) =>
              list.findIndex(
                (item) => item.url === response.url && item.status === response.status
              ) === index
          )
        },
        null,
        2
      )
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
