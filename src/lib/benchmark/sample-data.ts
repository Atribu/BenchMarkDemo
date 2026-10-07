import type {
  BenchmarkRequest,
  BenchmarkWindowDefinition,
  OtaKey,
  ReportScopeDefinition
} from "@/src/lib/benchmark/types";

const FUTURE_WINDOWS: BenchmarkWindowDefinition[] = [
  {
    id: "2026-05-10_2026-05-15",
    label: "10 - 15 Mayis 2026",
    checkIn: "2026-05-10",
    checkOut: "2026-05-15",
    nights: 5
  },
  {
    id: "2026-06-10_2026-06-15",
    label: "10 - 15 Haziran 2026",
    checkIn: "2026-06-10",
    checkOut: "2026-06-15",
    nights: 5
  },
  {
    id: "2026-08-10_2026-08-15",
    label: "10 - 15 Agustos 2026",
    checkIn: "2026-08-10",
    checkOut: "2026-08-15",
    nights: 5
  },
  {
    id: "2026-09-10_2026-09-15",
    label: "10 - 15 Eylul 2026",
    checkIn: "2026-09-10",
    checkOut: "2026-09-15",
    nights: 5
  },
  {
    id: "2026-10-10_2026-10-15",
    label: "10 - 15 Ekim 2026",
    checkIn: "2026-10-10",
    checkOut: "2026-10-15",
    nights: 5
  }
];

export const DEFAULT_CUSTOM_WINDOW = {
  checkIn: FUTURE_WINDOWS[0].checkIn,
  checkOut: FUTURE_WINDOWS[0].checkOut
};

export const REPORT_SCOPES: ReportScopeDefinition[] = [
  {
    id: "beach-eu",
    label: "Beach Avrupa Benchmark",
    hotelKey: "miramare-beach",
    hotelName: "Miramare Beach",
    marketLabel: "Avrupa",
    currency: "EUR",
    notes: "Referans fiyatlar Google Sheet'teki 2026 Avrupa bloklarindan seed edildi.",
    windows: FUTURE_WINDOWS,
    rooms: [
       {
    id: "corner",
    name: "Köşe Oda",
    occupancyLabel: "2 Pax",
    referenceRates: {}
  },
        {
    id: "economy",
    name: "Ekonomi Oda",
    occupancyLabel: "2 Pax",
    referenceRates: {}
  },
      {
        id: "superior-land",
        name: "Superior Kara Manzarali",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "2026-05-10_2026-05-15": 1444,
          "2026-06-10_2026-06-15": 1824.19,
          "2026-08-10_2026-08-15": 1938,
          "2026-09-10_2026-09-15": 1965.36,
          "2026-10-10_2026-10-15": 1687.2
        }
      },
      {
        id: "superior-sea",
        name: "Superior Deniz Manzarali",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "2026-05-10_2026-05-15": 1558,
          "2026-06-10_2026-06-15": 1931.35,
          "2026-08-10_2026-08-15": 2023.5,
          "2026-09-10_2026-09-15": 2061.12,
          "2026-10-10_2026-10-15": 1778.4
        }
      }
    ]
  },
  {
    id: "beach-uk",
    label: "Beach Birlesik Krallik Benchmark",
    hotelKey: "miramare-beach",
    hotelName: "Miramare Beach",
    marketLabel: "Birlesik Krallik",
    currency: "GBP",
    notes: "Loveholidays ve OnTheBeach gibi UK odakli kanallar icin ayrik scope.",
    windows: FUTURE_WINDOWS,
    rooms: [
      {
    id: "corner",
    name: "Köşe Oda",
    occupancyLabel: "2 Pax",
    referenceRates: {}
  },
       {
    id: "economy",
    name: "Ekonomi Oda",
    occupancyLabel: "2 Pax",
    referenceRates: {}
  },
      {
        id: "superior-land",
        name: "Superior Kara Manzarali",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "2026-05-10_2026-05-15": 1273,
          "2026-06-10_2026-06-15": 1610.06,
          "2026-08-10_2026-08-15": 1717.13,
          "2026-09-10_2026-09-15": 1706.96,
          "2026-10-10_2026-10-15": 1459.2
        }
      },
      {
        id: "superior-sea",
        name: "Superior Deniz Manzarali",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "2026-05-10_2026-05-15": 1368,
          "2026-06-10_2026-06-15": 1699.36,
          "2026-08-10_2026-08-15": 1788.38,
          "2026-09-10_2026-09-15": 1786.76,
          "2026-10-10_2026-10-15": 1504.8
        }
      }
    ]
  },
  {
    id: "queen-eu",
    label: "Queen Avrupa Benchmark",
    hotelKey: "miramare-queen",
    hotelName: "Miramare Queen",
    marketLabel: "Avrupa",
    currency: "EUR",
    notes: "Queen icin ilk surum Avrupa kanal karmasina odaklaniyor.",
    windows: FUTURE_WINDOWS,
    rooms: [
      {
        id: "standard-land",
        name: "Standart Kara Manzarali",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "2026-05-10_2026-05-15": 1000,
          "2026-06-10_2026-06-15": 1338,
          "2026-08-10_2026-08-15": 1414.8,
          "2026-09-10_2026-09-15": 1478.84,
          "2026-10-10_2026-10-15": 1155
        }
      },
      {
        id: "standard-sea",
        name: "Standart Deniz Manzarali",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "2026-05-10_2026-05-15": 1096,
          "2026-06-10_2026-06-15": 1431.6,
          "2026-08-10_2026-08-15": 1501.2,
          "2026-09-10_2026-09-15": 1574.36,
          "2026-10-10_2026-10-15": 1239
        }
      }
    ]
  }
];

const queenEu = REPORT_SCOPES.find((scope) => scope.id === "queen-eu")!;
REPORT_SCOPES.push({
  ...queenEu,
  id: "queen-uk",
  label: "Queen Birlesik Krallik Benchmark",
  marketLabel: "Birlesik Krallik",
  currency: "GBP",
  notes: "UK kanallari icin ayri para birimi; EUR referanslari GBP olarak kullanilmaz.",
  rooms: queenEu.rooms.map((room) => ({ ...room, referenceRates: {} })),
});

export const DEFAULT_PROVIDER_KEYS: OtaKey[] = ["booking"];

export const DEFAULT_REQUEST: BenchmarkRequest = {
  mode: "mock",
  providerKeys: DEFAULT_PROVIDER_KEYS,
  scopeKeys: REPORT_SCOPES.map((scope) => scope.id),
  customWindow: DEFAULT_CUSTOM_WINDOW
};
