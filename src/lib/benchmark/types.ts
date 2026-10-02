export type CollectionMode = "mock" | "live";
export type CurrencyCode = "EUR" | "GBP";
export type HotelKey = "miramare-beach" | "miramare-queen";
export type ScopeKey = "beach-eu" | "beach-uk" | "queen-eu" | "queen-uk";
export type ScopeProviderSelection = Partial<Record<ScopeKey, OtaKey[]>>;
export type OtaKey =
  | "booking"
  | "expedia"
  | "hotelbeds"
  | "holidaycheck"
  | "loveholidays"
  | "onthebeach"
  | "tui";

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
  marketLabel: string;
  currency: CurrencyCode;
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
}

export interface ProviderCollectionResult {
  quotes: ProviderQuote[];
  warnings: string[];
  offers?: CollectedOffer[];
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

export type CellTone =
  "muted" | "risk" | "soft-risk" | "parity" | "premium" | "strong-premium";

export interface BenchmarkCell {
  providerKey: OtaKey;
  providerName: string;
  providerShortName: string;
  scrapedPrice: number | null;
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
