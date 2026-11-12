import type {
  HotelKey,
  ScopeKey,
} from "@/src/lib/hotels/catalog";

import type { CurrencyConversion } from "./currency/tcmb";

export type { HotelKey, ScopeKey } from "@/src/lib/hotels/catalog";

export type CollectionMode = "mock" | "live";
export type CurrencyCode = "EUR" | "GBP" | "RUB";
export type ScopeProviderSelection = Partial<Record<ScopeKey, OtaKey[]>>;
export type OtaKey =
  | "anextour"
  | "booking"
  | "check24"
   | "coraltravel"
  | "dertour"
  | "expedia"
  | "holidaycheck"
  | "loveholidays"
  | "onthebeach"
  | "pegastour"
  | "restplatzboerse"
  | "stayforlong"
  | "tui"
  | "schauinsland";

export interface BenchmarkWindowDefinition {
  id: string;
  label: string;
  checkIn: string;
  checkOut: string;
  nights: number;
}

export interface RoomDefinition {
  id: string;
  name: string;
  occupancyLabel: string;
  referenceRates: Partial<Record<string, number>>;
}


export interface ReportScopeDefinition {
  id: ScopeKey;
  label: string;
  hotelKey: HotelKey;
  hotelName: string;
  hotelShortCode?: string;
  marketLabel: string;
  currency: CurrencyCode;

  // İsteğe bağlı benchmark pansiyon standardı.
  requiredBoard?: "all-inclusive" | "all-inclusive-plus";

  notes?: string;
  windows: BenchmarkWindowDefinition[];
  rooms: RoomDefinition[];
}


export interface ProviderDescriptor {
  key: OtaKey;
  name: string;
  shortName: string;
  collectionType: "browser" | "api";
  liveSupported: boolean;
  readiness: "mock-ready" | "selector-mapping" | "api-contract";
  notes: string;
  supportedScopes: ScopeKey[];
  searchTemplate?: string;
}

export interface ProviderQuote {
  providerKey: OtaKey;
  scopeKey: ScopeKey;
  roomId: string;
  windowId: string;
  price: number | null;
  currency: CurrencyCode;
  status: "available" | "missing" | "sold_out" | "manual-review";
  dataMode: CollectionMode;
  sourceHint: string;
  reason?: string;
  offerDescription?: string;
  offerConditions?: string;
  captureMethod?: "automated" | "manual-browser";
  observedAt?: string;
  offerId?: string;
  roomFeatures?: RoomFeatures;
  terms?: OfferTerms;
  conversion?: CurrencyConversion;
  errorCode?: BenchmarkErrorCode | null;
}

export interface RoomFeatures {
  category: "superior" | "standard" | "variant" | "unknown";
  view: "land" | "garden" | "sea" | "partial-sea" | "unknown";
  balcony: "yes" | "no" | "unknown";
}

export interface OfferTerms {
  board: string;
  cancellation: string;
  taxes: string;
  operator?: string;
  cashback?: { amount: number; currency: CurrencyCode; conditions: string };
  availability: string;
}

// A verified hotel-only total survives even when the requested room cannot be matched.
export interface CollectedOffer {
  id: string;
  providerKey: OtaKey;
  scopeKey: ScopeKey;
  windowId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  adults: number;
  price: number;
  currency: CurrencyCode;
  roomName: string;
  roomFeatures: RoomFeatures;
  terms: OfferTerms;
  sourceHint: string;
  observedAt: string;
  matchedRoomId?: string;
  matchReason: string;
  sourceOfferId?: string;
sourceProductCode?: string;
sourceTravelType?: string | null;
sourceSystemCode?: string;
sourceBoardCode?: string;
conversion?: CurrencyConversion;
}

export interface ProviderCollectionResult {
  quotes: ProviderQuote[];
  warnings: string[];
  offers?: CollectedOffer[];
  attempts?: CollectionAttempt[];
  diagnostics?: ProviderCollectionDiagnostics;
}

export interface ProviderCollectionDiagnostics {
  schemaVersion: 1;
  providerKey: OtaKey;
  scopeKey: ScopeKey;
  quoteCount: number;
  rawOfferCount: number;
  acceptedOfferCount: number;
  attemptCount: number;
  quoteStatusCounts: Record<ProviderQuote["status"], number>;
  attemptStatusCounts: Record<CollectionAttemptStatus, number>;
  errorCounts: Partial<Record<BenchmarkErrorCode, number>>;
  validationEvidenceCounts: {
    collector: number;
    derived: number;
  };
  contractIssues: string[];
}

// The advertised seller is not the collection source. Never insert these into direct OTA cells.
export interface SecondaryOffer extends CollectedOffer {
  providerKey: "holidaycheck";
  advertisedProviderKey: "booking" | "expedia" | "tui";
  source: "holidaycheck";
  hotelKey: HotelKey;
  hotelName: string;
}

export interface BrowserImportedOffer extends CollectedOffer {
  providerKey: "loveholidays" | "onthebeach";
  captureMethod: "browser-assisted";
  hotelName: string;
  importedAt: string;
}

export type BenchmarkErrorCode =
  | "hotel_mapping_missing"
  | "no_inventory"
  | "room_mapping_failed"
  | "access_blocked"
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "currency_mismatch"
  | "configuration_missing";

export type CollectionAttemptStatus =
  | "completed"
  | "partial"
  | "failed"
  | "not_run";

export type ValidationStage =
  | "source_access"
  | "hotel_identity"
  | "stay_dates"
  | "occupancy"
  | "raw_offers"
  | "room_mapping"
  | "board"
  | "price"
  | "currency";

export type ValidationCheckState =
  | "passed"
  | "failed"
  | "empty"
  | "unknown"
  | "not_applicable";

export interface CollectionValidationCheck {
  stage: ValidationStage;
  state: ValidationCheckState;
  evidence: "collector" | "derived";
  detail?: string;
}

export interface CollectionAttempt {
  id: string;
  providerKey: OtaKey;
  scopeKey: ScopeKey;
  hotelKey: HotelKey;
  windowId: string;
  status: CollectionAttemptStatus;
  startedAt: string;
  completedAt: string;
  durationMs?: number;
  rawOfferCount: number;
  acceptedOfferCount: number;
  errorCode?: BenchmarkErrorCode | null;
  reason?: string;
  validationChecks?: CollectionValidationCheck[];
}

export interface ValidationFunnelStageSummary {
  stage: ValidationStage;
  label: string;
  passedCount: number;
  failedCount: number;
  emptyCount: number;
  unknownCount: number;
  notApplicableCount: number;
  evaluatedCount: number;
}

export type ProviderReliabilityLevel = "strong" | "partial" | "weak";

export interface ReliabilityMetrics {
  attemptedCount: number;
  resolvedCount: number;
  verifiedPriceCount: number;
  manualPriceCount: number;
  noInventoryCount: number;
  reviewCount: number;
  technicalFailureCount: number;
  reliabilityPct: number;
  level: ProviderReliabilityLevel;
  errorCounts: Partial<Record<BenchmarkErrorCode, number>>;
  queryAttemptCount: number;
  queryResponseCount: number;
  queryCompletedCount: number;
  queryPartialCount: number;
  queryFailureCount: number;
  queryNotRunCount: number;
  queryReliabilityPct: number;
  queryLevel: ProviderReliabilityLevel;
}

export interface ProviderReliabilitySummary extends ReliabilityMetrics {
  providerKey: OtaKey;
  providerName: string;
}

export interface HotelReliabilitySummary extends ReliabilityMetrics {
  hotelKey: HotelKey;
  hotelName: string;
}

export type CellTone =
  "muted" | "risk" | "soft-risk" | "parity" | "premium" | "strong-premium";

export interface BenchmarkCell {
  providerKey: OtaKey;
  providerName: string;
  providerShortName: string;
  scrapedPrice: number | null;
  conversion?: CurrencyConversion;
  referencePrice: number | null;
  differencePct: number | null;
  status: ProviderQuote["status"];
  tone: CellTone;
  dataMode: CollectionMode;
  sourceHint: string;
  reason?: string;
  offerDescription?: string;
  offerConditions?: string;
  captureMethod?: ProviderQuote["captureMethod"];
  observedAt?: string;
  roomFeatures?: RoomFeatures;
  terms?: OfferTerms;
  errorCode?: BenchmarkErrorCode | null;
}

export interface BenchmarkWindowRow {
  roomId: string;
  roomName: string;
  occupancyLabel: string;
  referencePrice: number | null;
  entries: BenchmarkCell[];
}

export interface BenchmarkWindowResult extends BenchmarkWindowDefinition {
  rows: BenchmarkWindowRow[];
  alternativeOffers?: CollectedOffer[];
}

export interface BenchmarkScopeResult {
  id: ScopeKey;
  label: string;
  hotelKey: HotelKey;
  hotelName: string;
  hotelShortCode?: string;
  marketLabel: string;
  currency: CurrencyCode;
  notes?: string;
  providers: ProviderDescriptor[];
  windows: BenchmarkWindowResult[];
  stats: {
    parityRiskCount: number;
    premiumCount: number;
    missingCount: number;
    averageSpreadPct: number | null;
  };
}

export interface ProviderWin {
  providerKey: OtaKey;
  providerName: string;
  wins: number;
}

export interface BenchmarkCustomWindowInput {
  checkIn: string;
  checkOut: string;
}

export interface BenchmarkRunSummary {
  scopeCount: number;
  providerCount: number;
  availableRateCount: number;
  expectedRateCount: number;
  coveragePct: number;
  parityRiskCount: number;
  premiumCount: number;
  missingCount: number;
  cheapestProviderWins: ProviderWin[];
  alternativeOfferCount?: number;
  secondaryOfferCount?: number;
}

export interface BenchmarkRequest {
  mode: CollectionMode;
  providerKeys: OtaKey[];
  scopeKeys: ScopeKey[];
  customWindow?: BenchmarkCustomWindowInput;
}

export interface BenchmarkRunResult {
  runId: string;
  generatedAt: string;
  mode: CollectionMode;
  warnings: string[];
  providers: ProviderDescriptor[];
  scopes: BenchmarkScopeResult[];
  summary: BenchmarkRunSummary;
  reliability?: ProviderReliabilitySummary[];
  hotelReliability?: HotelReliabilitySummary[];
  collectionAttempts?: CollectionAttempt[];
  validationFunnel?: ValidationFunnelStageSummary[];
  collectionDiagnostics?: ProviderCollectionDiagnostics[];
  hotelPrices?: HotelPriceObservation[];
  secondaryOffers?: SecondaryOffer[];
  browserOffers?: BrowserImportedOffer[];
  collectionMethod?: "browser-import";
}

// Metasearch prices are hotel-level observations, never room comparison cells.
export interface HotelPriceObservation {
  scopeKey: ScopeKey;
  windowId: string;
  providerKey: OtaKey;
  providerName: string;
  price: number;
  currency: CurrencyCode;
  source: "google-hotels";
  collectedVia?: "serpapi";
  sourceUrl: string;
  offerUrl: string;
  observedAt: string;
}
