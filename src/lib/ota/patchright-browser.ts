import { chromium, type BrowserContext, type Page } from "patchright";

export interface PatchrightBrowserHandle {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

interface PatchrightBrowserOptions {
  profilePath?: string;
  headless?: boolean;
  browserChannel?: "chrome" | "chromium";
  market?: "default" | "uk" | "de" | "us";
  proxyUrl?: string;
  userAgent?: string;
}

const MARKET_PRESETS = {
  default: {
    locale: "en-US",
    timezoneId: "UTC",
  },
  uk: {
    locale: "en-GB",
    timezoneId: "Europe/London",
  },
  de: {
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  us: {
    locale: "en-US",
    timezoneId: "America/New_York",
  },
} as const;

function parseProxyUrl(proxyUrl?: string) {
  if (!proxyUrl) return undefined;

  const parsed = new URL(proxyUrl);

  return {
    server: `${parsed.protocol}//${parsed.host}`,
    username: parsed.username
      ? decodeURIComponent(parsed.username)
      : undefined,
    password: parsed.password
      ? decodeURIComponent(parsed.password)
      : undefined,
  };
}

export async function createPatchrightBrowserPage(
  options: PatchrightBrowserOptions = {},
): Promise<PatchrightBrowserHandle> {
  const preset = options.market
    ? MARKET_PRESETS[options.market]
    : undefined;

  const context = await chromium.launchPersistentContext(
    options.profilePath ??
      "./.benchmark-state/expedia-browser-profile",
    {
      channel:
        options.browserChannel === "chromium"
          ? undefined
          : "chrome",
      headless: options.headless ?? false,
      viewport: null,
      ...(preset ?? {}),
      ...(options.userAgent
        ? { userAgent: options.userAgent }
        : {}),
      proxy: parseProxyUrl(options.proxyUrl),
    },
  );

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    return {
      context,
      page,
      close: async () => {
        await context.close();
      },
    };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}