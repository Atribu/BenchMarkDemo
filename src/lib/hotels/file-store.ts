import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  parseRuntimeHotelId,
  parseRuntimeHotelKey,
  parseRuntimeScopeKey,
} from "./identifiers";
import { isHotelLifecycleStatus } from "./lifecycle";
import type {
  HotelChannelMappingRecord,
  HotelMarketRecord,
  ManagedHotelMatchingPolicy,
  ManagedHotelRecord,
  ManagedHotelRoomRecord,
} from "./model";

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 2_000_000;
const MAX_HOTELS = 500;

interface StoredHotels {
  schemaVersion: typeof SCHEMA_VERSION;
  hotels: ManagedHotelRecord[];
}

export interface HotelStoreUpdate<T> {
  hotels: readonly ManagedHotelRecord[];
  result: T;
}

export interface HotelStore {
  load(): Promise<readonly ManagedHotelRecord[]>;
  update<T>(
    mutate: (
      hotels: readonly ManagedHotelRecord[],
    ) => HotelStoreUpdate<T>,
  ): Promise<T>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Nesne bekleniyor.");
  return value as Record<string, unknown>;
}

function string(value: unknown, maximum = 300): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  )
    throw new Error("Metin alanı geçersiz.");
  return value;
}

function optionalString(value: unknown, maximum = 1000): string | undefined {
  return value === undefined ? undefined : string(value, maximum);
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error("Boolean alanı geçersiz.");
  return value;
}

function nullableString(value: unknown, maximum = 300): string | null {
  return value === null ? null : string(value, maximum);
}

function positiveInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum)
    throw new Error("Pozitif tam sayı bekleniyor.");
  return value as number;
}

function nonnegativeInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum)
    throw new Error("Negatif olmayan tam sayı bekleniyor.");
  return value as number;
}

function parseMarket(value: unknown): HotelMarketRecord {
  const input = object(value);
  if (!["EUR", "GBP", "RUB"].includes(String(input.currency)))
    throw new Error("Para birimi geçersiz.");
  if (
    input.requiredBoard !== undefined &&
    !["all-inclusive", "all-inclusive-plus"].includes(
      String(input.requiredBoard),
    )
  )
    throw new Error("Pansiyon türü geçersiz.");
  return {
    id: parseRuntimeScopeKey(input.id),
    label: string(input.label),
    marketLabel: string(input.marketLabel),
    currency: input.currency as HotelMarketRecord["currency"],
    requiredBoard: input.requiredBoard as HotelMarketRecord["requiredBoard"],
    notes: optionalString(input.notes, 2000),
  };
}

function parseRoom(value: unknown): ManagedHotelRoomRecord {
  const input = object(value);
  const occupancy = object(input.occupancy);
  return {
    id: parseRuntimeScopeKey(input.id),
    name: string(input.name),
    occupancy: {
      rooms: positiveInteger(occupancy.rooms, 10),
      adults: positiveInteger(occupancy.adults, 20),
      children: nonnegativeInteger(occupancy.children, 20),
    },
  };
}

function parseMatchingPolicy(value: unknown): ManagedHotelMatchingPolicy {
  const input = object(value);
  if (input.category !== "standard" && input.category !== "superior")
    throw new Error("Oda kategorisi geçersiz.");
  if (typeof input.requireBalcony !== "boolean")
    throw new Error("Balkon kuralı geçersiz.");
  const views = object(input.roomByView);
  const roomByView: ManagedHotelMatchingPolicy["roomByView"] = {};
  for (const [view, roomId] of Object.entries(views)) {
    if (!["land", "garden", "sea", "partial-sea"].includes(view))
      throw new Error("Manzara türü geçersiz.");
    roomByView[view as keyof typeof roomByView] = parseRuntimeScopeKey(roomId);
  }
  return {
    category: input.category,
    requireBalcony: input.requireBalcony,
    roomByView,
  };
}

function parseChannelMapping(value: unknown): HotelChannelMappingRecord {
  const input = object(value);
  if (!["draft", "configured", "verified", "disabled"].includes(String(input.status)))
    throw new Error("Kanal eşleştirme durumu geçersiz.");
  const aliases = object(input.roomAliases);
  const roomAliases: Record<string, readonly string[]> = {};
  for (const [roomId, values] of Object.entries(aliases)) {
    parseRuntimeScopeKey(roomId);
    if (!Array.isArray(values) || values.length > 100)
      throw new Error("Oda alias listesi geçersiz.");
    roomAliases[roomId] = values.map((alias) => string(alias));
  }
  const liveVerifiedAt = optionalString(input.liveVerifiedAt);
  const lastLiveCheckAt =
    optionalString(input.lastLiveCheckAt) ?? liveVerifiedAt;
  const lastLiveCheckSucceeded =
    optionalBoolean(input.lastLiveCheckSucceeded) ??
    (liveVerifiedAt ? true : undefined);
  return {
    id: parseRuntimeHotelId(input.id),
    providerKey: parseRuntimeHotelKey(input.providerKey),
    marketId: parseRuntimeScopeKey(input.marketId),
    // `verified` was the pre-v2 name for a configuration-only check. Reading
    // it as `configured` preserves existing hotels without claiming that a
    // live collector request succeeded.
    status: input.status === "verified" ? "configured" : input.status as HotelChannelMappingRecord["status"],
    externalHotelId: optionalString(input.externalHotelId),
    pageUrl: optionalString(input.pageUrl, 2000),
    searchName: optionalString(input.searchName),
    roomAliases,
    configurationCheckedAt:
      optionalString(input.configurationCheckedAt) ??
      optionalString(input.verifiedAt),
    liveVerifiedAt,
    lastLiveCheckAt,
    lastLiveCheckSucceeded,
  };
}

export function parseStoredHotel(value: unknown): ManagedHotelRecord {
  const input = object(value);
  if (input.source !== "user")
    throw new Error("Yalnızca kullanıcı otelleri saklanabilir.");
  if (!isHotelLifecycleStatus(input.status))
    throw new Error("Otel durumu geçersiz.");
  const location = object(input.location);
  const audit = object(input.audit);
  if (!Array.isArray(input.markets) || !Array.isArray(input.rooms))
    throw new Error("Otel alt kayıtları geçersiz.");
  if (!Array.isArray(input.channelMappings))
    throw new Error("Kanal eşleştirmeleri geçersiz.");
  return {
    id: parseRuntimeHotelId(input.id),
    key: parseRuntimeHotelKey(input.key),
    name: string(input.name),
    shortCode: string(input.shortCode, 10),
    location: {
      countryCode: string(location.countryCode, 2),
      city: string(location.city),
      region: optionalString(location.region),
      address: optionalString(location.address, 1000),
    },
    websiteUrl: optionalString(input.websiteUrl, 2000),
    source: "user",
    status: input.status,
    markets: input.markets.map(parseMarket),
    rooms: input.rooms.map(parseRoom),
    matchingPolicy:
      input.matchingPolicy === undefined
        ? undefined
        : parseMatchingPolicy(input.matchingPolicy),
    channelMappings: input.channelMappings.map(parseChannelMapping),
    version: positiveInteger(input.version, Number.MAX_SAFE_INTEGER),
    audit: {
      createdBy: nullableString(audit.createdBy),
      createdAt: nullableString(audit.createdAt),
      updatedBy:
        audit.updatedBy === undefined
          ? undefined
          : nullableString(audit.updatedBy),
      updatedAt: nullableString(audit.updatedAt),
      archivedAt: optionalString(audit.archivedAt),
    },
  };
}

function parseStore(value: unknown): StoredHotels {
  const input = object(value);
  if (input.schemaVersion !== SCHEMA_VERSION || !Array.isArray(input.hotels))
    throw new Error("Otel deposu şeması geçersiz.");
  if (input.hotels.length > MAX_HOTELS)
    throw new Error("Otel deposu kayıt sınırını aşıyor.");
  const hotels = input.hotels.map(parseStoredHotel);
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const hotel of hotels) {
    if (ids.has(hotel.id)) throw new Error("Otel kimliği depoda yineleniyor.");
    if (keys.has(hotel.key)) throw new Error("Otel anahtarı depoda yineleniyor.");
    ids.add(hotel.id);
    keys.add(hotel.key);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    hotels,
  };
}

async function readStore(file: string): Promise<StoredHotels> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES)
      throw new Error("Otel deposu boyutu geçersiz.");
    return parseStore(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { schemaVersion: SCHEMA_VERSION, hotels: [] };
    throw new Error("Otel kayıt deposu doğrulanamadı.", { cause: error });
  }
}

export function createFileHotelStore(
  directory =
    process.env.BENCHMARK_STATE_DIR ||
    path.join(process.cwd(), ".benchmark-state"),
): HotelStore {
  const file = path.join(directory, "user-hotels.json");
  const lock = path.join(directory, "user-hotels.lock");

  return {
    async load() {
      return (await readStore(file)).hotels;
    },
    async update(mutate) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        await mkdir(lock, { mode: 0o700 });
      } catch {
        throw new Error("Otel kayıt deposu meşgul; değişiklik yapılmadı.");
      }
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const current = (await readStore(file)).hotels;
        const update = mutate(current);
        if (update.hotels.length > MAX_HOTELS)
          throw new Error("Otel deposu kayıt sınırını aşıyor.");
        const verified = parseStore({
          schemaVersion: SCHEMA_VERSION,
          hotels: update.hotels.map((hotel) =>
            JSON.parse(JSON.stringify(hotel)),
          ),
        });
        const payload = JSON.stringify(verified);
        if (Buffer.byteLength(payload) > MAX_FILE_BYTES)
          throw new Error("Otel deposu boyut sınırını aşıyor.");
        await writeFile(temporary, payload, { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
        return update.result;
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
        await rm(lock, { recursive: true });
      }
    },
  };
}
