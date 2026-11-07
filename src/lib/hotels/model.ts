import type {
  HotelRoomCategory,
  HotelRoomView,
} from "./catalog";
import type { HotelLifecycleStatus } from "./lifecycle";
import {
  parseRuntimeHotelId,
  parseRuntimeHotelKey,
  type RuntimeHotelId,
  type RuntimeHotelKey,
  type RuntimeScopeKey,
} from "./identifiers";

export type HotelRecordSource = "system" | "user";
export type HotelCurrency = "EUR" | "GBP" | "RUB";
export type HotelBoard = "all-inclusive" | "all-inclusive-plus";
export type HotelChannelMappingStatus = "draft" | "configured" | "disabled";

export interface HotelLocation {
  countryCode: string;
  city: string;
  region?: string;
  address?: string;
}

export interface HotelMarketRecord {
  id: RuntimeScopeKey;
  label: string;
  marketLabel: string;
  currency: HotelCurrency;
  requiredBoard?: HotelBoard;
  notes?: string;
}

export interface HotelRoomOccupancy {
  rooms: number;
  adults: number;
  children: number;
}

export interface ManagedHotelRoomRecord {
  id: string;
  name: string;
  occupancy: HotelRoomOccupancy;
}

export interface ManagedHotelMatchingPolicy {
  category: HotelRoomCategory;
  requireBalcony: boolean;
  roomByView: Partial<Record<HotelRoomView, string>>;
}

export interface HotelChannelMappingRecord {
  id: string;
  providerKey: string;
  marketId: RuntimeScopeKey;
  status: HotelChannelMappingStatus;
  externalHotelId?: string;
  pageUrl?: string;
  searchName?: string;
  roomAliases: Record<string, readonly string[]>;
  configurationCheckedAt?: string;
  /** Reserved for evidence produced by a successful live collector run. */
  liveVerifiedAt?: string;
  lastLiveCheckAt?: string;
  lastLiveCheckSucceeded?: boolean;
}

export interface HotelAuditFields {
  createdBy: string | null;
  createdAt: string | null;
  updatedBy?: string | null;
  updatedAt: string | null;
  archivedAt?: string;
}

export interface ManagedHotelRecord {
  id: RuntimeHotelId;
  key: RuntimeHotelKey;
  name: string;
  shortCode: string;
  location: HotelLocation;
  websiteUrl?: string;
  source: HotelRecordSource;
  status: HotelLifecycleStatus;
  markets: readonly HotelMarketRecord[];
  rooms: readonly ManagedHotelRoomRecord[];
  matchingPolicy?: ManagedHotelMatchingPolicy;
  channelMappings: readonly HotelChannelMappingRecord[];
  version: number;
  audit: HotelAuditFields;
}

export interface NewHotelDraftInput {
  id: string;
  key: string;
  name: string;
  shortCode: string;
  location: HotelLocation;
  websiteUrl?: string;
  createdBy: string;
  now: string;
}

export function createHotelDraft(
  input: NewHotelDraftInput,
): ManagedHotelRecord {
  return {
    id: parseRuntimeHotelId(input.id),
    key: parseRuntimeHotelKey(input.key),
    name: input.name,
    shortCode: input.shortCode,
    location: input.location,
    websiteUrl: input.websiteUrl,
    source: "user",
    status: "draft",
    markets: [],
    rooms: [],
    channelMappings: [],
    version: 1,
    audit: {
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedBy: input.createdBy,
      updatedAt: input.now,
    },
  };
}
