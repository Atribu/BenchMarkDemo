export type HotelRoomCategory = "superior" | "standard";
export type HotelRoomView = "land" | "garden" | "sea" | "partial-sea";

export interface HotelRoomCatalogEntry {
  id: string;
  name: string;
  occupancyLabel: string;
  referenceRates?: Record<string, Record<string, number>>;
}

export interface HotelScopeCatalogEntry {
  id: string;
  label: string;
  marketLabel: string;
  currency: "EUR" | "GBP" | "RUB";
  requiredBoard?: "all-inclusive" | "all-inclusive-plus";
  notes?: string;
}

export interface HotelCatalogEntry {
  key: string;
  name: string;
  shortCode: string;
  location: {
    countryCode: string;
    city: string;
    region?: string;
  };
  scopes: readonly HotelScopeCatalogEntry[];
  rooms: readonly HotelRoomCatalogEntry[];
  matchingPolicy: {
    category: HotelRoomCategory;
    requireBalcony: boolean;
    roomByView: Partial<Record<HotelRoomView, string>>;
  };
}

export const HOTEL_CATALOG = [
  {
    key: "miramare-beach",
    name: "Miramare Beach",
    shortCode: "MB",
    location: { countryCode: "TR", city: "Antalya", region: "Side" },
    matchingPolicy: {
      category: "superior",
      requireBalcony: true,
      roomByView: {
        land: "superior-land",
        garden: "superior-land",
        sea: "superior-sea",
      },
    },
    scopes: [
      {
        id: "beach-eu",
        label: "Beach Avrupa Benchmark",
        marketLabel: "Avrupa",
        currency: "EUR",
        notes:
          "Referans fiyatlar Google Sheet'teki 2026 Avrupa bloklarından seed edildi.",
      },
      {
        id: "beach-uk",
        label: "Beach Birleşik Krallık Benchmark",
        marketLabel: "Birleşik Krallık",
        currency: "GBP",
        notes:
          "Loveholidays ve OnTheBeach gibi UK odaklı kanallar için ayrık kapsam.",
      },
    ],
    rooms: [
      {
        id: "corner",
        name: "Köşe Oda",
        occupancyLabel: "2 Pax",
      },
      {
        id: "economy",
        name: "Ekonomi Oda",
        occupancyLabel: "2 Pax",
      },
      {
        id: "superior-land",
        name: "Superior Kara Manzaralı",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "beach-eu": {
            "2026-05-10_2026-05-15": 1444,
            "2026-06-10_2026-06-15": 1824.19,
            "2026-08-10_2026-08-15": 1938,
            "2026-09-10_2026-09-15": 1965.36,
            "2026-10-10_2026-10-15": 1687.2,
          },
          "beach-uk": {
            "2026-05-10_2026-05-15": 1273,
            "2026-06-10_2026-06-15": 1610.06,
            "2026-08-10_2026-08-15": 1717.13,
            "2026-09-10_2026-09-15": 1706.96,
            "2026-10-10_2026-10-15": 1459.2,
          },
        },
      },
      {
        id: "superior-sea",
        name: "Superior Deniz Manzaralı",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "beach-eu": {
            "2026-05-10_2026-05-15": 1558,
            "2026-06-10_2026-06-15": 1931.35,
            "2026-08-10_2026-08-15": 2023.5,
            "2026-09-10_2026-09-15": 2061.12,
            "2026-10-10_2026-10-15": 1778.4,
          },
          "beach-uk": {
            "2026-05-10_2026-05-15": 1368,
            "2026-06-10_2026-06-15": 1699.36,
            "2026-08-10_2026-08-15": 1788.38,
            "2026-09-10_2026-09-15": 1786.76,
            "2026-10-10_2026-10-15": 1504.8,
          },
        },
      },
    ],
  },
  {
    key: "miramare-queen",
    name: "Miramare Queen",
    shortCode: "MQ",
    location: { countryCode: "TR", city: "Antalya", region: "Side" },
    matchingPolicy: {
      category: "standard",
      requireBalcony: false,
      roomByView: {
        land: "standard-land",
        garden: "standard-land",
        sea: "standard-sea",
      },
    },
    scopes: [
      {
        id: "queen-eu",
        label: "Queen Avrupa Benchmark",
        marketLabel: "Avrupa",
        currency: "EUR",
        notes: "Queen için ilk sürüm Avrupa kanal karmasına odaklanıyor.",
      },
      {
        id: "queen-uk",
        label: "Queen Birleşik Krallık Benchmark",
        marketLabel: "Birleşik Krallık",
        currency: "GBP",
        notes:
          "UK kanalları için ayrı para birimi; EUR referansları GBP olarak kullanılmaz.",
      },
    ],
    rooms: [
      {
        id: "standard-land",
        name: "Standart Kara Manzaralı",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "queen-eu": {
            "2026-05-10_2026-05-15": 1000,
            "2026-06-10_2026-06-15": 1338,
            "2026-08-10_2026-08-15": 1414.8,
            "2026-09-10_2026-09-15": 1478.84,
            "2026-10-10_2026-10-15": 1155,
          },
        },
      },
      {
        id: "standard-sea",
        name: "Standart Deniz Manzaralı",
        occupancyLabel: "2 Pax",
        referenceRates: {
          "queen-eu": {
            "2026-05-10_2026-05-15": 1096,
            "2026-06-10_2026-06-15": 1431.6,
            "2026-08-10_2026-08-15": 1501.2,
            "2026-09-10_2026-09-15": 1574.36,
            "2026-10-10_2026-10-15": 1239,
          },
        },
      },
    ],
  },
  {
    key: "port-nature",
    name: "Port Nature Luxury Resort Hotel & Spa",
    shortCode: "PN",
    location: { countryCode: "TR", city: "Antalya", region: "Belek" },
    matchingPolicy: {
      category: "standard",
      requireBalcony: false,
      roomByView: {
        land: "standard-land",
        sea: "standard-sea",
        "partial-sea": "standard-side-sea",
      },
    },
    scopes: [
      {
        id: "port-nature-eu",
        label: "Port Nature Avrupa Benchmark",
        marketLabel: "Avrupa",
        currency: "EUR",
        requiredBoard: "all-inclusive",
        notes:
          "Premium A'la Carte All Inclusive; ilk canlı kapsam doğrulanmış ANEX Tour EUR akışıdır.",
      },
      {
        id: "port-nature-uk",
        label: "Port Nature Birleşik Krallık Benchmark",
        marketLabel: "Birleşik Krallık",
        currency: "GBP",
        requiredBoard: "all-inclusive",
        notes:
          "On the Beach gibi UK odaklı kanallar için GBP kapsamı; EUR fiyatlara çevrilmez.",
      },
      {
        id: "port-nature-ru",
        label: "Port Nature Rusya Benchmark",
        marketLabel: "Rusya",
        currency: "RUB",
        requiredBoard: "all-inclusive",
        notes:
          "ANEX Tour ve Coral Travel için Rusya hotel-only kapsamı; kaynak RUB fiyatı korunur ve panelde TCMB resmi günlük satış kuruyla EUR karşılığı gösterilir.",
      },
    ],
    rooms: [
      {
        id: "standard-land",
        name: "Standart Kara Manzaralı",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "standard-side-sea",
        name: "Standart Yandan Deniz Manzaralı",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "standard-sea",
        name: "Standart Deniz Manzaralı",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "family",
        name: "Aile Odası",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "king-suite",
        name: "King Süit",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
    ],
  },
  {
    key: "sy-hotels-belek",
    name: "SY Hotels Belek Boutique Luxury",
    shortCode: "SY",
    location: { countryCode: "TR", city: "Antalya", region: "Belek" },
    matchingPolicy: {
      category: "standard",
      requireBalcony: true,
      roomByView: {
        land: "deluxe-land",
        garden: "deluxe-land",
      },
    },
    scopes: [
      {
        id: "sy-hotels-eu",
        label: "SY Hotels Avrupa Benchmark",
        marketLabel: "Avrupa",
        currency: "EUR",
        requiredBoard: "all-inclusive",
        notes:
          "SY Hotels Belek Boutique Luxury için Avrupa/EUR hotel-only kapsamı.",
      },
      {
        id: "sy-hotels-uk",
        label: "SY Hotels Birleşik Krallık Benchmark",
        marketLabel: "Birleşik Krallık",
        currency: "GBP",
        requiredBoard: "all-inclusive",
        notes:
          "On the Beach ve Loveholidays gibi UK kanalları için GBP kapsamı.",
      },
      {
        id: "sy-hotels-ru",
        label: "SY Hotels Rusya Benchmark",
        marketLabel: "Rusya",
        currency: "RUB",
        requiredBoard: "all-inclusive",
        notes:
          "Rusya hotel-only kanalları için RUB kapsamı; kaynak RUB fiyatı korunur.",
      },
    ],
    rooms: [
      {
        id: "deluxe-land",
        name: "Deluxe Kara Manzaralı",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "deluxe-pool",
        name: "Deluxe Havuz Manzaralı",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "deluxe-superior",
        name: "Deluxe Superior",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "deluxe-family",
        name: "Deluxe Aile Odası",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "deluxe-duplex-family",
        name: "Deluxe Dubleks Aile Odası",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "deluxe-swim-up",
        name: "Deluxe Swim-Up",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "deluxe-family-swim-up",
        name: "Deluxe Swim-Up Aile Odası",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
      {
        id: "deluxe-shallow-pool",
        name: "Deluxe Sığ Havuzlu Oda",
        occupancyLabel: "1 oda · 2 yetişkin",
      },
    ],
  },
] as const satisfies readonly HotelCatalogEntry[];

export type HotelKey = (typeof HOTEL_CATALOG)[number]["key"];
export type ScopeKey =
  (typeof HOTEL_CATALOG)[number]["scopes"][number]["id"];

export function getHotelDefinition(hotelKey: HotelKey): HotelCatalogEntry {
  const hotel = HOTEL_CATALOG.find((entry) => entry.key === hotelKey);
  if (!hotel) throw new Error(`Bilinmeyen otel: ${hotelKey}`);
  return hotel;
}
