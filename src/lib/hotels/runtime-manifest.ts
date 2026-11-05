import type {
  HotelKey,
  OtaKey,
  ProviderDescriptor,
  ReportScopeDefinition,
  ScopeKey,
} from "@/src/lib/benchmark/types";
import type { ManagedHotelRecord } from "./model";

export const DYNAMIC_COLLECTOR_PROVIDERS = [
  "booking",
  "check24",
  "expedia",
  "holidaycheck",
  "tui",
] as const satisfies readonly OtaKey[];

export interface DynamicTuiCollectorSettings {
  giataId: number;
  offerSlug: string;
  market: "de";
  locale: "de-DE";
  hotelId: string;
}

export interface DynamicOtaCollectorConfig {
  pageUrl: string;
  searchQuery?: string;
  cardName?: string;
  roomAliases: Readonly<Record<string, readonly string[]>>;
  matchingPolicy?: NonNullable<ManagedHotelRecord["matchingPolicy"]>;
  tui?: DynamicTuiCollectorSettings;
  check24?: {
    hotelId: string;
    hotelName: string;
    accommodationId?: string;
    accommodationSlug?: string;
  };
}

export interface DynamicHotelRuntimeManifest {
  hotelId: string;
  hotelKey: string;
  scopes: ReportScopeDefinition[];
  collectorConfigs: Readonly<
    Partial<Record<OtaKey, Readonly<Record<string, DynamicOtaCollectorConfig>>>>
  >;
}

export class DynamicHotelRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DynamicHotelRuntimeError";
  }
}

function occupancyLabel(hotel: ManagedHotelRecord, roomId: string): string {
  const room = hotel.rooms.find((candidate) => candidate.id === roomId)!;
  const childLabel = room.occupancy.children
    ? ` · ${room.occupancy.children} çocuk`
    : "";
  return `${room.occupancy.rooms} oda · ${room.occupancy.adults} yetişkin${childLabel}`;
}

function verifiedSupportedMappings(
  hotel: ManagedHotelRecord,
  marketId: string,
) {
  return hotel.channelMappings.filter(
    (mapping) =>
      mapping.marketId === marketId &&
      DYNAMIC_COLLECTOR_PROVIDERS.some(
        (providerKey) => providerKey === mapping.providerKey,
      ) &&
      mapping.status === "verified" &&
      Boolean(mapping.verifiedAt),
  );
}

function hasExecutablePageUrl(providerKey: string, pageUrl: string): boolean {
  if (providerKey === "expedia") return /\.h\d+\./i.test(pageUrl);
  if (providerKey === "holidaycheck")
    return /^https:\/\/www\.holidaycheck\.de\/hi\/[^/]+\/[a-f0-9-]+\/?$/i.test(
      pageUrl,
    );
  if (providerKey === "tui")
    return /^https:\/\/(?:www\.)?tui\.com\//i.test(pageUrl);
  if (providerKey === "check24")
    return /^https:\/\/[^/]*check24\.de\//i.test(pageUrl);
  return providerKey === "booking";
}

function check24Accommodation(pageUrl: string) {
  const match = new URL(pageUrl).pathname.match(
    /^\/accommodation\/(.+)-([a-f0-9]{32})\/?$/i,
  );
  return match
    ? { accommodationSlug: match[1], accommodationId: match[2] }
    : {};
}

function tuiOfferSlug(pageUrl: string, hotelName: string, giataId: number) {
  const pathCandidate = new URL(pageUrl).pathname
    .split("/")
    .filter(Boolean)
    .find((part) => part.toLowerCase().includes(String(giataId)));
  const withoutId = pathCandidate?.replace(
    new RegExp(`[-_]?${giataId}(?:[-_].*)?$`, "i"),
    "",
  );
  const source = withoutId || hotelName;
  const slug = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^hotel-/i.test(slug) ? slug : `Hotel-${slug}`;
}

export function buildDynamicHotelRuntimeManifest(
  hotel: ManagedHotelRecord,
): DynamicHotelRuntimeManifest {
  if (hotel.source !== "user")
    throw new DynamicHotelRuntimeError(
      "Yalnızca kullanıcı otelleri dinamik collector manifestine dönüştürülebilir.",
    );
  if (hotel.status !== "ready" && hotel.status !== "active")
    throw new DynamicHotelRuntimeError(
      "Dinamik collector manifesti yalnızca Hazır veya Aktif otellerden üretilebilir.",
    );
  if (!hotel.matchingPolicy)
    throw new DynamicHotelRuntimeError("Oda eşleştirme politikası eksik.");

  const requiredRoomIds = new Set(hotel.rooms.map((room) => room.id));
  const collectorConfigs: Partial<
    Record<OtaKey, Record<string, DynamicOtaCollectorConfig>>
  > = {};

  for (const market of hotel.markets) {
    let executableCount = 0;
    for (const mapping of verifiedSupportedMappings(hotel, market.id)) {
      if (
        !mapping.pageUrl ||
        !hasExecutablePageUrl(mapping.providerKey, mapping.pageUrl)
      )
        continue;
      const tuiGiataId =
        mapping.providerKey === "tui" && market.currency === "EUR"
          ? Number(mapping.externalHotelId)
          : undefined;
      if (
        mapping.providerKey === "tui" &&
        (!Number.isSafeInteger(tuiGiataId) || (tuiGiataId ?? 0) <= 0)
      )
        continue;
      const check24HotelId =
        mapping.providerKey === "check24" && market.currency === "EUR"
          ? mapping.externalHotelId
          : undefined;
      if (
        mapping.providerKey === "check24" &&
        (!check24HotelId || !/^\d+$/.test(check24HotelId))
      )
        continue;
      if (
        [...requiredRoomIds].some(
          (roomId) => (mapping.roomAliases[roomId]?.length ?? 0) === 0,
        )
      )
        continue;
      const providerConfigs = (collectorConfigs[
        mapping.providerKey as OtaKey
      ] ??= {});
      providerConfigs[market.id] = {
        pageUrl: mapping.pageUrl,
        searchQuery: mapping.searchName ?? hotel.name,
        cardName: mapping.searchName ?? hotel.name,
        roomAliases: mapping.roomAliases,
        matchingPolicy: hotel.matchingPolicy,
        ...(mapping.providerKey === "tui"
          ? {
              tui: {
                giataId: tuiGiataId!,
                offerSlug: tuiOfferSlug(
                  mapping.pageUrl,
                  hotel.name,
                  tuiGiataId!,
                ),
                market: "de" as const,
                locale: "de-DE" as const,
                hotelId: String(tuiGiataId),
              },
            }
          : {}),
        ...(mapping.providerKey === "check24"
          ? {
              check24: {
                hotelId: check24HotelId!,
                hotelName: mapping.searchName ?? hotel.name,
                ...check24Accommodation(mapping.pageUrl),
              },
            }
          : {}),
      };
      executableCount += 1;
    }
    if (executableCount === 0)
      throw new DynamicHotelRuntimeError(
        `${market.label} için Booking.com, CHECK24 (EUR), Expedia, HolidayCheck veya TUI (EUR) kanallarından doğrulanmış sayfa adresi ve tüm oda alias'larını içeren çalıştırılabilir bir eşleştirme eksik.`,
      );
  }

  const rooms = hotel.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    occupancyLabel: occupancyLabel(hotel, room.id),
    referenceRates: {},
  }));
  const scopes = hotel.markets.map(
    (market): ReportScopeDefinition => ({
      // Runtime IDs are validated branded strings. The benchmark engine is
      // string-keyed at runtime; this is the only bridge to its legacy unions.
      id: market.id as unknown as ScopeKey,
      label: market.label,
      hotelKey: hotel.key as unknown as HotelKey,
      hotelName: hotel.name,
      hotelShortCode: hotel.shortCode,
      marketLabel: market.marketLabel,
      currency: market.currency,
      requiredBoard: market.requiredBoard,
      notes: market.notes,
      windows: [],
      rooms,
    }),
  );

  return {
    hotelId: hotel.id,
    hotelKey: hotel.key,
    scopes,
    collectorConfigs,
  };
}

export function addDynamicScopesToProviders(
  providers: readonly ProviderDescriptor[],
  manifests: readonly DynamicHotelRuntimeManifest[],
): ProviderDescriptor[] {
  return providers.map((provider) =>
    ({
      ...provider,
      supportedScopes: [
        ...provider.supportedScopes,
        ...manifests.flatMap((manifest) =>
          manifest.collectorConfigs[provider.key]
            ? manifest.scopes
                .filter(
                  (scope) =>
                    manifest.collectorConfigs[provider.key]?.[scope.id],
                )
                .map((scope) => scope.id)
            : [],
        ),
      ],
    }),
  );
}
