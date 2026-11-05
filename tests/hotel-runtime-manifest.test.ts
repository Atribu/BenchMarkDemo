import test from "node:test";
import assert from "node:assert/strict";
import { parseBenchmarkRequest } from "../src/lib/benchmark/request";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import { runBenchmarkJob } from "../src/lib/ota/run-benchmark";
import { parseHolidayCheckOffers } from "../src/lib/ota/live-holidaycheck";
import { collectTuiLiveQuotes } from "../src/lib/ota/live-tui";
import { validateDynamicCheck24Offer } from "../src/lib/ota/live-check24-provider";
import { parseRuntimeScopeKey } from "../src/lib/hotels/identifiers";
import { createHotelDraft, type ManagedHotelRecord } from "../src/lib/hotels/model";
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
        status: "verified",
        pageUrl: "https://www.booking.com/hotel/tr/example-resort.html",
        searchName: "Example Resort",
        roomAliases: { "standard-land": ["Standard Room with Land View"] },
        verifiedAt: "2026-11-05T09:30:00.000Z",
        ...mappingOverrides,
      },
    ],
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

test("activation manifest fails closed without a supported verified collector", () => {
  assert.throws(
    () =>
      buildDynamicHotelRuntimeManifest(
        readyHotel({ providerKey: "tui" }),
      ),
    (error: unknown) =>
      error instanceof DynamicHotelRuntimeError &&
      /Booking\.com, CHECK24 \(EUR\), Expedia, HolidayCheck veya TUI/.test(
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
      bookingConfigs: manifest.collectorConfigs.booking ?? {},
      check24Configs: manifest.collectorConfigs.check24 ?? {},
      expediaConfigs: manifest.collectorConfigs.expedia ?? {},
      holidaycheckConfigs: manifest.collectorConfigs.holidaycheck ?? {},
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
      bookingConfigs: manifest.collectorConfigs.booking ?? {},
      check24Configs: manifest.collectorConfigs.check24 ?? {},
      expediaConfigs: manifest.collectorConfigs.expedia ?? {},
      holidaycheckConfigs: manifest.collectorConfigs.holidaycheck ?? {},
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
      bookingConfigs: {},
      check24Configs: manifest.collectorConfigs.check24 ?? {},
      expediaConfigs: {},
      holidaycheckConfigs: {},
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
