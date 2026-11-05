import {
  HOTEL_CATALOG,
  type HotelCatalogEntry,
} from "./catalog";
import { isHotelAvailableForBenchmark } from "./lifecycle";
import {
  parseRuntimeHotelId,
  parseRuntimeHotelKey,
  parseRuntimeScopeKey,
} from "./identifiers";
import type {
  HotelRoomOccupancy,
  ManagedHotelRecord,
} from "./model";

export interface HotelListOptions {
  includeArchived?: boolean;
}

export interface HotelReadRepository {
  list(options?: HotelListOptions): readonly ManagedHotelRecord[];
  listForBenchmark(): readonly ManagedHotelRecord[];
  findById(id: string): ManagedHotelRecord | undefined;
  findByKey(key: string): ManagedHotelRecord | undefined;
}

function legacyOccupancy(label: string): HotelRoomOccupancy {
  if (label === "2 Pax" || label === "1 oda · 2 yetişkin") {
    return { rooms: 1, adults: 2, children: 0 };
  }

  throw new Error(`Bilinmeyen sistem oteli doluluk etiketi: ${label}`);
}

export function systemHotelRecord(
  hotel: HotelCatalogEntry,
): ManagedHotelRecord {
  return {
    id: parseRuntimeHotelId(`system:${hotel.key}`),
    key: parseRuntimeHotelKey(hotel.key),
    name: hotel.name,
    shortCode: hotel.shortCode,
    location: hotel.location,
    source: "system",
    status: "active",
    markets: hotel.scopes.map((scope) => ({
      id: parseRuntimeScopeKey(scope.id),
      label: scope.label,
      marketLabel: scope.marketLabel,
      currency: scope.currency,
      requiredBoard: scope.requiredBoard,
      notes: scope.notes,
    })),
    rooms: hotel.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      occupancy: legacyOccupancy(room.occupancyLabel),
    })),
    matchingPolicy: {
      category: hotel.matchingPolicy.category,
      requireBalcony: hotel.matchingPolicy.requireBalcony,
      roomByView: { ...hotel.matchingPolicy.roomByView },
    },
    // Existing collector configuration remains in live-config and registry
    // until channel mappings are migrated in a later step.
    channelMappings: [],
    version: 1,
    audit: {
      createdBy: null,
      createdAt: null,
      updatedBy: null,
      updatedAt: null,
    },
  };
}

export function createHotelReadRepository(
  userHotels: readonly ManagedHotelRecord[] = [],
): HotelReadRepository {
  const systemHotels = HOTEL_CATALOG.map(systemHotelRecord);
  const records: ManagedHotelRecord[] = [...systemHotels];
  const ids = new Set(systemHotels.map((hotel) => hotel.id));
  const keys = new Set(systemHotels.map((hotel) => hotel.key));

  for (const hotel of userHotels) {
    if (hotel.source !== "user") {
      throw new Error("Harici otel kayıtlarının kaynağı kullanıcı olmalıdır.");
    }
    if (ids.has(hotel.id)) {
      throw new Error(`Otel kimliği zaten kullanılıyor: ${hotel.id}`);
    }
    if (keys.has(hotel.key)) {
      throw new Error(`Otel anahtarı zaten kullanılıyor: ${hotel.key}`);
    }
    ids.add(hotel.id);
    keys.add(hotel.key);
    records.push(hotel);
  }

  return {
    list(options = {}) {
      return options.includeArchived
        ? [...records]
        : records.filter((hotel) => hotel.status !== "archived");
    },
    listForBenchmark() {
      return records.filter((hotel) =>
        isHotelAvailableForBenchmark(hotel.status),
      );
    },
    findById(id) {
      return records.find((hotel) => hotel.id === id);
    },
    findByKey(key) {
      return records.find((hotel) => hotel.key === key);
    },
  };
}
