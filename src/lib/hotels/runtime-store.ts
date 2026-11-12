import { REPORT_SCOPES } from "@/src/lib/benchmark/sample-data";
import type {
  ProviderDescriptor,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";
import { OTA_PROVIDERS } from "@/src/lib/ota/registry";
import { createFileHotelStore, type HotelStore } from "./file-store";
import {
  addDynamicScopesToProviders,
  buildDynamicHotelRuntimeManifest,
  type DynamicOtaCollectorConfig,
  type DynamicHotelRuntimeManifest,
} from "./runtime-manifest";

export interface DynamicHotelRuntimeContext {
  manifests: DynamicHotelRuntimeManifest[];
  manifestWarnings: string[];
  scopes: ReportScopeDefinition[];
  catalog: ReportScopeDefinition[];
  providers: ProviderDescriptor[];
  anextourConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  bookingConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  check24Configs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  coraltravelConfigs?: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  dertourConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  expediaConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  holidaycheckConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  loveholidaysConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  onthebeachConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  pegastourConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  restplatzboerseConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  schauinslandConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  stayforlongConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  tuiConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
}

export async function loadDynamicHotelRuntimeContext(
  store: HotelStore = createFileHotelStore(),
): Promise<DynamicHotelRuntimeContext> {
  const activeHotels = (await store.load()).filter(
    (hotel) => hotel.source === "user" && hotel.status === "active",
  );
  const candidates: Array<{
    hotelName: string;
    manifest: DynamicHotelRuntimeManifest;
  }> = [];
  const manifestWarnings: string[] = [];
  for (const hotel of activeHotels) {
    try {
      candidates.push({
        hotelName: hotel.name,
        manifest: buildDynamicHotelRuntimeManifest(hotel),
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Bilinmeyen runtime manifest hatası.";
      manifestWarnings.push(
        `${hotel.name} çalışma zamanı yapılandırması geçersiz olduğu için sorguya dahil edilmedi: ${detail}`,
      );
    }
  }
  const staticScopeIds = new Set(REPORT_SCOPES.map((scope) => scope.id));
  const dynamicScopeOwners = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const scope of candidate.manifest.scopes) {
      const owners = dynamicScopeOwners.get(scope.id) ?? [];
      owners.push(candidate.hotelName);
      dynamicScopeOwners.set(scope.id, owners);
    }
  }
  const manifests = candidates.flatMap((candidate) => {
    const conflictingScopeIds = candidate.manifest.scopes
      .map((scope) => scope.id)
      .filter(
        (scopeId) =>
          staticScopeIds.has(scopeId) ||
          (dynamicScopeOwners.get(scopeId)?.length ?? 0) > 1,
      );
    if (conflictingScopeIds.length === 0) return [candidate.manifest];
    manifestWarnings.push(
      `${candidate.hotelName} çalışma zamanı yapılandırması, başka bir otelle çakışan pazar anahtarı nedeniyle sorguya dahil edilmedi: ${conflictingScopeIds.join(", ")}`,
    );
    return [];
  });
  const scopes = manifests.flatMap((manifest) => manifest.scopes);
  const configsFor = (
    providerKey:
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
      | "schauinsland"
      | "stayforlong"
      | "tui",
  ) =>
    Object.assign(
      {},
      ...manifests.map(
        (manifest) => manifest.collectorConfigs[providerKey] ?? {},
      ),
    ) as Record<string, DynamicOtaCollectorConfig>;
  return {
    manifests,
    manifestWarnings,
    scopes,
    catalog: [...REPORT_SCOPES, ...scopes],
    providers: addDynamicScopesToProviders(OTA_PROVIDERS, manifests),
    anextourConfigs: configsFor("anextour"),
    bookingConfigs: configsFor("booking"),
    check24Configs: configsFor("check24"),
    coraltravelConfigs: configsFor("coraltravel"),
    dertourConfigs: configsFor("dertour"),
    expediaConfigs: configsFor("expedia"),
    holidaycheckConfigs: configsFor("holidaycheck"),
    loveholidaysConfigs: configsFor("loveholidays"),
    onthebeachConfigs: configsFor("onthebeach"),
    pegastourConfigs: configsFor("pegastour"),
    restplatzboerseConfigs: configsFor("restplatzboerse"),
    schauinslandConfigs: configsFor("schauinsland"),
    stayforlongConfigs: configsFor("stayforlong"),
    tuiConfigs: configsFor("tui"),
  };
}
