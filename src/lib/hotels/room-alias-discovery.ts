import type {
  BenchmarkRunResult,
  OtaKey,
  ScopeKey,
} from "@/src/lib/benchmark/types";
import { OTA_PROVIDERS } from "@/src/lib/ota/registry";
import { resolveRoomMatch } from "@/src/lib/ota/offer-matching";
import { runBenchmarkJob } from "@/src/lib/ota/run-benchmark";
import type { ManagedHotelRecord } from "./model";
import {
  addDynamicScopesToProviders,
  buildDynamicHotelRuntimeManifest,
  type DynamicHotelRuntimeManifest,
  type DynamicOtaCollectorConfig,
} from "./runtime-manifest";

export interface RoomAliasDiscoveryResult {
  aliasesByRoom: Record<string, string[]>;
  unassigned: string[];
  warnings: string[];
}

type DiscoveryRunner = typeof runBenchmarkJob;

function date(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)))
    throw new Error(`${label} geçerli bir tarih olmalıdır.`);
  return value;
}

function discoveryContext(manifest: DynamicHotelRuntimeManifest) {
  const configsFor = (providerKey: OtaKey) =>
    (manifest.collectorConfigs[providerKey] ?? {}) as Record<
      string,
      DynamicOtaCollectorConfig
    >;
  return {
    catalog: manifest.scopes,
    providers: addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]),
    manifestWarnings: [],
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

function discoveryManifest(hotel: ManagedHotelRecord, mappingId: string) {
  if (hotel.source !== "user") throw new Error("Sistem otellerinde oda adı keşfi yapılamaz.");
  if (!hotel.matchingPolicy) throw new Error("Önce oda eşleştirme politikasını kaydedin.");
  const mapping = hotel.channelMappings.find((candidate) => candidate.id === mappingId);
  if (!mapping) throw new Error("Kanal eşleştirmesi bulunamadı.");
  const market = hotel.markets.find((candidate) => candidate.id === mapping.marketId);
  if (!market) throw new Error("Kanalın pazarı bulunamadı.");

  const placeholderAliases = Object.fromEntries(
    Object.values(hotel.matchingPolicy.roomByView)
      .filter((roomId): roomId is string => Boolean(roomId))
      .map((roomId) => [
        roomId,
        [hotel.rooms.find((room) => room.id === roomId)?.name ?? roomId],
      ]),
  );
  return buildDynamicHotelRuntimeManifest({
    ...hotel,
    status: "ready",
    markets: [market],
    channelMappings: [
      {
        ...mapping,
        status: "configured",
        configurationCheckedAt: new Date().toISOString(),
        roomAliases: placeholderAliases,
      },
    ],
  });
}

export function assignDiscoveredRoomNames(
  hotel: ManagedHotelRecord,
  scope: DynamicHotelRuntimeManifest["scopes"][number],
  roomNames: readonly string[],
): Pick<RoomAliasDiscoveryResult, "aliasesByRoom" | "unassigned"> {
  const aliasesByRoom: Record<string, string[]> = {};
  const unassigned: string[] = [];
  for (const roomName of [...new Set(roomNames.map((name) => name.trim()).filter(Boolean))]) {
    const match = resolveRoomMatch(scope, roomName, {}, "", hotel.matchingPolicy);
    if (match.matchedRoomId) {
      (aliasesByRoom[match.matchedRoomId] ??= []).push(roomName);
    } else {
      unassigned.push(roomName);
    }
  }
  return { aliasesByRoom, unassigned };
}

export async function discoverRoomAliases(
  hotel: ManagedHotelRecord,
  mappingId: string,
  input: { checkIn: string; checkOut: string },
  runner: DiscoveryRunner = runBenchmarkJob,
): Promise<RoomAliasDiscoveryResult> {
  const checkIn = date(input.checkIn, "Giriş tarihi");
  const checkOut = date(input.checkOut, "Çıkış tarihi");
  const nights = Math.round(
    (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) /
      86_400_000,
  );
  if (nights < 1 || nights > 28) throw new Error("Konaklama süresi 1-28 gece olmalıdır.");

  const manifest = discoveryManifest(hotel, mappingId);
  const mapping = hotel.channelMappings.find((candidate) => candidate.id === mappingId)!;
  const scope = manifest.scopes[0];
  const report: BenchmarkRunResult = await runner(
    {
      mode: "live",
      providerKeys: [mapping.providerKey as OtaKey],
      scopeKeys: [scope.id as ScopeKey],
      customWindow: { checkIn, checkOut },
    },
    undefined,
    discoveryContext(manifest),
  );
  const resultScope = report.scopes.find((candidate) => candidate.id === scope.id);
  const resultWindow = resultScope?.windows[0];
  const roomNames = [
    ...(resultWindow?.alternativeOffers?.map((offer) => offer.roomName) ?? []),
    ...(resultWindow?.rows.flatMap((row) =>
      row.entries.flatMap((entry) => entry.offerDescription ? [entry.offerDescription] : []),
    ) ?? []),
  ];
  const assigned = assignDiscoveredRoomNames(hotel, scope, roomNames);
  return {
    ...assigned,
    warnings: report.warnings,
  };
}
