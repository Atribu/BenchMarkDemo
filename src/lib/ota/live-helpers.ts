import { chromium as extraChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  browserSessionPath,
  readBrowserSession,
  writeBrowserSession,
} from "./browser-session";
import type {
  CurrencyCode,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
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
  sessionKey?: string;
  headless?: boolean;
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
    timezoneId: "UTC",
  },
  uk: {
    acceptLanguage: "en-GB,en;q=0.9",
    locale: "en-GB",
    timezoneId: "Europe/London",
  },
  de: {
    acceptLanguage: "de-DE,de;q=0.9,en;q=0.8",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  us: {
    acceptLanguage: "en-US,en;q=0.9",
    locale: "en-US",
    timezoneId: "America/New_York",
  },
};

const PROVIDER_DEFAULT_MARKETS: Partial<Record<string, SupportedMarket>> = {
  expedia: "uk",
  holidaycheck: "de",
  loveholidays: "uk",
  onthebeach: "uk",
  tui: "de",
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
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

let stealthRegistered = false;

export async function createBrowserPage(options: BrowserPageOptions = {}) {
  if (options.useStealth && !stealthRegistered) {
    extraChromium.use(StealthPlugin());
    stealthRegistered = true;
  }
  const browserEngine = options.useStealth
    ? extraChromium
    : (await import("playwright")).chromium;
  const market = normalizeMarket(options.market);
  const browserChannel = normalizeBrowserChannel(options.browserChannel);
  const preset = MARKET_PRESETS[market];
  const launchArgs = options.useStealth
    ? ["--disable-blink-features=AutomationControlled"]
    : [];
  const launchOptions = {
    headless: options.headless ?? true,
    args: launchArgs,
    channel: browserChannel === "chrome" ? "chrome" : undefined,
    proxy: parseProxyUrl(options.proxyUrl),
  };
  const browser =
    browserChannel === "chrome"
      ? await browserEngine.launch(launchOptions).catch(() =>
          browserEngine.launch({
            ...launchOptions,
            channel: undefined,
          }),
        )
      : await browserEngine.launch(launchOptions);
  const sessionFile =
    options.sessionKey && process.env.OTA_PERSIST_SESSIONS !== "false"
      ? browserSessionPath(
          `${options.sessionKey}:${market}:${browserChannel}:${options.proxyUrl ?? "direct"}`,
        )
      : undefined;
  try {
    const context = await browser.newContext({
      storageState: sessionFile
        ? await readBrowserSession(sessionFile)
        : undefined,
      extraHTTPHeaders: {
        "accept-language": preset.acceptLanguage,
      },
      ignoreHTTPSErrors: true,
      locale: preset.locale,
      timezoneId: preset.timezoneId,
      userAgent: options.userAgent,
      viewport: { width: 1440, height: 1200 },
    });
    const page = await context.newPage();

    if (options.useStealth)
      await page.addInitScript(
        ({ languages }) => {
          Object.defineProperty(navigator, "webdriver", {
            get: () => false,
          });

          Object.defineProperty(navigator, "languages", {
            get: () => languages,
          });

          Object.defineProperty(navigator, "plugins", {
            get: () => [1, 2, 3, 4, 5],
          });

          Object.defineProperty(window, "chrome", {
            get: () => ({
              runtime: {},
            }),
          });

          const originalQuery = window.navigator.permissions?.query?.bind(
            window.navigator.permissions,
          );

          if (originalQuery) {
            window.navigator.permissions.query = async (parameters) => {
              if (parameters.name === "notifications") {
                return {
                  name: parameters.name,
                  onchange: null,
                  state: Notification.permission,
                } as PermissionStatus;
              }

              return originalQuery(parameters);
            };
          }
        },
        {
          languages: [preset.locale, preset.locale.split("-")[0]],
        },
      );

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try {
        if (sessionFile) {
          await writeBrowserSession(
            sessionFile,
            await context.storageState(),
          ).catch(() => undefined);
        }
      } finally {
        await browser.close();
      }
    };
    return { browser, context, page, close };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

export function resolveProviderLiveConfig(
  providerKey: string,
  currency?: CurrencyCode,
) {
  const prefix = providerKey.toUpperCase();
  const market = normalizeMarket(
    process.env[`${prefix}_MARKET`]?.trim() ||
      process.env.OTA_MARKET?.trim() ||
      PROVIDER_DEFAULT_MARKETS[providerKey],
  );
  const browserChannel = normalizeBrowserChannel(
    process.env[`${prefix}_BROWSER_CHANNEL`]?.trim() ||
      process.env.OTA_BROWSER_CHANNEL?.trim() ||
      (providerKey === "expedia" ||
      providerKey === "holidaycheck" ||
      providerKey === "loveholidays" ||
      providerKey === "onthebeach"
        ? "chrome"
        : "chromium"),
  );
  const userAgent =
    process.env[`${prefix}_USER_AGENT`]?.trim() ||
    process.env.OTA_USER_AGENT?.trim() ||
    (providerKey === "expedia" ||
    providerKey === "loveholidays" ||
    providerKey === "onthebeach"
      ? undefined
      : DEFAULT_USER_AGENT);
  const stealthOverride =
    process.env[`${prefix}_USE_STEALTH`]?.trim() ||
    process.env.OTA_USE_STEALTH?.trim();
  const useStealth =
    stealthOverride !== undefined
      ? stealthOverride === "true"
      : ["holidaycheck", "loveholidays", "onthebeach"].includes(providerKey);
  const proxyUrl =
    process.env[`${prefix}_PROXY_URL`]?.trim() ||
    process.env.OTA_PROXY_URL?.trim() ||
    undefined;

  return {
    sessionKey: `${providerKey}:${currency ?? "default"}`,
    market,
    browserChannel,
    userAgent,
    useStealth,
    proxyUrl,
  };
}

export function buildManualReviewQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  sourceHint: string,
  warning?: string,
  reason = "Bağlantı veya yanıt doğrulanamadı. Ayrıntı için rapor uyarılarını kontrol edin.",
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
      sourceHint,
      reason,
    })),
  );

  return {
    quotes,
    warnings: warning ? [warning] : [],
  };
}

export function parsePriceFromText(
  text: string,
  currency: CurrencyCode,
): number | null {
  const currencyTokens = currency === "GBP" ? ["£", "GBP"] : ["€", "EUR"];

  for (const token of currencyTokens) {
    const escaped = token.replace("$", "\\$");
    const before = new RegExp(
      `${escaped}\\s*([\\d.,]+(?:[ \\u00a0\\u202f]\\d{3})*(?:[.,]\\d{2})?)`,
      "i",
    );
    const after = new RegExp(
      `([\\d.,]+(?:[ \\u00a0\\u202f]\\d{3})*(?:[.,]\\d{2})?)\\s*${escaped}`,
      "i",
    );
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
      line.toLowerCase().includes(alias.toLowerCase()),
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
  currency: CurrencyCode,
): number | null {
  const normalized = normalizeInlineText(text);
  const match = normalized.match(
    new RegExp(`${nights}\\s+nights?\\s+From\\s+([^ ]+\\s*[\\d.,]+)`, "i"),
  );

  if (!match?.[1]) {
    return null;
  }

  return parsePriceFromText(match[1], currency);
}

function normalizeNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const separator = Math.max(
    cleaned.lastIndexOf(","),
    cleaned.lastIndexOf("."),
  );
  const decimals = separator < 0 ? 0 : cleaned.length - separator - 1;
  let normalized: string;
  if (separator >= 0 && (decimals === 1 || decimals === 2)) {
    const integer = cleaned.slice(0, separator);
    if (!/^\d+$|^\d{1,3}(?:[.,]\d{3})+$/.test(integer)) return null;
    normalized = `${integer.replace(/[.,]/g, "")}.${cleaned.slice(separator + 1)}`;
  } else {
    if (!/^\d+$|^\d{1,3}(?:[.,]\d{3})+$/.test(cleaned)) return null;
    normalized = cleaned.replace(/[.,]/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}
