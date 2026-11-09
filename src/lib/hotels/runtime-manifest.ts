import type {
  HotelKey,
  OtaKey,
  ProviderDescriptor,
  ReportScopeDefinition,
  ScopeKey,
} from "@/src/lib/benchmark/types";
import type { ManagedHotelRecord } from "./model";

export const DYNAMIC_COLLECTOR_PROVIDERS = [
  "anextour",
  "booking",
  "check24",
  "coraltravel",
  "expedia",
  "holidaycheck",
  "loveholidays",
  "onthebeach",
  "pegastour",
  "restplatzboerse",
  "schauinsland",
  "stayforlong",
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
  schauinsland?: {
    giataId: string;
  };
  stayforlong?: {
    propertyId: number;
    slug: string;
    hotelName: string;
  };
  restplatzboerse?: {
    hotelIffCode: number;
    hotelName: string;
  };
  loveholidays?: {
    masterId: string;
  };
  onthebeach?: {
    propertyId: string;
    cardName: string;
    destination: string;
    cityName: string;
    regionNames: readonly string[];
  };
  anextour?:
    | {
        market: "de";
        accommodationId: string;
      }
    | {
        market: "ru";
        hotelId: string;
        hotelSlug: string;
      };
  pegastour?: {
    hotelId: number;
    hotelName: string;
  };
  coraltravel?:
    | {
        market: "de";
        giataId: string;
        searchQuery: string;
        suggestion: string;
      }
    | {
        market: "ru";
        hotelName: string;
        location: {
          id: string;
          requestId: string;
          friendlyUrl: string;
          parentId: string;
          parentName: string;
        };
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

function configuredSupportedMappings(
  hotel: ManagedHotelRecord,
  marketId: string,
) {
  return hotel.channelMappings.filter(
    (mapping) =>
      mapping.marketId === marketId &&
      DYNAMIC_COLLECTOR_PROVIDERS.some(
        (providerKey) => providerKey === mapping.providerKey,
      ) &&
      mapping.status === "configured" &&
      Boolean(mapping.configurationCheckedAt),
  );
}

function hasExecutablePageUrl(
  providerKey: string,
  pageUrl: string,
  currency: string,
): boolean {
  if (providerKey === "anextour") {
    try {
      const url = new URL(pageUrl);
      if (currency === "EUR")
        return (
          url.origin === "https://nurhotel.anextour.de" &&
          url.pathname === "/search/offer" &&
          /^\d+$/.test(url.searchParams.get("aid") ?? "")
        );
      if (currency === "RUB")
        return (
          url.origin === "https://anextour.ru" &&
          /^\/hotels\/turkey\/[^/?]+\/?$/i.test(url.pathname)
        );
      return false;
    } catch {
      return false;
    }
  }
  if (providerKey === "expedia") return /\.h\d+\./i.test(pageUrl);
  if (providerKey === "holidaycheck")
    return /^https:\/\/www\.holidaycheck\.de\/hi\/[^/]+\/[a-f0-9-]+\/?$/i.test(
      pageUrl,
    );
  if (providerKey === "tui")
    return /^https:\/\/(?:www\.)?tui\.com\//i.test(pageUrl);
  if (providerKey === "check24")
    return /^https:\/\/[^/]*check24\.de\//i.test(pageUrl);
  if (providerKey === "schauinsland")
    return /^https:\/\/www\.schauinsland-reisen\.de\/hotel\/\d+-[^/]+\/?$/i.test(
      pageUrl,
    );
  if (providerKey === "stayforlong")
    return /^https:\/\/www\.stayforlong\.de\/de-de\/hotel\/tr\/[^/?]+\/?$/i.test(
      pageUrl,
    );
  if (providerKey === "restplatzboerse")
    return /^https:\/\/www\.restplatzboerse\.at\/hotel\/\d+\/?$/i.test(
      pageUrl,
    );
  if (providerKey === "loveholidays") {
    try {
      const url = new URL(pageUrl);
      const expectedPath =
        currency === "EUR" ? "/de/hotels/l/" : "/hotels/l/";
      return (
        (currency === "EUR" || currency === "GBP") &&
        url.origin === "https://www.loveholidays.com" &&
        url.pathname === expectedPath &&
        /^\d+$/.test(url.searchParams.get("masterId") ?? "")
      );
    } catch {
      return false;
    }
  }
  if (providerKey === "onthebeach") {
    try {
      const url = new URL(pageUrl);
      return (
        currency === "GBP" &&
        url.origin === "https://www.onthebeach.co.uk" &&
        /^\/hotels\/turkey\/antalya\/(?:[^/?]+\/)*[^/?]+\/?$/i.test(
          url.pathname,
        )
      );
    } catch {
      return false;
    }
  }
  if (providerKey === "pegastour") {
    try {
      const url = new URL(pageUrl);
      return (
        currency === "RUB" &&
        url.origin === "https://pegast.ru" &&
        /^\/hotel\/turkey\/(?:[^/?]+\/)+[^/?]+-\d+\/?$/i.test(
          url.pathname,
        )
      );
    } catch {
      return false;
    }
  }
  if (providerKey === "coraltravel") {
    try {
      const url = new URL(pageUrl);
      if (currency === "EUR")
        return (
          url.origin === "https://coraltravel.de" &&
          /^\/hotels\/[^/?]+\/?$/i.test(url.pathname)
        );
      if (currency === "RUB")
        return (
          url.origin === "https://www.coral.ru" &&
          /^\/hotels\/turkey\/(?:[^/?]+\/)*[^/?]+\/?$/i.test(url.pathname)
        );
      return false;
    } catch {
      return false;
    }
  }
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

function stayforlongSlug(pageUrl: string) {
  return new URL(pageUrl).pathname.match(/^\/de-de\/hotel\/tr\/([^/]+)\/?$/i)?.[1];
}

function anexRuHotelSlug(pageUrl: string) {
  return new URL(pageUrl).pathname.match(
    /^\/hotels\/turkey\/([^/]+)\/?$/i,
  )?.[1];
}

function pegasHotelId(pageUrl: string) {
  const match = new URL(pageUrl).pathname.match(/-(\d+)\/?$/);
  return match ? Number(match[1]) : undefined;
}

function coralRuLocation(pageUrl: string, externalHotelId: string) {
  const parts = /^(\d+)-7-(\d+)-6$/.exec(externalHotelId);
  const friendlyUrl = new URL(pageUrl).pathname
    .replace(/^\/hotels\//i, "")
    .replace(/\/$/, "");
  return parts
    ? {
        id: `${parts[1]}-7`,
        requestId: externalHotelId,
        friendlyUrl,
        parentId: parts[2],
      }
    : undefined;
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

  const requiredRoomIds = new Set(
  Object.values(hotel.matchingPolicy.roomByView)
    .filter((roomId): roomId is string => Boolean(roomId))
);

  const collectorConfigs: Partial<
    Record<OtaKey, Record<string, DynamicOtaCollectorConfig>>
  > = {};

  for (const market of hotel.markets) {
    let executableCount = 0;

    console.log("[DynamicManifest] Mapping diagnostics:", {
  hotel: hotel.key,
  market: market.id,
  currency: market.currency,

  mappings: hotel.channelMappings
    .filter((mapping) => mapping.marketId === market.id)
    .map((mapping) => ({
      provider: mapping.providerKey,
      status: mapping.status,
      configurationCheckedAt: mapping.configurationCheckedAt,
      externalHotelId: mapping.externalHotelId,
      pageUrl: mapping.pageUrl,
      roomAliases: mapping.roomAliases,
    })),
});

    for (const mapping of configuredSupportedMappings(hotel, market.id)) {
      if (
        !mapping.pageUrl ||
        !hasExecutablePageUrl(
          mapping.providerKey,
          mapping.pageUrl,
          market.currency,
        )
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
      const schauinslandGiataId =
        mapping.providerKey === "schauinsland" && market.currency === "EUR"
          ? mapping.externalHotelId
          : undefined;
      if (
        mapping.providerKey === "schauinsland" &&
        (!schauinslandGiataId || !/^\d+$/.test(schauinslandGiataId))
      )
        continue;
      const stayforlongPropertyId =
        mapping.providerKey === "stayforlong" && market.currency === "EUR"
          ? Number(mapping.externalHotelId)
          : undefined;
      const stayforlongPageSlug =
        mapping.providerKey === "stayforlong"
          ? stayforlongSlug(mapping.pageUrl)
          : undefined;
      if (
        mapping.providerKey === "stayforlong" &&
        (!Number.isSafeInteger(stayforlongPropertyId) ||
          (stayforlongPropertyId ?? 0) <= 0 ||
          !stayforlongPageSlug)
      )
        continue;
      const restplatzboerseHotelIffCode =
        mapping.providerKey === "restplatzboerse" && market.currency === "EUR"
          ? Number(mapping.externalHotelId)
          : undefined;
      if (
        mapping.providerKey === "restplatzboerse" &&
        (!Number.isSafeInteger(restplatzboerseHotelIffCode) ||
          (restplatzboerseHotelIffCode ?? 0) <= 0)
      )
        continue;
      const loveholidaysMasterId =
        mapping.providerKey === "loveholidays" &&
        (market.currency === "EUR" || market.currency === "GBP")
          ? mapping.externalHotelId
          : undefined;
      if (
        mapping.providerKey === "loveholidays" &&
        (!loveholidaysMasterId ||
          !/^\d+$/.test(loveholidaysMasterId) ||
          new URL(mapping.pageUrl).searchParams.get("masterId") !==
            loveholidaysMasterId)
      )
        continue;
      const onthebeachPropertyId =
        mapping.providerKey === "onthebeach" && market.currency === "GBP"
          ? mapping.externalHotelId
          : undefined;
      if (
        mapping.providerKey === "onthebeach" &&
        (!onthebeachPropertyId || !/^\d+$/.test(onthebeachPropertyId))
      )
        continue;
      const anexExternalHotelId =
        mapping.providerKey === "anextour" &&
        (market.currency === "EUR" || market.currency === "RUB")
          ? mapping.externalHotelId
          : undefined;
      const anexRuSlug =
        mapping.providerKey === "anextour" && market.currency === "RUB"
          ? anexRuHotelSlug(mapping.pageUrl)
          : undefined;
      if (
        mapping.providerKey === "anextour" &&
        (hotel.location.countryCode !== "TR" ||
          !anexExternalHotelId ||
          !/^\d+$/.test(anexExternalHotelId) ||
          (market.currency === "EUR" &&
            new URL(mapping.pageUrl).searchParams.get("aid") !==
              anexExternalHotelId) ||
          (market.currency === "RUB" && !anexRuSlug))
      )
        continue;
      const pegastourHotelId =
        mapping.providerKey === "pegastour" && market.currency === "RUB"
          ? Number(mapping.externalHotelId)
          : undefined;
      if (
        mapping.providerKey === "pegastour" &&
        (hotel.location.countryCode !== "TR" ||
          !Number.isSafeInteger(pegastourHotelId) ||
          (pegastourHotelId ?? 0) <= 0 ||
          pegasHotelId(mapping.pageUrl) !== pegastourHotelId)
      )
        continue;
      const coralGiataId =
        mapping.providerKey === "coraltravel" && market.currency === "EUR"
          ? mapping.externalHotelId
          : undefined;
      const coralRu =
        mapping.providerKey === "coraltravel" &&
        market.currency === "RUB" &&
        mapping.externalHotelId
          ? coralRuLocation(mapping.pageUrl, mapping.externalHotelId)
          : undefined;
      if (
        mapping.providerKey === "coraltravel" &&
        (hotel.location.countryCode !== "TR" ||
          (market.currency === "EUR" &&
            (!coralGiataId || !/^\d+$/.test(coralGiataId))) ||
          (market.currency === "RUB" && !coralRu) ||
          (market.currency !== "EUR" && market.currency !== "RUB"))
      )
        continue;
     const hasMappedRoomAlias = [...requiredRoomIds].some(
  (roomId) =>
    (mapping.roomAliases[roomId]?.length ?? 0) > 0
);

if (!hasMappedRoomAlias) {
  continue;
}
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
        ...(mapping.providerKey === "schauinsland"
          ? {
              schauinsland: {
                giataId: schauinslandGiataId!,
              },
            }
          : {}),
        ...(mapping.providerKey === "stayforlong"
          ? {
              stayforlong: {
                propertyId: stayforlongPropertyId!,
                slug: stayforlongPageSlug!,
                hotelName: mapping.searchName ?? hotel.name,
              },
            }
          : {}),
        ...(mapping.providerKey === "restplatzboerse"
          ? {
              restplatzboerse: {
                hotelIffCode: restplatzboerseHotelIffCode!,
                hotelName: mapping.searchName ?? hotel.name,
              },
            }
          : {}),
        ...(mapping.providerKey === "loveholidays"
          ? {
              loveholidays: {
                masterId: loveholidaysMasterId!,
              },
            }
          : {}),
        ...(mapping.providerKey === "onthebeach"
          ? {
              onthebeach: {
                propertyId: onthebeachPropertyId!,
                cardName: mapping.searchName ?? hotel.name,
                destination:
                  "Antalya (Alanya, Belek, Lara Beach, Side), Turkey",
                cityName: hotel.location.city,
                regionNames:
                  hotel.location.region
                    ?.split(/[\/,]/)
                    .map((region) => region.trim())
                    .filter(Boolean) ?? [],
              },
            }
          : {}),
        ...(mapping.providerKey === "anextour"
          ? {
              anextour:
                market.currency === "EUR"
                  ? {
                      market: "de" as const,
                      accommodationId: anexExternalHotelId!,
                    }
                  : {
                      market: "ru" as const,
                      hotelId: anexExternalHotelId!,
                      hotelSlug: anexRuSlug!,
                    },
            }
          : {}),
        ...(mapping.providerKey === "pegastour"
          ? {
              pegastour: {
                hotelId: pegastourHotelId!,
                hotelName: mapping.searchName ?? hotel.name,
              },
            }
          : {}),
        ...(mapping.providerKey === "coraltravel"
          ? {
              coraltravel:
                market.currency === "EUR"
                  ? {
                      market: "de" as const,
                      giataId: coralGiataId!,
                      searchQuery: mapping.searchName ?? hotel.name,
                      suggestion: mapping.searchName ?? hotel.name,
                    }
                  : {
                      market: "ru" as const,
                      hotelName: mapping.searchName ?? hotel.name,
                      location: {
                        ...coralRu!,
                        parentName: `${hotel.location.city}, ${hotel.location.countryCode}`,
                      },
                    },
            }
          : {}),
      };
      executableCount += 1;
    }
    if (executableCount === 0)
      throw new DynamicHotelRuntimeError(
        `${market.label} için ANEX Tour (EUR/RUB), Booking.com, CHECK24 (EUR), Coral Travel (EUR/RUB), Expedia, HolidayCheck, Loveholidays (EUR/GBP), On the Beach (GBP/Antalya), PEGAS Touristik (RUB), Restplatzbörse (EUR), Schauinsland (EUR), Stayforlong (EUR) veya TUI (EUR) kanallarından doğrulanmış sayfa adresi ve tüm oda alias'larını içeren çalıştırılabilir bir eşleştirme eksik.`,
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
