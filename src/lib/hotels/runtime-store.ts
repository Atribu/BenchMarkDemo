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
  scopes: ReportScopeDefinition[];
  catalog: ReportScopeDefinition[];
  providers: ProviderDescriptor[];
  anextourConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  bookingConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  check24Configs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  coraltravelConfigs?: Readonly<Record<string, DynamicOtaCollectorConfig>>;
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
  const manifests = (await store.load())
    .filter((hotel) => hotel.source === "user" && hotel.status === "active")
    .map(buildDynamicHotelRuntimeManifest);
  const scopes = manifests.flatMap((manifest) => manifest.scopes);
  const configsFor = (
    providerKey:
      | "anextour"
      | "booking"
      | "check24"
      | "coraltravel"
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
    scopes,
    catalog: [...REPORT_SCOPES, ...scopes],
    providers: addDynamicScopesToProviders(OTA_PROVIDERS, manifests),
    anextourConfigs: configsFor("anextour"),
    bookingConfigs: configsFor("booking"),
    check24Configs: configsFor("check24"),
    coraltravelConfigs: configsFor("coraltravel"),
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
