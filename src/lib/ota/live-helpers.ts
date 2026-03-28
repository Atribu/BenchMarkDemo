import { createRequire } from "node:module";
import type {
  CurrencyCode,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition
} from "@/src/lib/benchmark/types";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

type SupportedMarket = "default" | "uk" | "de" | "us";
type SupportedBrowserChannel = "chromium" | "chrome";

interface BrowserPageOptions {
  market?: SupportedMarket;
  proxyUrl?: string;
  browserChannel?: SupportedBrowserChannel;
  userAgent?: string;
  useStealth?: boolean;
}

interface BrowserMarketPreset {
  acceptLanguage: string;
  locale: string;
  timezoneId: string;
}

const MARKET_PRESETS: Record<SupportedMarket, BrowserMarketPreset> = {
  default: {
    acceptLanguage: "en-US,en;q=0.9",
    locale: "en-US",
    timezoneId: "UTC"
  },
  uk: {
    acceptLanguage: "en-GB,en;q=0.9",
    locale: "en-GB",
    timezoneId: "Europe/London"
  },
  de: {
    acceptLanguage: "de-DE,de;q=0.9,en;q=0.8",
    locale: "de-DE",
    timezoneId: "Europe/Berlin"
  },
  us: {
    acceptLanguage: "en-US,en;q=0.9",
    locale: "en-US",
    timezoneId: "America/New_York"
  }
};

const PROVIDER_DEFAULT_MARKETS: Partial<Record<string, SupportedMarket>> = {
  holidaycheck: "de",
  loveholidays: "uk",
  onthebeach: "uk",
  tui: "de"
};

function normalizeMarket(value?: string): SupportedMarket {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "uk" || normalized === "de" || normalized === "us") {
    return normalized;
  }

  return "default";
}

function normalizeBrowserChannel(value?: string): SupportedBrowserChannel {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "chrome") {
    return "chrome";
  }

  return "chromium";
}

function parseProxyUrl(proxyUrl?: string) {
  if (!proxyUrl) {
    return undefined;
  }

  const parsed = new URL(proxyUrl);
  const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;

  return {
    server,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined
  };
}

export async function createBrowserPage(options: BrowserPageOptions = {}) {
  const browserEngine = options.useStealth
    ? await (async () => {
        const require = createRequire(import.meta.url);
        const playwrightExtraPackage = ["playwright", "extra"].join("-");
        const stealthPackage = ["puppeteer", "extra", "plugin", "stealth"].join("-");
        const { chromium } = require(playwrightExtraPackage) as typeof import("playwright-extra");
        const stealthPluginModule = require(stealthPackage) as {
          default?: () => unknown;
        };
        const stealthPluginFactory =
          stealthPluginModule.default ??
          (stealthPluginModule as unknown as () => unknown);

        (chromium as { use: (plugin: unknown) => void }).use(stealthPluginFactory());
        return chromium;
      })()
    : (await import("playwright")).chromium;
  const market = normalizeMarket(options.market);
  const browserChannel = normalizeBrowserChannel(options.browserChannel);
  const preset = MARKET_PRESETS[market];
  const launchArgs = ["--disable-blink-features=AutomationControlled"];
  const launchOptions = {
    headless: true,
    args: launchArgs,
    channel: browserChannel === "chrome" ? "chrome" : undefined,
    proxy: parseProxyUrl(options.proxyUrl)
  };
  const browser =
    browserChannel === "chrome"
      ? await browserEngine.launch(launchOptions).catch(() =>
          browserEngine.launch({
            ...launchOptions,
            channel: undefined
          })
        )
      : await browserEngine.launch(launchOptions);
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "accept-language": preset.acceptLanguage
    },
    ignoreHTTPSErrors: true,
    locale: preset.locale,
    timezoneId: preset.timezoneId,
    userAgent: options.userAgent,
    viewport: { width: 1440, height: 1200 }
  });
  const page = await context.newPage();

  await page.addInitScript(({ languages }) => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false
    });

    Object.defineProperty(navigator, "languages", {
      get: () => languages
    });

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5]
    });

    Object.defineProperty(window, "chrome", {
      get: () => ({
        runtime: {}
      })
    });

    const originalQuery = window.navigator.permissions?.query?.bind(
      window.navigator.permissions
    );

    if (originalQuery) {
      window.navigator.permissions.query = async (parameters) => {
        if (parameters.name === "notifications") {
          return {
            name: parameters.name,
            onchange: null,
            state: Notification.permission
          } as PermissionStatus;
        }

        return originalQuery(parameters);
      };
    }
  }, {
    languages: [preset.locale, preset.locale.split("-")[0]]
  });

  return { browser, context, page };
}

export function resolveProviderLiveConfig(providerKey: string) {
  const prefix = providerKey.toUpperCase();
  const market = normalizeMarket(
    process.env[`${prefix}_MARKET`] ??
      process.env.OTA_MARKET ??
      PROVIDER_DEFAULT_MARKETS[providerKey]
  );
  const browserChannel = normalizeBrowserChannel(
    process.env[`${prefix}_BROWSER_CHANNEL`] ??
      process.env.OTA_BROWSER_CHANNEL ??
      (providerKey === "holidaycheck" ||
      providerKey === "loveholidays" ||
      providerKey === "onthebeach"
        ? "chrome"
        : "chromium")
  );
  const userAgent =
    process.env[`${prefix}_USER_AGENT`] ??
    process.env.OTA_USER_AGENT ??
    (providerKey === "loveholidays" || providerKey === "onthebeach"
      ? undefined
      : DEFAULT_USER_AGENT);
  const useStealth =
    (process.env[`${prefix}_USE_STEALTH`] ?? process.env.OTA_USE_STEALTH) ===
      "true" ||
    providerKey === "holidaycheck" ||
    providerKey === "loveholidays" ||
    providerKey === "onthebeach";
  const proxyUrl =
    process.env[`${prefix}_PROXY_URL`] ?? process.env.OTA_PROXY_URL ?? undefined;

  return {
    market,
    browserChannel,
    userAgent,
    useStealth,
    proxyUrl
  };
}

export function buildManualReviewQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  sourceHint: string,
  warning?: string
): ProviderCollectionResult {
  const quotes: ProviderQuote[] = scope.windows.flatMap((window) =>
    scope.rooms.map((room) => ({
      providerKey: provider.key,
      scopeKey: scope.id,
      roomId: room.id,
      windowId: window.id,
      price: null,
      currency: scope.currency,
      status: "manual-review" as const,
      dataMode: "live" as const,
      sourceHint
    }))
  );

  return {
    quotes,
    warnings: warning ? [warning] : []
  };
}

export function parsePriceFromText(text: string, currency: CurrencyCode): number | null {
  const currencyTokens =
    currency === "GBP"
      ? ["£", "GBP", "US$", "$", "€", "EUR"]
      : ["€", "EUR", "US$", "$", "£", "GBP"];

  for (const token of currencyTokens) {
    const escaped = token.replace("$", "\\$");
    const before = new RegExp(`${escaped}\\s*([\\d.,]+)`, "i");
    const after = new RegExp(`([\\d.,]+)\\s*${escaped}`, "i");
    const match = text.match(before) ?? text.match(after);

    if (match?.[1]) {
      return normalizeNumber(match[1]);
    }
  }

  return null;
}

export function normalizeTextLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function findSnippet(lines: string[], aliases: string[]): string | null {
  for (const alias of aliases) {
    const index = lines.findIndex((line) =>
      line.toLowerCase().includes(alias.toLowerCase())
    );

    if (index !== -1) {
      return lines.slice(index, index + 12).join(" | ");
    }
  }

  return null;
}

export function extractNightCountPrice(
  text: string,
  nights: number,
  currency: CurrencyCode
): number | null {
  const normalized = normalizeInlineText(text);
  const match = normalized.match(
    new RegExp(`${nights}\\s+nights?\\s+From\\s+([^ ]+\\s*[\\d.,]+)`, "i")
  );

  if (!match?.[1]) {
    return null;
  }

  return parsePriceFromText(match[1], currency);
}

function normalizeNumber(raw: string): number {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }

  if (lastDot > lastComma) {
    return Number(cleaned.replace(/,/g, ""));
  }

  if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    if (parts.at(-1)?.length === 2) {
      return Number(cleaned.replace(/\./g, "").replace(",", "."));
    }

    return Number(cleaned.replace(/,/g, ""));
  }

  return Number(cleaned);
}
