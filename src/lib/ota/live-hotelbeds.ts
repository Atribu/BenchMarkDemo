import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import https from "node:https";
import { gunzipSync } from "node:zlib";
import type {
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";
import { HOTELBEDS_HOTEL_CONFIG } from "@/src/lib/ota/live-config";
import { hasCompatibleView } from "@/src/lib/ota/room-matching";
import {
  buildManualReviewQuotes,
  normalizeInlineText,
} from "@/src/lib/ota/live-helpers";

interface HotelbedsAuthConfig {
  apiKey: string;
  secret: string;
  baseUrl: string;
  certPath: string;
  keyPath: string;
  caPath?: string;
}

interface HotelbedsRate {
  rateKey?: string;
  rateType?: string;
  net?: string;
  sellingRate?: string;
  boardName?: string;
}

interface HotelbedsRoom {
  code?: string;
  name?: string;
  rates?: HotelbedsRate[];
}

interface HotelbedsHotel {
  code?: number;
  name?: string;
  currency?: string;
  rooms?: HotelbedsRoom[];
}

interface HotelbedsAvailabilityResponse {
  hotels?: {
    hotels?: HotelbedsHotel[];
    total?: number;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

interface HotelbedsRoomCandidate {
  room: HotelbedsRoom;
  rate: HotelbedsRate;
  score: number;
}

function buildQuote(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  windowId: string,
  roomId: string,
  sourceHint: string,
  status: ProviderQuote["status"],
  price: number | null = null,
): ProviderQuote {
  return {
    providerKey: provider.key,
    scopeKey: scope.id,
    roomId,
    windowId,
    price,
    currency: scope.currency,
    status,
    dataMode: "live",
    sourceHint,
  };
}

function resolveHotelbedsAuthConfig(): HotelbedsAuthConfig | null {
  const apiKey = process.env.HOTELBEDS_API_KEY?.trim();
  const secret = process.env.HOTELBEDS_SECRET?.trim();
  const certPath = process.env.HOTELBEDS_CERT_PATH?.trim();
  const keyPath = process.env.HOTELBEDS_KEY_PATH?.trim();
  const caPath = process.env.HOTELBEDS_CA_PATH?.trim();
  const baseUrl =
    process.env.HOTELBEDS_BASE_URL?.trim() ||
    "https://api-mtls.test.hotelbeds.com";

  if (!apiKey || !secret || !certPath || !keyPath) {
    return null;
  }

  return {
    apiKey,
    secret,
    baseUrl,
    certPath,
    keyPath,
    caPath: caPath || undefined,
  };
}

function resolveHotelbedsHotelCode(
  scope: ReportScopeDefinition,
): number | null {
  const envKey =
    scope.hotelKey === "miramare-beach"
      ? "HOTELBEDS_HOTEL_CODE_MIRAMARE_BEACH"
      : "HOTELBEDS_HOTEL_CODE_MIRAMARE_QUEEN";
  const rawValue = process.env[envKey]?.trim();

  if (!rawValue) {
    return null;
  }

  const hotelCode = Number(rawValue);
  return Number.isFinite(hotelCode) ? hotelCode : null;
}

function normalizeComparableText(text: string): string {
  return normalizeInlineText(text)
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeComparableText(text: string): string[] {
  return normalizeComparableText(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function scoreRoomCandidate(roomText: string, aliases: string[]) {
  const normalizedRoomText = normalizeComparableText(roomText);
  const roomTokens = new Set(tokenizeComparableText(roomText));
  let score = 0;

  for (const alias of aliases) {
    const normalizedAlias = normalizeComparableText(alias);

    if (!normalizedAlias) {
      continue;
    }

    if (normalizedRoomText.includes(normalizedAlias)) {
      score += 10;
    }

    const aliasTokens = tokenizeComparableText(alias);
    const matchedCount = aliasTokens.filter((token) =>
      roomTokens.has(token),
    ).length;

    if (matchedCount > 0) {
      score += matchedCount * 2;
    }

    if (aliasTokens.length > 1 && matchedCount === aliasTokens.length) {
      score += 4;
    }
  }

  if (/sea|meer|ocean/.test(normalizedRoomText)) {
    score += 1;
  }

  if (/land|garden|inland/.test(normalizedRoomText)) {
    score += 1;
  }

  return score;
}

function parseRatePrice(rate: HotelbedsRate): number | null {
  const rawValue = rate.sellingRate;

  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findRoomCandidate(
  rooms: HotelbedsRoom[],
  aliases: string[],
  roomId: string,
): HotelbedsRoomCandidate | null {
  const candidates = rooms.flatMap((room) => {
    const roomText = `${room.name ?? ""} ${room.code ?? ""}`;
    if (!hasCompatibleView(roomId, roomText)) return [];
    const score = scoreRoomCandidate(roomText, aliases);

    return (room.rates ?? []).map((rate) => ({
      room,
      rate,
      score:
        score +
        (rate.sellingRate ? 1 : 0) +
        (rate.rateType === "BOOKABLE" ? 1 : 0),
    }));
  });

  const bestCandidate = candidates
    .filter(
      (candidate) =>
        candidate.score >= 6 &&
        candidate.rate.rateType === "BOOKABLE" &&
        parseRatePrice(candidate.rate) !== null,
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (
        (parseRatePrice(left.rate) ?? Number.POSITIVE_INFINITY) -
        (parseRatePrice(right.rate) ?? Number.POSITIVE_INFINITY)
      );
    })[0];

  return bestCandidate ?? null;
}

function createHotelbedsSignature(apiKey: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return createHash("sha256")
    .update(`${apiKey}${secret}${timestamp}`)
    .digest("hex");
}

function decodeHotelbedsResponse(
  buffer: Buffer,
  encoding?: string,
): HotelbedsAvailabilityResponse {
  const decoded =
    encoding === "gzip"
      ? gunzipSync(buffer, { maxOutputLength: 10 * 1024 * 1024 })
      : buffer;
  return JSON.parse(decoded.toString("utf8")) as HotelbedsAvailabilityResponse;
}

async function postHotelbedsAvailability(
  authConfig: HotelbedsAuthConfig,
  payload: Record<string, unknown>,
): Promise<{ status: number; json: HotelbedsAvailabilityResponse }> {
  const cert = await readFile(authConfig.certPath, "utf8");
  const key = await readFile(authConfig.keyPath, "utf8");
  const ca = authConfig.caPath
    ? await readFile(authConfig.caPath, "utf8")
    : undefined;
  const requestBody = JSON.stringify(payload);
  const targetUrl = new URL("/hotel-api/1.0/hotels", authConfig.baseUrl);
  const signature = createHotelbedsSignature(
    authConfig.apiKey,
    authConfig.secret,
  );

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: "POST",
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        cert,
        key,
        ca,
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "Api-key": authConfig.apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestBody),
          "X-Signature": signature,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("error", reject);
        response.on("aborted", () =>
          reject(new Error("Hotelbeds cevabi yarida kesildi.")),
        );

        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 10 * 1024 * 1024) {
            request.destroy(new Error("Hotelbeds cevap boyutu siniri asildi."));
            return;
          }
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 500,
              json: decodeHotelbedsResponse(
                Buffer.concat(chunks),
                response.headers["content-encoding"],
              ),
            });
          } catch (error) {
            reject(
              new Error(
                `Hotelbeds cevabi JSON parse edilemedi: ${
                  error instanceof Error
                    ? error.message
                    : "bilinmeyen parse hatasi"
                }`,
              ),
            );
          }
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(30000, () =>
      request.destroy(new Error("Hotelbeds istegi zaman asimina ugradi.")),
    );
    request.write(requestBody);
    request.end();
  });
}

function buildHotelbedsPayload(
  hotelCode: number,
  scope: ReportScopeDefinition,
  window: ReportScopeDefinition["windows"][number],
) {
  return {
    stay: {
      checkIn: window.checkIn,
      checkOut: window.checkOut,
    },
    occupancies: [
      {
        rooms: 1,
        adults: 2,
        children: 0,
      },
    ],
    hotels: {
      hotel: [hotelCode],
    },
    filter: {
      paymentType: "AT_WEB",
    },
    language: process.env.HOTELBEDS_LANGUAGE ?? "ENG",
    currency: scope.currency,
  };
}

export async function collectHotelbedsLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const authConfig = resolveHotelbedsAuthConfig();
  const mappedConfig = HOTELBEDS_HOTEL_CONFIG[scope.hotelKey];
  const hotelCode = resolveHotelbedsHotelCode(scope);
  const fallbackHint = authConfig?.baseUrl
    ? `${authConfig.baseUrl}/hotel-api/1.0/hotels`
    : "https://api-mtls.test.hotelbeds.com/hotel-api/1.0/hotels";

  if (!authConfig) {
    return buildManualReviewQuotes(
      provider,
      scope,
      fallbackHint,
      "Hotelbeds live collector hazir, ancak HOTELBEDS_API_KEY, HOTELBEDS_SECRET, HOTELBEDS_CERT_PATH ve HOTELBEDS_KEY_PATH tanimli degil.",
      "Hotelbeds API anahtarı, secret veya mTLS sertifikası eksik. Henüz fiyat sorgulanamıyor.",
    );
  }

  if (!mappedConfig) {
    return buildManualReviewQuotes(
      provider,
      scope,
      fallbackHint,
      `Hotelbeds icin ${scope.hotelName} room alias mapping'i bulunamadi.`,
    );
  }

  if (!hotelCode) {
    return buildManualReviewQuotes(
      provider,
      scope,
      fallbackHint,
      `Hotelbeds icin ${scope.hotelName} hotel code tanimli degil. HOTELBEDS_HOTEL_CODE_* env degeri gerekli.`,
      "Hotelbeds otel kodu tanımlı değil. Otel eşleştirmesi gerekli.",
    );
  }

  const warnings: string[] = [];
  const quotes: ProviderQuote[] = [];
  const sourceHint = `${authConfig.baseUrl}/hotel-api/1.0/hotels`;

  for (const window of scope.windows) {
    try {
      const response = await postHotelbedsAvailability(
        authConfig,
        buildHotelbedsPayload(hotelCode, scope, window),
      );

      if (response.status >= 400) {
        const errorMessage =
          response.json.error?.message ??
          `Hotelbeds HTTP ${response.status} dondu`;

        warnings.push(
          `Hotelbeds availability hatasi: ${scope.label} / ${window.label} / ${errorMessage}`,
        );
        quotes.push(
          ...scope.rooms.map((room) =>
            buildQuote(
              provider,
              scope,
              window.id,
              room.id,
              sourceHint,
              "manual-review",
            ),
          ),
        );
        continue;
      }

      const hotel = response.json.hotels?.hotels?.find(
        (candidate) => candidate.code === hotelCode,
      );

      if (
        response.json.error ||
        !Array.isArray(response.json.hotels?.hotels) ||
        (hotel && hotel.currency !== scope.currency)
      ) {
        throw new Error(
          "Hotelbeds cevap yapisi veya para birimi dogrulanamadi.",
        );
      }

      if (!hotel || !(hotel.rooms ?? []).length) {
        warnings.push(
          `Hotelbeds requested window icin oda donmedi: ${scope.label} / ${window.label}`,
        );
        quotes.push(
          ...scope.rooms.map((room) =>
            buildQuote(
              provider,
              scope,
              window.id,
              room.id,
              sourceHint,
              "sold_out",
            ),
          ),
        );
        continue;
      }

      for (const room of scope.rooms) {
        const aliases = mappedConfig.roomAliases[room.id] ?? [room.name];
        const candidate = findRoomCandidate(
          hotel.rooms ?? [],
          aliases,
          room.id,
        );

        if (!candidate) {
          const sampleRooms = (hotel.rooms ?? [])
            .slice(0, 4)
            .map((item) => item.name ?? item.code ?? "")
            .filter((value) => value.length > 0)
            .join(" | ");
          warnings.push(
            `Hotelbeds dogrulanmis oda ve satisa hazir brut fiyat bulunamadi: ${scope.label} / ${room.name} / ${window.label}${sampleRooms ? ` / mevcut odalar: ${sampleRooms}` : ""}`,
          );
          quotes.push(
            buildQuote(
              provider,
              scope,
              window.id,
              room.id,
              sourceHint,
              "manual-review",
            ),
          );
          continue;
        }

        const price = parseRatePrice(candidate.rate);

        if (price === null) {
          warnings.push(
            `Hotelbeds oda bulundu ama fiyat okunamadi: ${scope.label} / ${room.name} / ${window.label}`,
          );
          quotes.push(
            buildQuote(
              provider,
              scope,
              window.id,
              room.id,
              sourceHint,
              "manual-review",
            ),
          );
          continue;
        }

        quotes.push(
          buildQuote(
            provider,
            scope,
            window.id,
            room.id,
            sourceHint,
            "available",
            price,
          ),
        );
      }
    } catch (error) {
      warnings.push(
        `Hotelbeds live collector hatasi: ${
          error instanceof Error ? error.message : "bilinmeyen hata"
        }`,
      );
      quotes.push(
        ...scope.rooms.map((room) =>
          buildQuote(
            provider,
            scope,
            window.id,
            room.id,
            sourceHint,
            "manual-review",
          ),
        ),
      );
    }
  }

  return {
    quotes,
    warnings,
  };
}

export const __hotelbedsInternal = {
  decodeHotelbedsResponse,
  createHotelbedsSignature,
  findRoomCandidate,
  parseRatePrice,
  resolveHotelbedsHotelCode,
  resolveHotelbedsAuthConfig,
};
