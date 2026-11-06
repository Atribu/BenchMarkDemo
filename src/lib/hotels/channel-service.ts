import { randomUUID } from "node:crypto";
import type { HotelStore } from "./file-store";
import {
  parseRuntimeHotelId,
  parseRuntimeHotelKey,
  parseRuntimeScopeKey,
} from "./identifiers";
import type {
  HotelChannelMappingRecord,
  HotelChannelMappingStatus,
  ManagedHotelRecord,
} from "./model";
import { createHotelReadRepository } from "./repository";
import { HotelManagementError } from "./service";
import { OTA_PROVIDERS } from "../ota/registry";

interface HotelChannelManagementServiceOptions {
  store: HotelStore;
  generateId?: () => string;
  now?: () => Date;
}

interface CreateChannelMappingPayload {
  version: number;
  providerKey: string;
  marketId: string;
  externalHotelId?: string;
  pageUrl?: string;
  searchName?: string;
  roomAliases: Record<string, readonly string[]>;
}

interface UpdateChannelMappingPayload {
  version: number;
  externalHotelId?: string | null;
  pageUrl?: string | null;
  searchName?: string | null;
  roomAliases?: Record<string, readonly string[]>;
}

interface SetChannelMappingStatusPayload {
  version: number;
  status: HotelChannelMappingStatus;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} geçerli bir nesne olmalıdır.`);
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected)
    throw new Error(`${label} içinde beklenmeyen alan: ${unexpected}`);
}

function text(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") throw new Error(`${label} zorunludur.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum)
    throw new Error(
      `${label} ${minimum}-${maximum} karakter arasında olmalıdır.`,
    );
  return normalized;
}

function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error("Geçerli bir otel sürümü zorunludur.");
  return value as number;
}

function optionalIdentity(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === "") return undefined;
  const normalized = text(value, label, 1, 300);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized))
    throw new Error(`${label} yalnızca güvenli kimlik karakterleri içermelidir.`);
  return normalized;
}

function optionalSearchName(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  return text(value, "Kanal arama adı", 2, 150);
}

function provider(providerKey: string) {
  return OTA_PROVIDERS.find((candidate) => candidate.key === providerKey);
}

function providerPageUrl(
  value: unknown,
  providerKey: string,
): string | undefined {
  if (value === undefined || value === "") return undefined;

  const raw = text(value, "Kanal sayfa adresi", 1, 2000);

  let url: URL;
  let template: URL;

  try {
    url = new URL(raw);

    const descriptor = provider(providerKey);

    if (!descriptor?.searchTemplate) {
      throw new Error("Provider template missing");
    }

    template = new URL(descriptor.searchTemplate);
  } catch {
    throw new Error(
      "Kanal sayfa adresi geçerli bir HTTPS adresi olmalıdır.",
    );
  }

  const providerDomains: Record<string, string[]> = {
    expedia: [
      "expedia.com",
      "expedia.de",
      "expedia.co.uk",
    ],
    booking: [
      "booking.com",
    ],
    check24: [
      "check24.de",
    ],

    stayforlong: [
      "stayforlong.com",
      "stayforlong.de",
    ],
    coral: ["coraltravel.de", "coral.ru"],
    coraltravel: ["coraltravel.de", "coral.ru"],
    "coral-travel": ["coraltravel.de", "coral.ru"],
  };

  const defaultDomain = template.hostname
    .toLowerCase()
    .replace(/^www\./, "");

  const allowedDomains =
    providerDomains[providerKey] ?? [defaultDomain];

  const hostname = url.hostname.toLowerCase();

  const isAllowedDomain = allowedDomains.some(
    (domain) =>
      hostname === domain ||
      hostname.endsWith(`.${domain}`),
  );

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !isAllowedDomain
  ) {
    throw new Error(
      "Kanal sayfa adresi seçilen OTA alan adına ait olmalıdır.",
    );
  }

  return url.toString();
}

function aliases(value: unknown): Record<string, readonly string[]> {
  const input = record(value, "Oda alias'ları");
  if (Object.keys(input).length > 100)
    throw new Error("En fazla 100 oda alias grubu gönderilebilir.");
  const result: Record<string, readonly string[]> = {};
  let total = 0;
  for (const [rawRoomId, rawAliases] of Object.entries(input)) {
    const roomId = parseRuntimeScopeKey(rawRoomId);
    if (!Array.isArray(rawAliases) || rawAliases.length === 0 || rawAliases.length > 100)
      throw new Error("Her oda için 1-100 kanal alias'ı gönderilmelidir.");
    const seen = new Set<string>();
    const normalized = rawAliases.map((alias) => {
      const value = text(alias, "Oda alias'ı", 1, 200);
      const identity = value.toLocaleLowerCase("tr-TR");
      if (seen.has(identity))
        throw new Error(`Oda alias'ı yineleniyor: ${value}`);
      seen.add(identity);
      return value;
    });
    total += normalized.length;
    if (total > 500)
      throw new Error("Toplam oda alias sayısı 500 değerini aşamaz.");
    result[roomId] = normalized;
  }
  return result;
}

function assertIdentity(payload: {
  externalHotelId?: string | null;
  pageUrl?: string | null;
  searchName?: string | null;
}) {
  if (payload.externalHotelId || payload.pageUrl || payload.searchName) return;
  throw new Error(
    "Harici otel kimliği, kanal sayfa adresi veya arama adından biri zorunludur.",
  );
}

function parseCreate(value: unknown): CreateChannelMappingPayload {
  const input = record(value, "Kanal eşleştirmesi");
  onlyKeys(
    input,
    [
      "version",
      "providerKey",
      "marketId",
      "externalHotelId",
      "pageUrl",
      "searchName",
      "roomAliases",
    ],
    "Kanal eşleştirmesi",
  );
  const providerKey = parseRuntimeHotelKey(input.providerKey);
  if (!provider(providerKey)) throw new Error("Bilinmeyen OTA kanalı.");
  const payload = {
    version: version(input.version),
    providerKey,
    marketId: parseRuntimeScopeKey(input.marketId),
    externalHotelId: optionalIdentity(input.externalHotelId, "Harici otel kimliği"),
    pageUrl: providerPageUrl(input.pageUrl, providerKey),
    searchName: optionalSearchName(input.searchName),
    roomAliases: aliases(input.roomAliases),
  };
  assertIdentity(payload);
  return payload;
}

function parseUpdate(
  value: unknown,
  providerKey: string,
): UpdateChannelMappingPayload {
  const input = record(value, "Kanal eşleştirme güncellemesi");
  onlyKeys(
    input,
    ["version", "externalHotelId", "pageUrl", "searchName", "roomAliases"],
    "Kanal eşleştirme güncellemesi",
  );
  if (Object.keys(input).length === 1)
    throw new Error("Güncellenecek en az bir kanal alanı gönderilmelidir.");
  const payload: UpdateChannelMappingPayload = { version: version(input.version) };
  if (Object.hasOwn(input, "externalHotelId"))
    payload.externalHotelId =
      input.externalHotelId === null ? null : optionalIdentity(input.externalHotelId, "Harici otel kimliği");
  if (Object.hasOwn(input, "pageUrl"))
    payload.pageUrl =
      input.pageUrl === null ? null : providerPageUrl(input.pageUrl, providerKey);
  if (Object.hasOwn(input, "searchName"))
    payload.searchName =
      input.searchName === null ? null : optionalSearchName(input.searchName);
  if (Object.hasOwn(input, "roomAliases"))
    payload.roomAliases = aliases(input.roomAliases);
  return payload;
}

function parseStatus(value: unknown): SetChannelMappingStatusPayload {
  const input = record(value, "Kanal eşleştirme durumu");
  onlyKeys(input, ["version", "status"], "Kanal eşleştirme durumu");
  if (!['draft', 'verified', 'disabled'].includes(String(input.status)))
    throw new Error("Kanal eşleştirme durumu geçersiz.");
  return {
    version: version(input.version),
    status: input.status as HotelChannelMappingStatus,
  };
}

function parseDelete(value: unknown): number {
  const input = record(value, "Silme isteği");
  onlyKeys(input, ["version"], "Silme isteği");
  return version(input.version);
}

function assertDraftHotel(hotel: ManagedHotelRecord) {
  if (hotel.source === "system")
    throw new HotelManagementError(
      "forbidden",
      "Sistem otellerinin kanal eşleştirmeleri değiştirilemez.",
    );
  if (hotel.status !== "draft")
    throw new HotelManagementError(
      "conflict",
      "Kanal eşleştirmeleri yalnızca taslak otellerde değiştirilebilir.",
    );
}

function assertVersion(hotel: ManagedHotelRecord, expected: number) {
  if (hotel.version !== expected)
    throw new HotelManagementError(
      "conflict",
      "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
    );
}

function assertAliasRooms(
  hotel: ManagedHotelRecord,
  roomAliases: Record<string, readonly string[]>,
) {
  const roomIds = new Set(hotel.rooms.map((room) => room.id));
  const unknown = Object.keys(roomAliases).find((roomId) => !roomIds.has(roomId));
  if (unknown)
    throw new HotelManagementError(
      "conflict",
      `Kanal alias'ındaki oda bu otele ait değil: ${unknown}`,
    );
}

function replaceHotel(
  hotels: readonly ManagedHotelRecord[],
  hotel: ManagedHotelRecord,
): ManagedHotelRecord[] {
  const index = hotels.findIndex((candidate) => candidate.id === hotel.id);
  if (index < 0)
    throw new HotelManagementError("not_found", "Otel bulunamadı.");
  const next = [...hotels];
  next[index] = hotel;
  createHotelReadRepository(next);
  return next;
}

export class HotelChannelManagementService {
  private readonly generateId: () => string;
  private readonly now: () => Date;

  constructor(private readonly options: HotelChannelManagementServiceOptions) {
    this.generateId = options.generateId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async create(id: string, value: unknown, actor: string) {
    let hotelId: ReturnType<typeof parseRuntimeHotelId>;
    let input: CreateChannelMappingPayload;
    try {
      hotelId = parseRuntimeHotelId(id);
      input = parseCreate(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Kanal eşleştirmesi geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);
    return this.options.store.update((hotels) => {
      const hotel = createHotelReadRepository(hotels).findById(hotelId);
      if (!hotel) throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftHotel(hotel);
      assertVersion(hotel, input.version);
      if (!hotel.markets.some((market) => market.id === input.marketId))
        throw new HotelManagementError("conflict", "Pazar bu otele ait değil.");
      assertAliasRooms(hotel, input.roomAliases);
      if (
        hotel.channelMappings.some(
          (mapping) =>
            mapping.providerKey === input.providerKey &&
            mapping.marketId === input.marketId,
        )
      )
        throw new HotelManagementError(
          "conflict",
          "Bu OTA ve pazar için zaten bir kanal eşleştirmesi var.",
        );
      const mappingId = parseRuntimeHotelId(
        `mapping_${this.generateId().replaceAll("-", "")}`,
      );
      if (
        createHotelReadRepository(hotels)
          .list({ includeArchived: true })
          .some((record) =>
            record.channelMappings.some((item) => item.id === mappingId),
          )
      )
        throw new HotelManagementError(
          "conflict",
          "Yeni kanal eşleştirme kimliği başka bir kayıtla çakıştı.",
        );
      const mapping: HotelChannelMappingRecord = {
        id: mappingId,
        providerKey: input.providerKey,
        marketId: parseRuntimeScopeKey(input.marketId),
        status: "draft",
        externalHotelId: input.externalHotelId,
        pageUrl: input.pageUrl,
        searchName: input.searchName,
        roomAliases: input.roomAliases,
      };
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...hotel,
        channelMappings: [...hotel.channelMappings, mapping],
        version: hotel.version + 1,
        audit: { ...hotel.audit, updatedBy, updatedAt: now },
      };
      return { hotels: replaceHotel(hotels, updated), result: updated };
    });
  }

  async update(
    id: string,
    mappingId: string,
    value: unknown,
    actor: string,
  ) {
    let hotelId: ReturnType<typeof parseRuntimeHotelId>;
    let parsedMappingId: ReturnType<typeof parseRuntimeHotelId>;
    try {
      hotelId = parseRuntimeHotelId(id);
      parsedMappingId = parseRuntimeHotelId(mappingId);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Kanal kimliği geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);
    return this.options.store.update((hotels) => {
      const hotel = createHotelReadRepository(hotels).findById(hotelId);
      if (!hotel) throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftHotel(hotel);
      const mapping = hotel.channelMappings.find((item) => item.id === parsedMappingId);
      if (!mapping)
        throw new HotelManagementError("not_found", "Kanal eşleştirmesi bulunamadı.");
      let input: UpdateChannelMappingPayload;
      try {
        input = parseUpdate(value, mapping.providerKey);
      } catch (error) {
        throw new HotelManagementError(
          "validation",
          error instanceof Error ? error.message : "Kanal güncellemesi geçersiz.",
        );
      }
      assertVersion(hotel, input.version);
      const updatedMapping: HotelChannelMappingRecord = {
        ...mapping,
        externalHotelId:
          input.externalHotelId === null
            ? undefined
            : input.externalHotelId ?? mapping.externalHotelId,
        pageUrl:
          input.pageUrl === null ? undefined : input.pageUrl ?? mapping.pageUrl,
        searchName:
          input.searchName === null
            ? undefined
            : input.searchName ?? mapping.searchName,
        roomAliases: input.roomAliases ?? mapping.roomAliases,
        status: "draft",
        verifiedAt: undefined,
      };
      try {
        assertIdentity(updatedMapping);
      } catch (error) {
        throw new HotelManagementError(
          "validation",
          error instanceof Error ? error.message : "Kanal kimliği eksik.",
        );
      }
      assertAliasRooms(hotel, updatedMapping.roomAliases);
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...hotel,
        channelMappings: hotel.channelMappings.map((item) =>
          item.id === parsedMappingId ? updatedMapping : item,
        ),
        version: hotel.version + 1,
        audit: { ...hotel.audit, updatedBy, updatedAt: now },
      };
      return { hotels: replaceHotel(hotels, updated), result: updated };
    });
  }

  async setStatus(
    id: string,
    mappingId: string,
    value: unknown,
    actor: string,
  ) {
    let hotelId: ReturnType<typeof parseRuntimeHotelId>;
    let parsedMappingId: ReturnType<typeof parseRuntimeHotelId>;
    let input: SetChannelMappingStatusPayload;
    try {
      hotelId = parseRuntimeHotelId(id);
      parsedMappingId = parseRuntimeHotelId(mappingId);
      input = parseStatus(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Kanal durumu geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);
    return this.options.store.update((hotels) => {
      const hotel = createHotelReadRepository(hotels).findById(hotelId);
      if (!hotel) throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftHotel(hotel);
      assertVersion(hotel, input.version);
      const mapping = hotel.channelMappings.find((item) => item.id === parsedMappingId);
      if (!mapping)
        throw new HotelManagementError("not_found", "Kanal eşleştirmesi bulunamadı.");
      if (input.status === "verified") {
        try {
          assertIdentity(mapping);
        } catch (error) {
          throw new HotelManagementError(
            "conflict",
            error instanceof Error ? error.message : "Kanal kimliği eksik.",
          );
        }
        if (!hotel.matchingPolicy)
          throw new HotelManagementError(
            "conflict",
            "Kanal doğrulanmadan önce oda eşleştirme politikası oluşturulmalıdır.",
          );
        const missingAlias = Object.values(hotel.matchingPolicy.roomByView).find(
          (roomId) => (mapping.roomAliases[roomId]?.length ?? 0) === 0,
        );
        if (missingAlias)
          throw new HotelManagementError(
            "conflict",
            `Politikadaki oda için kanal alias'ı eksik: ${missingAlias}`,
          );
      }
      const now = this.now().toISOString();
      const updatedMapping: HotelChannelMappingRecord = {
        ...mapping,
        status: input.status,
        verifiedAt: input.status === "verified" ? now : undefined,
      };
      const updated: ManagedHotelRecord = {
        ...hotel,
        channelMappings: hotel.channelMappings.map((item) =>
          item.id === parsedMappingId ? updatedMapping : item,
        ),
        version: hotel.version + 1,
        audit: { ...hotel.audit, updatedBy, updatedAt: now },
      };
      return { hotels: replaceHotel(hotels, updated), result: updated };
    });
  }

  async remove(
    id: string,
    mappingId: string,
    value: unknown,
    actor: string,
  ) {
    let hotelId: ReturnType<typeof parseRuntimeHotelId>;
    let parsedMappingId: ReturnType<typeof parseRuntimeHotelId>;
    let expectedVersion: number;
    try {
      hotelId = parseRuntimeHotelId(id);
      parsedMappingId = parseRuntimeHotelId(mappingId);
      expectedVersion = parseDelete(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Kanal silme isteği geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);
    return this.options.store.update((hotels) => {
      const hotel = createHotelReadRepository(hotels).findById(hotelId);
      if (!hotel) throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftHotel(hotel);
      assertVersion(hotel, expectedVersion);
      if (!hotel.channelMappings.some((item) => item.id === parsedMappingId))
        throw new HotelManagementError("not_found", "Kanal eşleştirmesi bulunamadı.");
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...hotel,
        channelMappings: hotel.channelMappings.filter(
          (item) => item.id !== parsedMappingId,
        ),
        version: hotel.version + 1,
        audit: { ...hotel.audit, updatedBy, updatedAt: now },
      };
      return { hotels: replaceHotel(hotels, updated), result: updated };
    });
  }
}
