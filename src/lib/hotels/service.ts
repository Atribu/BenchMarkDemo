import { randomUUID } from "node:crypto";
import type { HotelRoomCategory, HotelRoomView } from "./catalog";
import type { HotelStore } from "./file-store";
import {
  parseRuntimeHotelId,
  parseRuntimeHotelKey,
  parseRuntimeScopeKey,
} from "./identifiers";
import {
  assertHotelStatusTransition,
  isHotelLifecycleStatus,
  type HotelLifecycleStatus,
} from "./lifecycle";
import {
  createHotelDraft,
  type HotelBoard,
  type HotelCurrency,
  type HotelMarketRecord,
  type ManagedHotelMatchingPolicy,
  type HotelRoomOccupancy,
  type ManagedHotelRoomRecord,
  type ManagedHotelRecord,
} from "./model";
import { createHotelReadRepository } from "./repository";

export type HotelManagementErrorKind =
  | "validation"
  | "conflict"
  | "not_found"
  | "forbidden";

export class HotelManagementError extends Error {
  constructor(
    readonly kind: HotelManagementErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "HotelManagementError";
  }
}

export interface CreateHotelDraftPayload {
  key: string;
  name: string;
  shortCode: string;
  location: {
    countryCode: string;
    city: string;
    region?: string;
    address?: string;
  };
  websiteUrl?: string;
}

export interface UpdateHotelDetailsPayload {
  version: number;
  name?: string;
  shortCode?: string;
  location?: CreateHotelDraftPayload["location"];
  websiteUrl?: string | null;
}

export interface TransitionHotelStatusPayload {
  version: number;
  status: HotelLifecycleStatus;
}

export interface CreateHotelMarketPayload {
  version: number;
  id: string;
  label: string;
  marketLabel: string;
  currency: HotelCurrency;
  requiredBoard?: HotelBoard;
  notes?: string;
}

export interface UpdateHotelMarketPayload {
  version: number;
  label?: string;
  marketLabel?: string;
  currency?: HotelCurrency;
  requiredBoard?: HotelBoard | null;
  notes?: string | null;
}

export interface CreateHotelRoomPayload {
  version: number;
  id: string;
  name: string;
  occupancy: HotelRoomOccupancy;
}

export interface UpdateHotelRoomPayload {
  version: number;
  name?: string;
  occupancy?: HotelRoomOccupancy;
}

export interface SetHotelMatchingPolicyPayload {
  version: number;
  category: HotelRoomCategory;
  requireBalcony: boolean;
  roomByView: Partial<Record<HotelRoomView, string>>;
}

const ROOM_VIEWS = ["land", "garden", "sea", "partial-sea"] as const;

interface HotelManagementServiceOptions {
  store: HotelStore;
  generateId?: () => string;
  now?: () => Date;
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

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | undefined {
  if (value === undefined || value === "") return undefined;
  return text(value, label, 1, maximum);
}

function website(value: unknown): string | undefined {
  const raw = optionalText(value, "Web sitesi", 2000);
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Web sitesi geçerli bir HTTPS adresi olmalıdır.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname
  )
    throw new Error("Web sitesi geçerli bir HTTPS adresi olmalıdır.");
  return url.toString();
}

function location(value: unknown): CreateHotelDraftPayload["location"] {
  const input = record(value, "Konum");
  onlyKeys(input, ["countryCode", "city", "region", "address"], "Konum");
  const countryCode = text(input.countryCode, "Ülke kodu", 2, 2);
  if (!/^[A-Za-z]{2}$/.test(countryCode))
    throw new Error("Ülke kodu iki harften oluşmalıdır.");
  return {
    countryCode: countryCode.toUpperCase(),
    city: text(input.city, "Şehir", 2, 100),
    region: optionalText(input.region, "Bölge", 100),
    address: optionalText(input.address, "Adres", 1000),
  };
}

function shortCode(value: unknown): string {
  const normalized = text(value, "Kısa kod", 2, 5).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(normalized))
    throw new Error("Kısa kod yalnızca harf ve rakam içermelidir.");
  return normalized;
}

function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error("Geçerli bir otel sürümü zorunludur.");
  return value as number;
}

function currency(value: unknown): HotelCurrency {
  if (value !== "EUR" && value !== "GBP" && value !== "RUB")
    throw new Error("Para birimi EUR, GBP veya RUB olmalıdır.");
  return value;
}

function board(value: unknown): HotelBoard {
  if (value !== "all-inclusive" && value !== "all-inclusive-plus")
    throw new Error("Pansiyon türü geçersiz.");
  return value;
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  )
    throw new Error(`${label} ${minimum}-${maximum} arasında olmalıdır.`);
  return value as number;
}

function occupancy(value: unknown): HotelRoomOccupancy {
  const input = record(value, "Doluluk");
  onlyKeys(input, ["rooms", "adults", "children"], "Doluluk");
  const parsed = {
    rooms: integer(input.rooms, "Oda sayısı", 1, 10),
    adults: integer(input.adults, "Yetişkin sayısı", 1, 20),
    children: integer(input.children, "Çocuk sayısı", 0, 20),
  };
  if (parsed.adults + parsed.children > 20)
    throw new Error("Toplam misafir sayısı 20 değerini aşamaz.");
  return parsed;
}

export function parseCreateHotelDraftPayload(
  value: unknown,
): CreateHotelDraftPayload {
  const input = record(value, "Otel");
  onlyKeys(
    input,
    ["key", "name", "shortCode", "location", "websiteUrl"],
    "Otel",
  );
  return {
    key: parseRuntimeHotelKey(input.key),
    name: text(input.name, "Otel adı", 2, 150),
    shortCode: shortCode(input.shortCode),
    location: location(input.location),
    websiteUrl: website(input.websiteUrl),
  };
}

export function parseUpdateHotelDetailsPayload(
  value: unknown,
): UpdateHotelDetailsPayload {
  const input = record(value, "Otel güncellemesi");
  onlyKeys(
    input,
    ["version", "name", "shortCode", "location", "websiteUrl"],
    "Otel güncellemesi",
  );
  if (!Number.isSafeInteger(input.version) || (input.version as number) < 1)
    throw new Error("Geçerli bir otel sürümü zorunludur.");
  if (Object.keys(input).length === 1)
    throw new Error("Güncellenecek en az bir alan gönderilmelidir.");

  const payload: UpdateHotelDetailsPayload = {
    version: input.version as number,
  };
  if (input.name !== undefined)
    payload.name = text(input.name, "Otel adı", 2, 150);
  if (input.shortCode !== undefined)
    payload.shortCode = shortCode(input.shortCode);
  if (input.location !== undefined)
    payload.location = location(input.location);
  if (Object.hasOwn(input, "websiteUrl"))
    payload.websiteUrl =
      input.websiteUrl === null ? null : website(input.websiteUrl);
  return payload;
}

export function parseTransitionHotelStatusPayload(
  value: unknown,
): TransitionHotelStatusPayload {
  const input = record(value, "Durum değişikliği");
  onlyKeys(input, ["version", "status"], "Durum değişikliği");
  if (!isHotelLifecycleStatus(input.status))
    throw new Error("Otel durumu geçersiz.");
  return { version: version(input.version), status: input.status };
}

export function parseCreateHotelMarketPayload(
  value: unknown,
): CreateHotelMarketPayload {
  const input = record(value, "Pazar");
  onlyKeys(
    input,
    [
      "version",
      "id",
      "label",
      "marketLabel",
      "currency",
      "requiredBoard",
      "notes",
    ],
    "Pazar",
  );
  return {
    version: version(input.version),
    id: parseRuntimeScopeKey(input.id),
    label: text(input.label, "Pazar adı", 2, 150),
    marketLabel: text(input.marketLabel, "Pazar etiketi", 2, 100),
    currency: currency(input.currency),
    requiredBoard:
      input.requiredBoard === undefined ? undefined : board(input.requiredBoard),
    notes: optionalText(input.notes, "Pazar notu", 2000),
  };
}

export function parseUpdateHotelMarketPayload(
  value: unknown,
): UpdateHotelMarketPayload {
  const input = record(value, "Pazar güncellemesi");
  onlyKeys(
    input,
    ["version", "label", "marketLabel", "currency", "requiredBoard", "notes"],
    "Pazar güncellemesi",
  );
  if (Object.keys(input).length === 1)
    throw new Error("Güncellenecek en az bir pazar alanı gönderilmelidir.");
  const payload: UpdateHotelMarketPayload = { version: version(input.version) };
  if (input.label !== undefined)
    payload.label = text(input.label, "Pazar adı", 2, 150);
  if (input.marketLabel !== undefined)
    payload.marketLabel = text(input.marketLabel, "Pazar etiketi", 2, 100);
  if (input.currency !== undefined)
    payload.currency = currency(input.currency);
  if (Object.hasOwn(input, "requiredBoard"))
    payload.requiredBoard =
      input.requiredBoard === null ? null : board(input.requiredBoard);
  if (Object.hasOwn(input, "notes"))
    payload.notes =
      input.notes === null || input.notes === ""
        ? null
        : text(input.notes, "Pazar notu", 1, 2000);
  return payload;
}

export function parseHotelVersionPayload(value: unknown): number {
  const input = record(value, "Silme isteği");
  onlyKeys(input, ["version"], "Silme isteği");
  return version(input.version);
}

export function parseCreateHotelRoomPayload(
  value: unknown,
): CreateHotelRoomPayload {
  const input = record(value, "Oda tipi");
  onlyKeys(input, ["version", "id", "name", "occupancy"], "Oda tipi");
  return {
    version: version(input.version),
    id: parseRuntimeScopeKey(input.id),
    name: text(input.name, "Oda adı", 2, 150),
    occupancy: occupancy(input.occupancy),
  };
}

export function parseUpdateHotelRoomPayload(
  value: unknown,
): UpdateHotelRoomPayload {
  const input = record(value, "Oda güncellemesi");
  onlyKeys(input, ["version", "name", "occupancy"], "Oda güncellemesi");
  if (Object.keys(input).length === 1)
    throw new Error("Güncellenecek en az bir oda alanı gönderilmelidir.");
  return {
    version: version(input.version),
    name:
      input.name === undefined
        ? undefined
        : text(input.name, "Oda adı", 2, 150),
    occupancy:
      input.occupancy === undefined ? undefined : occupancy(input.occupancy),
  };
}

export function parseSetHotelMatchingPolicyPayload(
  value: unknown,
): SetHotelMatchingPolicyPayload {
  const input = record(value, "Oda eşleştirme politikası");
  onlyKeys(
    input,
    ["version", "category", "requireBalcony", "roomByView"],
    "Oda eşleştirme politikası",
  );
  if (input.category !== "standard" && input.category !== "superior")
    throw new Error("Oda kategorisi standard veya superior olmalıdır.");
  if (typeof input.requireBalcony !== "boolean")
    throw new Error("Balkon zorunluluğu true veya false olmalıdır.");
  const views = record(input.roomByView, "Manzara-oda eşleştirmesi");
  onlyKeys(views, ROOM_VIEWS, "Manzara-oda eşleştirmesi");
  if (Object.keys(views).length === 0)
    throw new Error("En az bir manzara oda tipiyle eşleştirilmelidir.");
  const roomByView: Partial<Record<HotelRoomView, string>> = {};
  for (const view of ROOM_VIEWS) {
    if (views[view] !== undefined)
      roomByView[view] = parseRuntimeScopeKey(views[view]);
  }
  return {
    version: version(input.version),
    category: input.category,
    requireBalcony: input.requireBalcony,
    roomByView,
  };
}

function assertDraftConfigurationEdit(
  hotel: ManagedHotelRecord,
  subject: string,
): void {
  if (hotel.source === "system")
    throw new HotelManagementError(
      "forbidden",
      "Sistem otellerinin yapılandırması değiştirilemez.",
    );
  if (hotel.status !== "draft")
    throw new HotelManagementError(
      "conflict",
      `${subject} yapılandırması yalnızca taslak otellerde değiştirilebilir.`,
    );
}

function resetChannelVerification(
  hotel: ManagedHotelRecord,
): ManagedHotelRecord["channelMappings"] {
  return hotel.channelMappings.map((mapping) => ({
    ...mapping,
    status: "draft",
    verifiedAt: undefined,
  }));
}

function configurationProblems(hotel: ManagedHotelRecord): string[] {
  const problems: string[] = [];
  const marketIds = new Set(hotel.markets.map((market) => market.id));
  const roomIds = new Set(hotel.rooms.map((room) => room.id));

  if (hotel.markets.length === 0) problems.push("en az bir pazar");
  if (marketIds.size !== hotel.markets.length)
    problems.push("benzersiz pazar kimlikleri");
  if (hotel.rooms.length === 0) problems.push("en az bir oda");
  if (roomIds.size !== hotel.rooms.length)
    problems.push("benzersiz oda kimlikleri");
  if (!hotel.matchingPolicy) {
    problems.push("oda eşleştirme politikası");
  } else {
    const mappedRooms = Object.values(hotel.matchingPolicy.roomByView);
    if (mappedRooms.length === 0)
      problems.push("en az bir manzara-oda eşleştirmesi");
    if (mappedRooms.some((roomId) => !roomIds.has(roomId)))
      problems.push("geçerli manzara-oda referansları");
  }
  if (hotel.channelMappings.length === 0)
    problems.push("en az bir kanal eşleştirmesi");
  if (
    hotel.channelMappings.some(
      (mapping) =>
        !marketIds.has(mapping.marketId) ||
        Object.keys(mapping.roomAliases).some((roomId) => !roomIds.has(roomId)),
    )
  )
    problems.push("geçerli kanal pazar/oda referansları");

  return problems;
}

function activationProblems(hotel: ManagedHotelRecord): string[] {
  const problems = configurationProblems(hotel);
  const requiredRoomIds = new Set(
    Object.values(hotel.matchingPolicy?.roomByView ?? {}),
  );
  for (const market of hotel.markets) {
    const verifiedMappings = hotel.channelMappings.filter(
      (mapping) =>
        mapping.marketId === market.id &&
        mapping.status === "verified" &&
        Boolean(mapping.verifiedAt) &&
        Boolean(
          mapping.externalHotelId || mapping.pageUrl || mapping.searchName,
        ),
    );
    if (verifiedMappings.length === 0)
      problems.push(`${market.label} için doğrulanmış kanal eşleştirmesi`);
    for (const roomId of requiredRoomIds) {
      if (
        !verifiedMappings.some(
          (mapping) => (mapping.roomAliases[roomId]?.length ?? 0) > 0,
        )
      )
        problems.push(
          `${market.label} / ${roomId} için doğrulanmış kanal oda alias'ı`,
        );
    }
  }
  return problems;
}

function assertStatusRequirements(
  hotel: ManagedHotelRecord,
  status: HotelLifecycleStatus,
): void {
  const problems =
    status === "ready"
      ? configurationProblems(hotel)
      : status === "active"
        ? activationProblems(hotel)
        : [];
  if (problems.length > 0)
    throw new HotelManagementError(
      "conflict",
      `Otel ${status} durumuna geçirilemez. Eksikler: ${problems.join(", ")}.`,
    );
}

export class HotelManagementService {
  private readonly generateId: () => string;
  private readonly now: () => Date;

  constructor(private readonly options: HotelManagementServiceOptions) {
    this.generateId = options.generateId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async list(includeArchived = false): Promise<readonly ManagedHotelRecord[]> {
    const repository = createHotelReadRepository(await this.options.store.load());
    return repository.list({ includeArchived });
  }

  async getById(id: string): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    try {
      parsedId = parseRuntimeHotelId(id);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Otel kimliği geçersiz.",
      );
    }
    const hotel = createHotelReadRepository(
      await this.options.store.load(),
    ).findById(parsedId);
    if (!hotel)
      throw new HotelManagementError("not_found", "Otel bulunamadı.");
    return hotel;
  }

  async createDraft(value: unknown, actor: string): Promise<ManagedHotelRecord> {
    let input: CreateHotelDraftPayload;
    try {
      input = parseCreateHotelDraftPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Otel bilgileri geçersiz.",
      );
    }
    const createdBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);
    const now = this.now().toISOString();
    const id = `hotel_${this.generateId().replaceAll("-", "")}`;

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      if (repository.findByKey(input.key))
        throw new HotelManagementError(
          "conflict",
          `Otel anahtarı zaten kullanılıyor: ${input.key}`,
        );
      if (repository.findById(id))
        throw new HotelManagementError(
          "conflict",
          "Yeni otel kimliği başka bir kayıtla çakıştı.",
        );
      const hotel = createHotelDraft({
        id,
        key: input.key,
        name: input.name,
        shortCode: input.shortCode,
        location: input.location,
        websiteUrl: input.websiteUrl,
        createdBy,
        now,
      });
      createHotelReadRepository([...hotels, hotel]);
      return { hotels: [...hotels, hotel], result: hotel };
    });
  }

  async updateDetails(
    id: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let input: UpdateHotelDetailsPayload;
    try {
      parsedId = parseRuntimeHotelId(id);
      input = parseUpdateHotelDetailsPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Otel güncellemesi geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      if (existing.source === "system")
        throw new HotelManagementError(
          "forbidden",
          "Sistem otelleri bu alandan değiştirilemez.",
        );
      if (existing.status !== "draft" && existing.status !== "ready")
        throw new HotelManagementError(
          "conflict",
          `Otel ${existing.status} durumundayken temel bilgileri değiştirilemez.`,
        );
      if (existing.version !== input.version)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );

      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const updated: ManagedHotelRecord = {
        ...existing,
        name: input.name ?? existing.name,
        shortCode: input.shortCode ?? existing.shortCode,
        location: input.location ?? existing.location,
        websiteUrl:
          input.websiteUrl === null
            ? undefined
            : input.websiteUrl ?? existing.websiteUrl,
        version: existing.version + 1,
        audit: {
          ...existing.audit,
          updatedBy,
          updatedAt: this.now().toISOString(),
        },
      };
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async transitionStatus(
    id: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let input: TransitionHotelStatusPayload;
    try {
      parsedId = parseRuntimeHotelId(id);
      input = parseTransitionHotelStatusPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Durum değişikliği geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      if (existing.source === "system")
        throw new HotelManagementError(
          "forbidden",
          "Sistem otellerinin durumu değiştirilemez.",
        );
      if (existing.version !== input.version)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      try {
        assertHotelStatusTransition(existing.status, input.status);
      } catch (error) {
        throw new HotelManagementError(
          "conflict",
          error instanceof Error ? error.message : "Durum geçişine izin verilmiyor.",
        );
      }
      assertStatusRequirements(existing, input.status);

      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        status: input.status,
        version: existing.version + 1,
        audit: {
          ...existing.audit,
          updatedBy,
          updatedAt: now,
          archivedAt:
            input.status === "archived"
              ? now
              : existing.status === "archived"
                ? undefined
                : existing.audit.archivedAt,
        },
      };
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async addMarket(
    id: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let input: CreateHotelMarketPayload;
    try {
      parsedId = parseRuntimeHotelId(id);
      input = parseCreateHotelMarketPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Pazar bilgileri geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftConfigurationEdit(existing, "Pazar");
      if (existing.version !== input.version)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      if (
        repository
          .list({ includeArchived: true })
          .some((hotel) => hotel.markets.some((market) => market.id === input.id))
      )
        throw new HotelManagementError(
          "conflict",
          `Pazar kimliği zaten kullanılıyor: ${input.id}`,
        );

      const market: HotelMarketRecord = {
        id: parseRuntimeScopeKey(input.id),
        label: input.label,
        marketLabel: input.marketLabel,
        currency: input.currency,
        requiredBoard: input.requiredBoard,
        notes: input.notes,
      };
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        markets: [...existing.markets, market],
        version: existing.version + 1,
        audit: { ...existing.audit, updatedBy, updatedAt: now },
      };
      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async updateMarket(
    id: string,
    marketId: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let parsedMarketId: ReturnType<typeof parseRuntimeScopeKey>;
    let input: UpdateHotelMarketPayload;
    try {
      parsedId = parseRuntimeHotelId(id);
      parsedMarketId = parseRuntimeScopeKey(marketId);
      input = parseUpdateHotelMarketPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Pazar güncellemesi geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftConfigurationEdit(existing, "Pazar");
      if (existing.version !== input.version)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      const market = existing.markets.find(
        (candidate) => candidate.id === parsedMarketId,
      );
      if (!market)
        throw new HotelManagementError("not_found", "Pazar bulunamadı.");

      const requiredBoard =
        input.requiredBoard === null
          ? undefined
          : input.requiredBoard ?? market.requiredBoard;
      const resetChannelVerification =
        (input.currency !== undefined && input.currency !== market.currency) ||
        (input.requiredBoard !== undefined &&
          requiredBoard !== market.requiredBoard);
      const updatedMarket: HotelMarketRecord = {
        ...market,
        label: input.label ?? market.label,
        marketLabel: input.marketLabel ?? market.marketLabel,
        currency: input.currency ?? market.currency,
        requiredBoard,
        notes:
          input.notes === null ? undefined : input.notes ?? market.notes,
      };
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        markets: existing.markets.map((candidate) =>
          candidate.id === parsedMarketId ? updatedMarket : candidate,
        ),
        channelMappings: resetChannelVerification
          ? existing.channelMappings.map((mapping) =>
              mapping.marketId === parsedMarketId
                ? { ...mapping, status: "draft", verifiedAt: undefined }
                : mapping,
            )
          : existing.channelMappings,
        version: existing.version + 1,
        audit: { ...existing.audit, updatedBy, updatedAt: now },
      };
      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async removeMarket(
    id: string,
    marketId: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let parsedMarketId: ReturnType<typeof parseRuntimeScopeKey>;
    let expectedVersion: number;
    try {
      parsedId = parseRuntimeHotelId(id);
      parsedMarketId = parseRuntimeScopeKey(marketId);
      expectedVersion = parseHotelVersionPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Pazar silme isteği geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftConfigurationEdit(existing, "Pazar");
      if (existing.version !== expectedVersion)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      if (!existing.markets.some((market) => market.id === parsedMarketId))
        throw new HotelManagementError("not_found", "Pazar bulunamadı.");
      if (
        existing.channelMappings.some(
          (mapping) => mapping.marketId === parsedMarketId,
        )
      )
        throw new HotelManagementError(
          "conflict",
          "Pazara bağlı kanal eşleştirmeleri silinmeden pazar silinemez.",
        );

      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        markets: existing.markets.filter(
          (market) => market.id !== parsedMarketId,
        ),
        version: existing.version + 1,
        audit: { ...existing.audit, updatedBy, updatedAt: now },
      };
      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async addRoom(
    id: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let input: CreateHotelRoomPayload;
    try {
      parsedId = parseRuntimeHotelId(id);
      input = parseCreateHotelRoomPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Oda bilgileri geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftConfigurationEdit(existing, "Oda");
      if (existing.version !== input.version)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      if (existing.rooms.some((room) => room.id === input.id))
        throw new HotelManagementError(
          "conflict",
          `Oda kimliği bu otelde zaten kullanılıyor: ${input.id}`,
        );

      const room: ManagedHotelRoomRecord = {
        id: parseRuntimeScopeKey(input.id),
        name: input.name,
        occupancy: input.occupancy,
      };
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        rooms: [...existing.rooms, room],
        channelMappings: resetChannelVerification(existing),
        version: existing.version + 1,
        audit: { ...existing.audit, updatedBy, updatedAt: now },
      };
      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async updateRoom(
    id: string,
    roomId: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let parsedRoomId: ReturnType<typeof parseRuntimeScopeKey>;
    let input: UpdateHotelRoomPayload;
    try {
      parsedId = parseRuntimeHotelId(id);
      parsedRoomId = parseRuntimeScopeKey(roomId);
      input = parseUpdateHotelRoomPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Oda güncellemesi geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftConfigurationEdit(existing, "Oda");
      if (existing.version !== input.version)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      const room = existing.rooms.find(
        (candidate) => candidate.id === parsedRoomId,
      );
      if (!room)
        throw new HotelManagementError("not_found", "Oda tipi bulunamadı.");

      const updatedRoom: ManagedHotelRoomRecord = {
        ...room,
        name: input.name ?? room.name,
        occupancy: input.occupancy ?? room.occupancy,
      };
      const changed =
        updatedRoom.name !== room.name ||
        updatedRoom.occupancy.rooms !== room.occupancy.rooms ||
        updatedRoom.occupancy.adults !== room.occupancy.adults ||
        updatedRoom.occupancy.children !== room.occupancy.children;
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        rooms: existing.rooms.map((candidate) =>
          candidate.id === parsedRoomId ? updatedRoom : candidate,
        ),
        channelMappings: changed
          ? resetChannelVerification(existing)
          : existing.channelMappings,
        version: existing.version + 1,
        audit: { ...existing.audit, updatedBy, updatedAt: now },
      };
      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async removeRoom(
    id: string,
    roomId: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let parsedRoomId: ReturnType<typeof parseRuntimeScopeKey>;
    let expectedVersion: number;
    try {
      parsedId = parseRuntimeHotelId(id);
      parsedRoomId = parseRuntimeScopeKey(roomId);
      expectedVersion = parseHotelVersionPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error ? error.message : "Oda silme isteği geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftConfigurationEdit(existing, "Oda");
      if (existing.version !== expectedVersion)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      if (!existing.rooms.some((room) => room.id === parsedRoomId))
        throw new HotelManagementError("not_found", "Oda tipi bulunamadı.");
      if (
        existing.matchingPolicy &&
        Object.values(existing.matchingPolicy.roomByView).includes(parsedRoomId)
      )
        throw new HotelManagementError(
          "conflict",
          "Oda eşleştirme politikasından kaldırılmadan oda tipi silinemez.",
        );
      if (
        existing.channelMappings.some((mapping) =>
          Object.hasOwn(mapping.roomAliases, parsedRoomId),
        )
      )
        throw new HotelManagementError(
          "conflict",
          "Kanal oda alias'larından kaldırılmadan oda tipi silinemez.",
        );

      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        rooms: existing.rooms.filter((room) => room.id !== parsedRoomId),
        channelMappings: resetChannelVerification(existing),
        version: existing.version + 1,
        audit: { ...existing.audit, updatedBy, updatedAt: now },
      };
      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async setMatchingPolicy(
    id: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let input: SetHotelMatchingPolicyPayload;
    try {
      parsedId = parseRuntimeHotelId(id);
      input = parseSetHotelMatchingPolicyPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error
          ? error.message
          : "Oda eşleştirme politikası geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftConfigurationEdit(existing, "Oda eşleştirme politikası");
      if (existing.version !== input.version)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      const roomIds = new Set(existing.rooms.map((room) => room.id));
      const missingRoom = Object.values(input.roomByView).find(
        (roomId) => !roomIds.has(roomId),
      );
      if (missingRoom)
        throw new HotelManagementError(
          "conflict",
          `Eşleştirme politikasındaki oda bu otele ait değil: ${missingRoom}`,
        );

      const policy: ManagedHotelMatchingPolicy = {
        category: input.category,
        requireBalcony: input.requireBalcony,
        roomByView: input.roomByView,
      };
      const previous = existing.matchingPolicy;
      const changed =
        !previous ||
        previous.category !== policy.category ||
        previous.requireBalcony !== policy.requireBalcony ||
        ROOM_VIEWS.some(
          (view) => previous.roomByView[view] !== policy.roomByView[view],
        );
      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        matchingPolicy: policy,
        channelMappings: changed
          ? resetChannelVerification(existing)
          : existing.channelMappings,
        version: existing.version + 1,
        audit: { ...existing.audit, updatedBy, updatedAt: now },
      };
      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }

  async removeMatchingPolicy(
    id: string,
    value: unknown,
    actor: string,
  ): Promise<ManagedHotelRecord> {
    let parsedId: ReturnType<typeof parseRuntimeHotelId>;
    let expectedVersion: number;
    try {
      parsedId = parseRuntimeHotelId(id);
      expectedVersion = parseHotelVersionPayload(value);
    } catch (error) {
      throw new HotelManagementError(
        "validation",
        error instanceof Error
          ? error.message
          : "Eşleştirme politikası silme isteği geçersiz.",
      );
    }
    const updatedBy = text(actor, "İşlemi yapan kullanıcı", 1, 100);

    return this.options.store.update((hotels) => {
      const repository = createHotelReadRepository(hotels);
      const existing = repository.findById(parsedId);
      if (!existing)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      assertDraftConfigurationEdit(existing, "Oda eşleştirme politikası");
      if (existing.version !== expectedVersion)
        throw new HotelManagementError(
          "conflict",
          "Otel başka bir işlem tarafından güncellendi. Güncel kaydı yeniden yükleyin.",
        );
      if (!existing.matchingPolicy)
        throw new HotelManagementError(
          "not_found",
          "Oda eşleştirme politikası bulunamadı.",
        );

      const now = this.now().toISOString();
      const updated: ManagedHotelRecord = {
        ...existing,
        matchingPolicy: undefined,
        channelMappings: resetChannelVerification(existing),
        version: existing.version + 1,
        audit: { ...existing.audit, updatedBy, updatedAt: now },
      };
      const index = hotels.findIndex((hotel) => hotel.id === parsedId);
      if (index < 0)
        throw new HotelManagementError("not_found", "Otel bulunamadı.");
      const next = [...hotels];
      next[index] = updated;
      createHotelReadRepository(next);
      return { hotels: next, result: updated };
    });
  }
}
