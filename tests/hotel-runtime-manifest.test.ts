import test from "node:test";
import assert from "node:assert/strict";
import { parseBenchmarkRequest } from "../src/lib/benchmark/request";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import { runBenchmarkJob } from "../src/lib/ota/run-benchmark";
import { parseHolidayCheckOffers } from "../src/lib/ota/live-holidaycheck";
import { collectTuiLiveQuotes } from "../src/lib/ota/live-tui";
import { validateDynamicCheck24Offer } from "../src/lib/ota/live-check24-provider";
import { buildSchauinslandCollectedOffers } from "../src/lib/ota/live-schauinsland";
import { applyDynamicStayforlongRoomMatch } from "../src/lib/ota/live-stayforlong";
import { applyDynamicRestplatzboerseRoomMatch } from "../src/lib/ota/live-restplatzboerse";
import {
  buildLoveholidaysUrl,
  parseLoveholidaysOffers,
} from "../src/lib/ota/live-loveholidays";
import {
  parseOnTheBeachOffers,
  resolveOnTheBeachCardName,
  resolveOnTheBeachPropertyId,
} from "../src/lib/ota/live-onthebeach";
import { matchAnexRoom } from "../src/lib/ota/live-anextour";
import { matchPegasRuntimeRoom } from "../src/lib/ota/live-pegastour";
import { matchCoralRuntimeRoom } from "../src/lib/ota/live-coraltravel";
import {
  parseRuntimeHotelId,
  parseRuntimeHotelKey,
  parseRuntimeScopeKey,
} from "../src/lib/hotels/identifiers";
import type { HotelStore } from "../src/lib/hotels/file-store";
import { createHotelDraft, type ManagedHotelRecord } from "../src/lib/hotels/model";
import { loadDynamicHotelRuntimeContext } from "../src/lib/hotels/runtime-store";
import {
  addDynamicScopesToProviders,
  buildDynamicHotelRuntimeManifest,
  DynamicHotelRuntimeError,
} from "../src/lib/hotels/runtime-manifest";

function readyHotel(
  mappingOverrides: Partial<ManagedHotelRecord["channelMappings"][number]> = {},
): ManagedHotelRecord {
  const marketId = parseRuntimeScopeKey("example-eu");
  return {
    ...createHotelDraft({
      id: "hotel_runtime_01",
      key: "example-resort",
      name: "Example Resort",
      shortCode: "ER",
      location: { countryCode: "TR", city: "Antalya" },
      createdBy: "creator",
      now: "2026-11-05T09:00:00.000Z",
    }),
    status: "ready",
    markets: [
      {
        id: marketId,
        label: "Example Avrupa Benchmark",
        marketLabel: "Avrupa",
        currency: "EUR",
        requiredBoard: "all-inclusive",
      },
    ],
    rooms: [
      {
        id: "standard-land",
        name: "Standart Kara Manzaralı",
        occupancy: { rooms: 1, adults: 2, children: 0 },
      },
    ],
    matchingPolicy: {
      category: "standard",
      requireBalcony: false,
      roomByView: { land: "standard-land" },
    },
    channelMappings: [
      {
        id: "mapping_runtime_01",
        providerKey: "booking",
        marketId,
        status: "configured",
        pageUrl: "https://www.booking.com/hotel/tr/example-resort.html",
        searchName: "Example Resort",
        roomAliases: { "standard-land": ["Standard Room with Land View"] },
        configurationCheckedAt: "2026-11-05T09:30:00.000Z",
        ...mappingOverrides,
      },
    ],
  };
}

function activeHotelWithMarket(
  hotel: ManagedHotelRecord,
  input: { id: string; key: string; name: string; marketId: string },
): ManagedHotelRecord {
  const marketId = parseRuntimeScopeKey(input.marketId);
  return {
    ...hotel,
    id: parseRuntimeHotelId(input.id),
    key: parseRuntimeHotelKey(input.key),
    name: input.name,
    status: "active",
    markets: hotel.markets.map((market) => ({ ...market, id: marketId })),
    channelMappings: hotel.channelMappings.map((mapping) => ({
      ...mapping,
      marketId,
    })),
  };
}

function readOnlyHotelStore(hotels: ManagedHotelRecord[]): HotelStore {
  return {
    load: async () => hotels,
    update: async () => {
      throw new Error("Test store is read-only.");
    },
  };
}

test("verified Booking mappings become an executable runtime manifest", () => {
  const manifest = buildDynamicHotelRuntimeManifest(readyHotel());
  assert.equal(manifest.scopes.length, 1);
  assert.equal(manifest.scopes[0].id, "example-eu");
  assert.equal(manifest.scopes[0].hotelKey, "example-resort");
  assert.equal(manifest.scopes[0].hotelShortCode, "ER");
  assert.equal(manifest.scopes[0].rooms[0].occupancyLabel, "1 oda · 2 yetişkin");
  assert.equal(
    manifest.collectorConfigs.booking?.["example-eu"].pageUrl,
    "https://www.booking.com/hotel/tr/example-resort.html",
  );
  assert.deepEqual(
    manifest.collectorConfigs.booking?.["example-eu"].roomAliases[
      "standard-land"
    ],
    ["Standard Room with Land View"],
  );
});

test("an invalid active hotel is quarantined without hiding valid dynamic hotels", async () => {
  const validHotel: ManagedHotelRecord = {
    ...readyHotel(),
    status: "active",
  };
  const invalidHotel: ManagedHotelRecord = {
    ...readyHotel(),
    id: parseRuntimeHotelId("hotel_runtime_invalid"),
    key: parseRuntimeHotelKey("invalid-resort"),
    name: "Invalid Resort",
    status: "active",
    matchingPolicy: undefined,
  };
  const store = readOnlyHotelStore([validHotel, invalidHotel]);

  const context = await loadDynamicHotelRuntimeContext(store);
  assert.equal(context.manifests.length, 1);
  assert.equal(context.manifests[0].hotelKey, "example-resort");
  assert.ok(
    context.catalog.some(
      (scope) => String(scope.hotelKey) === "example-resort",
    ),
  );
  assert.equal(
    context.catalog.some(
      (scope) => String(scope.hotelKey) === "invalid-resort",
    ),
    false,
  );
  assert.equal(context.manifestWarnings.length, 1);
  assert.match(context.manifestWarnings[0], /Invalid Resort/);
  assert.match(context.manifestWarnings[0], /politikası eksik/);

  const report = await runBenchmarkJob(
    {
      mode: "mock",
      providerKeys: ["booking"],
      scopeKeys: [context.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    undefined,
    context,
  );
  assert.ok(report.warnings.some((warning) => warning.includes("Invalid Resort")));
});

test("a dynamic hotel cannot replace a static market scope at runtime", async () => {
  const validHotel = activeHotelWithMarket(readyHotel(), {
    id: "hotel_runtime_valid",
    key: "valid-resort",
    name: "Valid Resort",
    marketId: "valid-eu",
  });
  const conflictingHotel = activeHotelWithMarket(readyHotel(), {
    id: "hotel_runtime_static_conflict",
    key: "static-conflict-resort",
    name: "Static Conflict Resort",
    marketId: "beach-eu",
  });

  const context = await loadDynamicHotelRuntimeContext(
    readOnlyHotelStore([validHotel, conflictingHotel]),
  );
  assert.deepEqual(
    context.manifests.map((manifest) => manifest.hotelKey),
    ["valid-resort"],
  );
  assert.ok(
    context.manifestWarnings.some(
      (warning) =>
        warning.includes("Static Conflict Resort") &&
        warning.includes("beach-eu"),
    ),
  );
  assert.equal(
    context.catalog.filter((scope) => scope.id === "beach-eu").length,
    1,
  );
});

test("all dynamic hotels sharing one market scope are quarantined", async () => {
  const first = activeHotelWithMarket(readyHotel(), {
    id: "hotel_runtime_shared_first",
    key: "shared-first-resort",
    name: "Shared First Resort",
    marketId: "shared-eu",
  });
  const second = activeHotelWithMarket(readyHotel(), {
    id: "hotel_runtime_shared_second",
    key: "shared-second-resort",
    name: "Shared Second Resort",
    marketId: "shared-eu",
  });

  const context = await loadDynamicHotelRuntimeContext(
    readOnlyHotelStore([first, second]),
  );
  assert.equal(context.manifests.length, 0);
  assert.equal(context.manifestWarnings.length, 2);
  assert.ok(
    context.manifestWarnings.every((warning) => warning.includes("shared-eu")),
  );
});

test("runtime hotel storage failures are not mistaken for one invalid manifest", async () => {
  const store: HotelStore = {
    load: async () => {
      throw new Error("Hotel storage is unavailable.");
    },
    update: async () => {
      throw new Error("Test store is read-only.");
    },
  };

  await assert.rejects(
    loadDynamicHotelRuntimeContext(store),
    /Hotel storage is unavailable/,
  );
});

test("activation manifest fails closed without a supported verified collector", () => {
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest(
        readyHotel({ providerKey: "tui" }),
      ),
    (error: unknown) =>
      error instanceof DynamicHotelRuntimeError &&
      /ANEX Tour \(EUR\/RUB\), Booking\.com, CHECK24 \(EUR\), Coral Travel \(EUR\/RUB\), Expedia, HolidayCheck, Loveholidays \(EUR\/GBP\), On the Beach \(GBP\/Antalya\), PEGAS Touristik \(RUB\), Restplatzbörse \(EUR\), Schauinsland \(EUR\), Stayforlong \(EUR\) veya TUI/.test(
        error.message,
      ),
  );
  assert.throws(
    () => buildDynamicHotelRuntimeManifest(readyHotel({ pageUrl: undefined })),
    /çalıştırılabilir bir eşleştirme eksik/,
  );
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest(
        readyHotel({ roomAliases: {} }),
      ),
    /çalıştırılabilir bir eşleştirme eksik/,
  );
});

test("dynamic scopes extend only their supported provider and request boundary", () => {
  const manifest = buildDynamicHotelRuntimeManifest(readyHotel());
  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  assert.equal(
    providers.find((provider) => provider.key === "booking")?.supportedScopes.includes(
      manifest.scopes[0].id,
    ),
    true,
  );
  assert.equal(
    providers.find((provider) => provider.key === "expedia")?.supportedScopes.includes(
      manifest.scopes[0].id,
    ),
    false,
  );
  const request = parseBenchmarkRequest(
    {
      mode: "live",
      providerKeys: ["booking"],
      scopeKeys: ["example-eu"],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    "2026-11-05",
    manifest.scopes,
    providers,
  );
  assert.deepEqual(request.scopeKeys, ["example-eu"]);
});

test("active dynamic scope reaches the collector with its verified config", async () => {
  const manifest = buildDynamicHotelRuntimeManifest(readyHotel());
  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["booking"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, config) => {
      assert.equal(provider.key, "booking");
      assert.equal(scope.hotelName, "Example Resort");
      assert.equal(
        config?.pageUrl,
        "https://www.booking.com/hotel/tr/example-resort.html",
      );
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1250,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: config!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: manifest.collectorConfigs.anextour ?? {},
      bookingConfigs: manifest.collectorConfigs.booking ?? {},
      check24Configs: manifest.collectorConfigs.check24 ?? {},
      coraltravelConfigs: manifest.collectorConfigs.coraltravel ?? {},
      expediaConfigs: manifest.collectorConfigs.expedia ?? {},
      holidaycheckConfigs: manifest.collectorConfigs.holidaycheck ?? {},
      loveholidaysConfigs: manifest.collectorConfigs.loveholidays ?? {},
      onthebeachConfigs: manifest.collectorConfigs.onthebeach ?? {},
      pegastourConfigs: manifest.collectorConfigs.pegastour ?? {},
      restplatzboerseConfigs:
        manifest.collectorConfigs.restplatzboerse ?? {},
      schauinslandConfigs: manifest.collectorConfigs.schauinsland ?? {},
      stayforlongConfigs: manifest.collectorConfigs.stayforlong ?? {},
      tuiConfigs: manifest.collectorConfigs.tui ?? {},
    },
  );
  assert.equal(report.scopes[0].hotelName, "Example Resort");
  assert.equal(report.scopes[0].hotelShortCode, "ER");
  assert.equal(report.summary.availableRateCount, 1);
});

test("Expedia-only verification exposes only Expedia and reaches its collector config", async () => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "expedia",
      pageUrl:
        "https://www.expedia.com/Antalya-Hotels-Example-Resort.h123456.Hotel-Information",
    }),
  );
  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  assert.equal(
    providers.find((provider) => provider.key === "expedia")?.supportedScopes.includes(
      manifest.scopes[0].id,
    ),
    true,
  );
  assert.equal(
    providers.find((provider) => provider.key === "booking")?.supportedScopes.includes(
      manifest.scopes[0].id,
    ),
    false,
  );

  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["expedia"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, config) => {
      assert.equal(provider.key, "expedia");
      assert.match(config?.pageUrl ?? "", /\.h123456\./);
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1300,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: config!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: manifest.collectorConfigs.anextour ?? {},
      bookingConfigs: manifest.collectorConfigs.booking ?? {},
      check24Configs: manifest.collectorConfigs.check24 ?? {},
      coraltravelConfigs: manifest.collectorConfigs.coraltravel ?? {},
      expediaConfigs: manifest.collectorConfigs.expedia ?? {},
      holidaycheckConfigs: manifest.collectorConfigs.holidaycheck ?? {},
      loveholidaysConfigs: manifest.collectorConfigs.loveholidays ?? {},
      onthebeachConfigs: manifest.collectorConfigs.onthebeach ?? {},
      pegastourConfigs: manifest.collectorConfigs.pegastour ?? {},
      restplatzboerseConfigs:
        manifest.collectorConfigs.restplatzboerse ?? {},
      schauinslandConfigs: manifest.collectorConfigs.schauinsland ?? {},
      stayforlongConfigs: manifest.collectorConfigs.stayforlong ?? {},
      tuiConfigs: manifest.collectorConfigs.tui ?? {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("HolidayCheck runtime config uses the dynamic hotel policy without static catalog access", () => {
  const hotelId = "12345678-1234-1234-1234-123456789abc";
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "holidaycheck",
      pageUrl: `https://www.holidaycheck.de/hi/example-resort/${hotelId}`,
    }),
  );
  const config = manifest.collectorConfigs.holidaycheck?.["example-eu"];
  assert.ok(config);
  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  assert.equal(
    providers
      .find((provider) => provider.key === "holidaycheck")
      ?.supportedScopes.includes(manifest.scopes[0].id),
    true,
  );
  assert.equal(
    providers
      .find((provider) => provider.key === "booking")
      ?.supportedScopes.includes(manifest.scopes[0].id),
    false,
  );

  const window = {
    id: "2026-12-10_2026-12-15",
    label: "10-15 Aralık",
    checkIn: "2026-12-10",
    checkOut: "2026-12-15",
    nights: 5,
  };
  const offers = parseHolidayCheckOffers(
    providers.find((provider) => provider.key === "holidaycheck")!,
    { ...manifest.scopes[0], windows: [window] },
    window,
    [
      {
        travelkind: "hotelonly",
        hotelId,
        numberOfRooms: 1,
        adults: 2,
        children: [],
        totalPrice: { amount: 1400, currency: "EUR" },
        room: { description: "Standard Room with Land View" },
        stayStartDate: "2026-12-10",
        stayEndDate: "2026-12-15",
        availability: { status: "AVAILABLE", checkNeeded: false },
      },
    ],
    config.pageUrl,
    config,
  );
  assert.equal(offers[0].matchedRoomId, "standard-land");
  assert.equal(offers[0].price, 1400);
});

test("CHECK24 EUR mapping exposes a dynamic legacy search config", async () => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "check24",
      externalHotelId: "7654321",
      pageUrl: "https://hotel.check24.de/hotel/turkey/7654321",
      searchName: "Example Resort All Inclusive",
    }),
  );
  const config = manifest.collectorConfigs.check24?.["example-eu"];
  assert.equal(config?.check24?.hotelId, "7654321");
  assert.equal(config?.check24?.hotelName, "Example Resort All Inclusive");
  assert.equal(config?.matchingPolicy?.roomByView.land, "standard-land");
  const validation = validateDynamicCheck24Offer(
    {
      offerId: "offer-1",
      roomName: "Standard Room with Land View",
      roomCategoryName: "Standard Room",
      roomOccupancy: "[A|A]",
      mealType: "all_inclusive",
      supplierName: "DERTOUR",
      totalPrice: 1425,
      currency: "EUR",
      nights: 5,
      taxesIncluded: true,
      source: "rate",
    },
    5,
    manifest.scopes[0],
    config!,
  );
  assert.equal(validation.status, "matched");
  assert.equal(validation.roomId, "standard-land");

  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["check24"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, runtimeConfig) => {
      assert.equal(provider.key, "check24");
      assert.equal(runtimeConfig?.check24?.hotelId, "7654321");
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1425,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: runtimeConfig!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: {},
      bookingConfigs: {},
      check24Configs: manifest.collectorConfigs.check24 ?? {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
      loveholidaysConfigs: {},
      onthebeachConfigs: {},
      pegastourConfigs: {},
      restplatzboerseConfigs: {},
      schauinslandConfigs: {},
      stayforlongConfigs: {},
      tuiConfigs: {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("CHECK24 dynamic mapping fails closed outside EUR", () => {
  const hotel = readyHotel({
    providerKey: "check24",
    externalHotelId: "7654321",
    pageUrl: "https://hotel.check24.de/hotel/turkey/7654321",
  });
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...hotel,
        markets: hotel.markets.map((market) => ({
          ...market,
          currency: "GBP" as const,
        })),
      }),
    /CHECK24 \(EUR\)/,
  );
});

test("Schauinsland EUR mapping uses GIATA identity and dynamic room aliases", async () => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "schauinsland",
      externalHotelId: "998877",
      pageUrl:
        "https://www.schauinsland-reisen.de/hotel/998877-example-resort",
    }),
  );
  const config = manifest.collectorConfigs.schauinsland?.["example-eu"];
  assert.equal(config?.schauinsland?.giataId, "998877");

  const window = {
    id: "2026-12-10_2026-12-15",
    label: "10-15 Aralık",
    checkIn: "2026-12-10",
    checkOut: "2026-12-15",
    nights: 5,
  };
  const provider = OTA_PROVIDERS.find(
    (candidate) => candidate.key === "schauinsland",
  )!;
  const offers = buildSchauinslandCollectedOffers(
    [
      {
        hotelId: "998877",
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
        roomName: "Standard Room with Land View",
        roomCode: "DYN1",
        boardCode: "GT06-AI",
        boardName: "All Inclusive",
        totalPrice: 1475,
        currency: "EUR",
        tourOperator: "SLR",
        offerId: "offer-1",
        externalId: null,
        productCode: null,
        travelType: null,
        sourceCode: null,
        hotelOfferCategory: null,
      },
    ],
    provider,
    { ...manifest.scopes[0], windows: [window] },
    window,
    config!.pageUrl,
    "2026-11-06T09:00:00.000Z",
    config,
  );
  assert.equal(offers[0].matchedRoomId, "standard-land");
  assert.equal(offers[0].price, 1475);

  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["schauinsland"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: window.checkIn, checkOut: window.checkOut },
    },
    async (selectedProvider, scope, runtimeConfig) => {
      assert.equal(selectedProvider.key, "schauinsland");
      assert.equal(runtimeConfig?.schauinsland?.giataId, "998877");
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: selectedProvider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1475,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: runtimeConfig!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: {},
      bookingConfigs: {},
      check24Configs: {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
      loveholidaysConfigs: {},
      onthebeachConfigs: {},
      pegastourConfigs: {},
      restplatzboerseConfigs: {},
      schauinslandConfigs: manifest.collectorConfigs.schauinsland ?? {},
      stayforlongConfigs: {},
      tuiConfigs: {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("Schauinsland dynamic mapping fails closed outside EUR", () => {
  const hotel = readyHotel({
    providerKey: "schauinsland",
    externalHotelId: "998877",
    pageUrl:
      "https://www.schauinsland-reisen.de/hotel/998877-example-resort",
  });
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...hotel,
        markets: hotel.markets.map((market) => ({
          ...market,
          currency: "GBP" as const,
        })),
      }),
    /Schauinsland \(EUR\)/,
  );
});

test("Stayforlong EUR mapping uses property identity and dynamic room aliases", async () => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "stayforlong",
      externalHotelId: "123456",
      pageUrl:
        "https://www.stayforlong.de/de-de/hotel/tr/example-resort_antalya",
    }),
  );
  const config = manifest.collectorConfigs.stayforlong?.["example-eu"];
  assert.equal(config?.stayforlong?.propertyId, 123456);
  assert.equal(config?.stayforlong?.slug, "example-resort_antalya");

  const matched = applyDynamicStayforlongRoomMatch(
    [
      {
        availabilityId: "availability-1",
        propertyId: 123456,
        totalPrice: 1490,
        currency: "EUR",
        roomName: "Standard Room with Land View",
        roomCode: "DYN1",
        normalizedRoomCode: "DYN1",
        boardCode: "AI",
        boardName: "All Inclusive",
        adults: 2,
        children: 0,
        rooms: 1,
        providerCode: "supplier",
      },
    ],
    manifest.scopes[0],
    config!,
  );
  assert.equal(matched[0].matchedRoomId, "standard-land");
  assert.match(matched[0].matchReason ?? "", /alias/);

  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["stayforlong"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, runtimeConfig) => {
      assert.equal(provider.key, "stayforlong");
      assert.equal(runtimeConfig?.stayforlong?.propertyId, 123456);
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1490,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: runtimeConfig!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: {},
      bookingConfigs: {},
      check24Configs: {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
      loveholidaysConfigs: {},
      onthebeachConfigs: {},
      pegastourConfigs: {},
      restplatzboerseConfigs: {},
      schauinslandConfigs: {},
      stayforlongConfigs: manifest.collectorConfigs.stayforlong ?? {},
      tuiConfigs: {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("Stayforlong dynamic mapping fails closed outside EUR", () => {
  const hotel = readyHotel({
    providerKey: "stayforlong",
    externalHotelId: "123456",
    pageUrl:
      "https://www.stayforlong.de/de-de/hotel/tr/example-resort_antalya",
  });
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...hotel,
        markets: hotel.markets.map((market) => ({
          ...market,
          currency: "GBP" as const,
        })),
      }),
    /Stayforlong \(EUR\)/,
  );
});

test("ANEX EUR mapping uses accommodation identity and dynamic room aliases", async () => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "anextour",
      externalHotelId: "24680",
      pageUrl:
        "https://nurhotel.anextour.de/search/offer?aid=24680",
    }),
  );
  const config = manifest.collectorConfigs.anextour?.["example-eu"];
  assert.deepEqual(config?.anextour, {
    market: "de",
    accommodationId: "24680",
  });
  assert.equal(
    matchAnexRoom(
      manifest.scopes[0],
      "Standard Room with Land View",
      config,
    )?.id,
    "standard-land",
  );

  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["anextour"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, runtimeConfig) => {
      assert.equal(provider.key, "anextour");
      assert.deepEqual(runtimeConfig?.anextour, {
        market: "de",
        accommodationId: "24680",
      });
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1420,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: runtimeConfig!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: manifest.collectorConfigs.anextour ?? {},
      bookingConfigs: {},
      check24Configs: {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
      loveholidaysConfigs: {},
      onthebeachConfigs: {},
      pegastourConfigs: {},
      restplatzboerseConfigs: {},
      schauinslandConfigs: {},
      stayforlongConfigs: {},
      tuiConfigs: {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("ANEX RUB mapping derives the hotel slug and rejects unsafe identities", () => {
  const base = readyHotel({
    providerKey: "anextour",
    externalHotelId: "8356",
    pageUrl:
      "https://anextour.ru/hotels/turkey/example-resort-hotel",
  });
  const rubHotel = {
    ...base,
    markets: base.markets.map((market) => ({
      ...market,
      currency: "RUB" as const,
    })),
  };
  assert.deepEqual(
    buildDynamicHotelRuntimeManifest(rubHotel).collectorConfigs.anextour?.[
      "example-eu"
    ].anextour,
    {
      market: "ru",
      hotelId: "8356",
      hotelSlug: "example-resort-hotel",
    },
  );

  const eurHotel = readyHotel({
    providerKey: "anextour",
    externalHotelId: "24680",
    pageUrl: "https://nurhotel.anextour.de/search/offer?aid=99999",
  });
  assert.throws(
    () => buildDynamicHotelRuntimeManifest(eurHotel),
    /ANEX Tour \(EUR\/RUB\)/,
  );
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...rubHotel,
        location: { ...rubHotel.location, countryCode: "DE" },
      }),
    /ANEX Tour \(EUR\/RUB\)/,
  );
});

test("PEGAS RUB mapping uses hotel identity and dynamic room aliases", async () => {
  const base = readyHotel({
    providerKey: "pegastour",
    externalHotelId: "7654321",
    pageUrl:
      "https://pegast.ru/hotel/turkey/antalya/belek/example-resort-7654321",
  });
  const manifest = buildDynamicHotelRuntimeManifest({
    ...base,
    markets: base.markets.map((market) => ({
      ...market,
      currency: "RUB" as const,
    })),
  });
  const config = manifest.collectorConfigs.pegastour?.["example-eu"];
  assert.deepEqual(config?.pegastour, {
    hotelId: 7654321,
    hotelName: "Example Resort",
  });
  assert.equal(
    matchPegasRuntimeRoom(
      manifest.scopes[0],
      "Standard Room with Land View",
      config,
    ),
    "standard-land",
  );

  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["pegastour"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, runtimeConfig) => {
      assert.equal(provider.key, "pegastour");
      assert.equal(runtimeConfig?.pegastour?.hotelId, 7654321);
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 125000,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: runtimeConfig!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: {},
      bookingConfigs: {},
      check24Configs: {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
      loveholidaysConfigs: {},
      onthebeachConfigs: {},
      pegastourConfigs: manifest.collectorConfigs.pegastour ?? {},
      restplatzboerseConfigs: {},
      schauinslandConfigs: {},
      stayforlongConfigs: {},
      tuiConfigs: {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("PEGAS dynamic mapping rejects non-RUB, mismatched IDs and non-Turkey hotels", () => {
  const hotel = readyHotel({
    providerKey: "pegastour",
    externalHotelId: "7654321",
    pageUrl:
      "https://pegast.ru/hotel/turkey/antalya/belek/example-resort-7654321",
  });
  assert.throws(
    () => buildDynamicHotelRuntimeManifest(hotel),
    /PEGAS Touristik \(RUB\)/,
  );
  const rubHotel = {
    ...hotel,
    markets: hotel.markets.map((market) => ({
      ...market,
      currency: "RUB" as const,
    })),
  };
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...rubHotel,
        channelMappings: rubHotel.channelMappings.map((mapping) => ({
          ...mapping,
          externalHotelId: "1111111",
        })),
      }),
    /PEGAS Touristik \(RUB\)/,
  );
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...rubHotel,
        location: { ...rubHotel.location, countryCode: "DE" },
      }),
    /PEGAS Touristik \(RUB\)/,
  );
});

test("Coral Travel EUR mapping uses GIATA identity and dynamic room aliases", () => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "coraltravel",
      externalHotelId: "4893",
      pageUrl: "https://coraltravel.de/hotels/example-resort/",
      searchName: "Example Resort Hotel",
    }),
  );
  const config = manifest.collectorConfigs.coraltravel?.["example-eu"];
  assert.deepEqual(config?.coraltravel, {
    market: "de",
    giataId: "4893",
    searchQuery: "Example Resort Hotel",
    suggestion: "Example Resort Hotel",
  });
  assert.equal(
    matchCoralRuntimeRoom(
      manifest.scopes[0],
      "STD",
      "Standard Room with Land View",
      config,
    ).matchedRoomId,
    "standard-land",
  );
});

test("Coral Travel RUB mapping derives the API location from the verified page", () => {
  const base = readyHotel({
    providerKey: "coraltravel",
    externalHotelId: "10197-7-100-6",
    pageUrl: "https://www.coral.ru/hotels/turkey/example-resort-belek/",
    searchName: "EXAMPLE RESORT",
  });
  const manifest = buildDynamicHotelRuntimeManifest({
    ...base,
    markets: base.markets.map((market) => ({
      ...market,
      currency: "RUB" as const,
    })),
  });
  assert.deepEqual(
    manifest.collectorConfigs.coraltravel?.["example-eu"].coraltravel,
    {
      market: "ru",
      hotelName: "EXAMPLE RESORT",
      location: {
        id: "10197-7",
        requestId: "10197-7-100-6",
        friendlyUrl: "turkey/example-resort-belek",
        parentId: "100",
        parentName: "Antalya, TR",
      },
    },
  );
});

test("Coral Travel dynamic mapping rejects unsupported currency and malformed IDs", () => {
  const eurHotel = readyHotel({
    providerKey: "coraltravel",
    externalHotelId: "not-giata",
    pageUrl: "https://coraltravel.de/hotels/example-resort/",
  });
  assert.throws(
    () => buildDynamicHotelRuntimeManifest(eurHotel),
    /Coral Travel \(EUR\/RUB\)/,
  );
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...eurHotel,
        markets: eurHotel.markets.map((market) => ({
          ...market,
          currency: "GBP" as const,
        })),
      }),
    /Coral Travel \(EUR\/RUB\)/,
  );
});

test("Loveholidays mapping uses masterId and dynamic room aliases", async () => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "loveholidays",
      externalHotelId: "765432",
      pageUrl:
        "https://www.loveholidays.com/de/hotels/l/?masterId=765432",
    }),
  );
  const config = manifest.collectorConfigs.loveholidays?.["example-eu"];
  assert.equal(config?.loveholidays?.masterId, "765432");

  const window = {
    id: "test-window",
    label: "10-15 Dec",
    checkIn: "2026-12-10",
    checkOut: "2026-12-15",
    nights: 5,
  };
  const sourceUrl = buildLoveholidaysUrl(manifest.scopes[0], window, config);
  assert.equal(new URL(sourceUrl).searchParams.get("masterId"), "765432");
  const offers = parseLoveholidaysOffers(
    OTA_PROVIDERS.find((provider) => provider.key === "loveholidays")!,
    manifest.scopes[0],
    window,
    {
      url: sourceUrl,
      hotelName: "Example Resort",
      checkInLabel: "10.12.2026",
      nightsLabel: "5 Nächte",
      occupancyLabel: "1 Zimmer, 2 Erw.",
      offers: [
        {
          name: "Standard Room with Land View",
          priceText: "302 € pro Nacht / 1.510 € insgesamt",
          description: "All inclusive",
        },
      ],
    },
    config,
  );
  assert.equal(offers[0].matchedRoomId, "standard-land");
  assert.equal(offers[0].price, 1510);

  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["loveholidays"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, runtimeConfig) => {
      assert.equal(provider.key, "loveholidays");
      assert.equal(runtimeConfig?.loveholidays?.masterId, "765432");
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1510,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: runtimeConfig!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: {},
      bookingConfigs: {},
      check24Configs: {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
      loveholidaysConfigs: manifest.collectorConfigs.loveholidays ?? {},
      onthebeachConfigs: {},
      pegastourConfigs: {},
      restplatzboerseConfigs: {},
      schauinslandConfigs: {},
      stayforlongConfigs: {},
      tuiConfigs: {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("Loveholidays accepts the GBP path and rejects identity or market mismatches", () => {
  const eurHotel = readyHotel({
    providerKey: "loveholidays",
    externalHotelId: "765432",
    pageUrl: "https://www.loveholidays.com/de/hotels/l/?masterId=765432",
  });
  const gbpHotel = {
    ...eurHotel,
    markets: eurHotel.markets.map((market) => ({
      ...market,
      currency: "GBP" as const,
    })),
    channelMappings: eurHotel.channelMappings.map((mapping) => ({
      ...mapping,
      pageUrl: "https://www.loveholidays.com/hotels/l/?masterId=765432",
    })),
  };
  assert.equal(
    buildDynamicHotelRuntimeManifest(gbpHotel).collectorConfigs.loveholidays?.[
      "example-eu"
    ].loveholidays?.masterId,
    "765432",
  );
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...eurHotel,
        channelMappings: eurHotel.channelMappings.map((mapping) => ({
          ...mapping,
          externalHotelId: "111111",
        })),
      }),
    /Loveholidays \(EUR\/GBP\)/,
  );
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...eurHotel,
        markets: eurHotel.markets.map((market) => ({
          ...market,
          currency: "RUB" as const,
        })),
      }),
    /Loveholidays \(EUR\/GBP\)/,
  );
});

test("On the Beach GBP mapping uses property identity and dynamic room aliases", async () => {
  const base = readyHotel({
    providerKey: "onthebeach",
    externalHotelId: "3149999",
    pageUrl:
      "https://www.onthebeach.co.uk/hotels/turkey/antalya/example-resort",
  });
  const manifest = buildDynamicHotelRuntimeManifest({
    ...base,
    markets: base.markets.map((market) => ({
      ...market,
      currency: "GBP" as const,
    })),
  });
  const config = manifest.collectorConfigs.onthebeach?.["example-eu"];
  assert.equal(config?.onthebeach?.propertyId, "3149999");
  assert.equal(config?.onthebeach?.cardName, "Example Resort");
  assert.equal(
    resolveOnTheBeachPropertyId(manifest.scopes[0], config),
    "3149999",
  );
  assert.equal(
    resolveOnTheBeachCardName(manifest.scopes[0], config),
    "Example Resort",
  );

  const window = {
    id: "test-window",
    label: "10-15 Dec",
    checkIn: "2026-12-10",
    checkOut: "2026-12-15",
    nights: 5,
  };
  const offers = parseOnTheBeachOffers(
    OTA_PROVIDERS.find((provider) => provider.key === "onthebeach")!,
    manifest.scopes[0],
    window,
    {
      sourceUrl:
        "https://www.onthebeach.co.uk/hotel_searches/show/3169999999",
      hotelName: "Example Resort",
      checkInLabel: "Check-in Date 10 Dec 2026",
      returnLabel: "Return 15 Dec 2026",
      nights: 5,
      adults: 2,
      children: 0,
      infants: 0,
      rooms: 1,
      totalSelected: true,
      offers: [
        {
          roomName: "Standard Room with Land View",
          board: "All Inclusive",
          priceText: "£1,250per party",
        },
      ],
    },
    config,
  );
  assert.equal(offers[0].matchedRoomId, "standard-land");
  assert.equal(offers[0].price, 1250);

  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["onthebeach"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, runtimeConfig) => {
      assert.equal(provider.key, "onthebeach");
      assert.equal(runtimeConfig?.onthebeach?.propertyId, "3149999");
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1250,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: runtimeConfig!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: {},
      bookingConfigs: {},
      check24Configs: {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
      loveholidaysConfigs: {},
      onthebeachConfigs: manifest.collectorConfigs.onthebeach ?? {},
      pegastourConfigs: {},
      restplatzboerseConfigs: {},
      schauinslandConfigs: {},
      stayforlongConfigs: {},
      tuiConfigs: {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("On the Beach dynamic mapping rejects non-GBP, non-Antalya and invalid property IDs", () => {
  const hotel = readyHotel({
    providerKey: "onthebeach",
    externalHotelId: "3149999",
    pageUrl:
      "https://www.onthebeach.co.uk/hotels/turkey/antalya/example-resort",
  });
  assert.throws(
    () => buildDynamicHotelRuntimeManifest(hotel),
    /On the Beach \(GBP\/Antalya\)/,
  );
  for (const mapping of [
    {
      externalHotelId: "property-3149999",
      pageUrl:
        "https://www.onthebeach.co.uk/hotels/turkey/antalya/example-resort",
    },
    {
      externalHotelId: "3149999",
      pageUrl:
        "https://www.onthebeach.co.uk/hotels/turkey/dalaman/example-resort",
    },
  ])
    assert.throws(
      () =>
        buildDynamicHotelRuntimeManifest({
          ...hotel,
          markets: hotel.markets.map((market) => ({
            ...market,
            currency: "GBP" as const,
          })),
          channelMappings: hotel.channelMappings.map((channel) => ({
            ...channel,
            ...mapping,
          })),
        }),
      /On the Beach \(GBP\/Antalya\)/,
    );
});

test("Restplatzbörse EUR mapping uses IFF identity and dynamic room aliases", async () => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "restplatzboerse",
      externalHotelId: "654321",
      pageUrl: "https://www.restplatzboerse.at/hotel/654321/",
    }),
  );
  const config = manifest.collectorConfigs.restplatzboerse?.["example-eu"];
  assert.equal(config?.restplatzboerse?.hotelIffCode, 654321);
  assert.equal(config?.restplatzboerse?.hotelName, "Example Resort");

  const matched = applyDynamicRestplatzboerseRoomMatch(
    [
      {
        offerId: "offer-1",
        offerCode: "AYT0001",
        hotelName: "Example Resort",
        checkIn: "2026-12-10",
        checkOut: "2026-12-15",
        nights: 5,
        totalPrice: 1510,
        currency: "EUR",
        roomName: "Standard Room with Land View",
        roomCode: "DYN1",
        roomType: "DoubleRoom",
        roomView: "NothingSpecial",
        boardCode: "AllInclusive",
        operatorCode: "FER",
        operatorName: "FERIEN Touristik",
      },
    ],
    manifest.scopes[0],
    config!,
  );
  assert.equal(matched[0].matchedRoomId, "standard-land");
  assert.match(matched[0].matchReason ?? "", /alias/);

  const providers = addDynamicScopesToProviders(OTA_PROVIDERS, [manifest]);
  const report = await runBenchmarkJob(
    {
      mode: "live",
      providerKeys: ["restplatzboerse"],
      scopeKeys: [manifest.scopes[0].id],
      customWindow: { checkIn: "2026-12-10", checkOut: "2026-12-15" },
    },
    async (provider, scope, runtimeConfig) => {
      assert.equal(provider.key, "restplatzboerse");
      assert.equal(runtimeConfig?.restplatzboerse?.hotelIffCode, 654321);
      return {
        warnings: [],
        quotes: scope.rooms.map((room) => ({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: scope.windows[0].id,
          price: 1510,
          currency: scope.currency,
          status: "available" as const,
          dataMode: "live" as const,
          sourceHint: runtimeConfig!.pageUrl,
        })),
      };
    },
    {
      catalog: manifest.scopes,
      providers,
      anextourConfigs: {},
      bookingConfigs: {},
      check24Configs: {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
      loveholidaysConfigs: {},
      onthebeachConfigs: {},
      pegastourConfigs: {},
      restplatzboerseConfigs:
        manifest.collectorConfigs.restplatzboerse ?? {},
      schauinslandConfigs: {},
      stayforlongConfigs: {},
      tuiConfigs: {},
    },
  );
  assert.equal(report.summary.availableRateCount, 1);
});

test("Restplatzbörse dynamic mapping fails closed outside EUR", () => {
  const hotel = readyHotel({
    providerKey: "restplatzboerse",
    externalHotelId: "654321",
    pageUrl: "https://www.restplatzboerse.at/hotel/654321/",
  });
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...hotel,
        markets: hotel.markets.map((market) => ({
          ...market,
          currency: "GBP" as const,
        })),
      }),
    /Restplatzbörse \(EUR\)/,
  );
});

test("TUI EUR runtime config reaches the room service without static hotel config", async (t) => {
  const manifest = buildDynamicHotelRuntimeManifest(
    readyHotel({
      providerKey: "tui",
      externalHotelId: "987654",
      pageUrl:
        "https://www.tui.com/hotels/hotel-example-resort-987654/hotelinformation/",
    }),
  );
  const config = manifest.collectorConfigs.tui?.["example-eu"];
  assert.equal(config?.tui?.giataId, 987654);
  assert.equal(config?.tui?.market, "de");
  assert.equal(config?.tui?.locale, "de-DE");

  t.mock.method(
    globalThis,
    "fetch",
    async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.hotelId, "987654");
    assert.equal(body.giataId, "987654");
    assert.equal(body.market, "de");
    assert.equal(body.locale, "de-DE");
    return new Response(
      JSON.stringify({
        roomTypes: [
          {
            offers: [
              {
                arrivalDate: "2026-12-10",
                departureDate: "2026-12-15",
                duration: 5,
                currency: "EUR",
                hotel: { giataCode: "987654" },
                price: { amount: 1500 },
                travellers: [{ age: 30 }, { age: 30 }],
                rooms: [
                  {
                    roomName: "Standard Room with Land View",
                    supplierRoomId: "Standard Room with Land View",
                  },
                ],
                board: { boardName: "All inclusive" },
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    },
  );

  const result = await collectTuiLiveQuotes(
    OTA_PROVIDERS.find((provider) => provider.key === "tui")!,
    {
      ...manifest.scopes[0],
      windows: [
        {
          id: "2026-12-10_2026-12-15",
          label: "10-15 Aralık",
          checkIn: "2026-12-10",
          checkOut: "2026-12-15",
          nights: 5,
        },
      ],
    },
    config,
  );
  assert.equal(result.quotes[0].status, "available");
  assert.equal(result.quotes[0].price, 1500);
  assert.equal(result.offers?.[0].matchedRoomId, "standard-land");
});

test("TUI dynamic activation rejects markets that need unsupported UK product identifiers", () => {
  const hotel = readyHotel({
    providerKey: "tui",
    externalHotelId: "987654",
    pageUrl:
      "https://www.tui.com/hotels/hotel-example-resort-987654/hotelinformation/",
  });
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest({
        ...hotel,
        markets: hotel.markets.map((market) => ({
          ...market,
          currency: "GBP" as const,
        })),
      }),
    /TUI \(EUR\)/,
  );
});
