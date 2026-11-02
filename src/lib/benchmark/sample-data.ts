import {
  HOTEL_CATALOG,
  type HotelRoomCatalogEntry,
  type HotelScopeCatalogEntry,
} from "@/src/lib/hotels/catalog";
import type {
  BenchmarkRequest,
  BenchmarkWindowDefinition,
  OtaKey,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";

const FUTURE_WINDOWS: BenchmarkWindowDefinition[] = [
  {
    id: "2026-05-10_2026-05-15",
    label: "10 - 15 Mayıs 2026",
    checkIn: "2026-05-10",
    checkOut: "2026-05-15",
    nights: 5,
  },
  {
    id: "2026-06-10_2026-06-15",
    label: "10 - 15 Haziran 2026",
    checkIn: "2026-06-10",
    checkOut: "2026-06-15",
    nights: 5,
  },
  {
    id: "2026-08-10_2026-08-15",
    label: "10 - 15 Ağustos 2026",
    checkIn: "2026-08-10",
    checkOut: "2026-08-15",
    nights: 5,
  },
  {
    id: "2026-09-10_2026-09-15",
    label: "10 - 15 Eylül 2026",
    checkIn: "2026-09-10",
    checkOut: "2026-09-15",
    nights: 5,
  },
  {
    id: "2026-10-10_2026-10-15",
    label: "10 - 15 Ekim 2026",
    checkIn: "2026-10-10",
    checkOut: "2026-10-15",
    nights: 5,
  },
];

export const DEFAULT_CUSTOM_WINDOW = {
  checkIn: "2026-10-31",
  checkOut: "2026-11-05",
};

// Hotel, scope and room definitions live in one catalog. Adding a hotel no
// longer requires duplicating its identity in the benchmark seed data.
export const REPORT_SCOPES: ReportScopeDefinition[] = HOTEL_CATALOG.flatMap(
  (hotel) =>
    hotel.scopes.map((scopeValue) => {
      const scope: HotelScopeCatalogEntry = scopeValue;
      return {
      id: scopeValue.id,
      label: scope.label,
      hotelKey: hotel.key,
      hotelName: hotel.name,
      marketLabel: scope.marketLabel,
      currency: scope.currency,
      requiredBoard: scope.requiredBoard,
      notes: scope.notes,
      windows: FUTURE_WINDOWS,
      rooms: hotel.rooms.map((roomValue) => {
        const room: HotelRoomCatalogEntry = roomValue;
        return {
          id: room.id,
          name: room.name,
          occupancyLabel: room.occupancyLabel,
        referenceRates:
            room.referenceRates?.[scopeValue.id] ?? {},
        };
      }),
      };
    }),
);

export const DEFAULT_PROVIDER_KEYS: OtaKey[] = ["booking"];

export const DEFAULT_REQUEST: BenchmarkRequest = {
  mode: "mock",
  providerKeys: DEFAULT_PROVIDER_KEYS,
  scopeKeys: REPORT_SCOPES.map((scope) => scope.id),
  customWindow: DEFAULT_CUSTOM_WINDOW,
};
