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
  bookingConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  check24Configs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  expediaConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
  holidaycheckConfigs: Readonly<Record<string, DynamicOtaCollectorConfig>>;
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
    providerKey: "booking" | "check24" | "expedia" | "holidaycheck" | "tui",
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
    bookingConfigs: configsFor("booking"),
    check24Configs: configsFor("check24"),
    expediaConfigs: configsFor("expedia"),
    holidaycheckConfigs: configsFor("holidaycheck"),
    tuiConfigs: configsFor("tui"),
  };
}
