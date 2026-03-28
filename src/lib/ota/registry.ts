import type { ProviderDescriptor } from "@/src/lib/benchmark/types";

export const OTA_PROVIDERS: ProviderDescriptor[] = [
  {
    key: "booking",
    name: "Booking.com",
    shortName: "Booking",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes: "Live beta aktif. Searchresults property-card parser'i ile requested-date sold-out ve hotel-level fallback sinyali uretiyor.",
    supportedScopes: ["beach-eu", "beach-uk", "queen-eu"],
    searchTemplate:
      "https://www.booking.com/searchresults.html?ss={hotelName}&checkin={checkIn}&checkout={checkOut}"
  },
  {
    key: "expedia",
    name: "Expedia",
    shortName: "Expedia",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes: "Live beta aktif. Expedia bot korumasi geldiginde collector manual-review quote donduruyor.",
    supportedScopes: ["beach-eu", "beach-uk", "queen-eu"],
    searchTemplate:
      "https://www.expedia.com/Hotel-Search?destination={hotelName}&startDate={checkIn}&endDate={checkOut}"
  },
  {
    key: "hotelbeds",
    name: "Hotelbeds",
    shortName: "Hotelbeds",
    collectionType: "api",
    liveSupported: true,
    readiness: "api-contract",
    notes: "Live beta aktif. Availability istegi icin resmi Hotelbeds API kullaniliyor; Api-key, X-Signature, mTLS sertifikasi ve hotel code env degerleri gerekli.",
    supportedScopes: ["beach-eu", "queen-eu"]
  },
  {
    key: "holidaycheck",
    name: "HolidayCheck",
    shortName: "HolidayCheck",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes: "Live beta aktif. Exact-date hotel-only offer sayfasi acilip all-offers-service cevabindan oda ve fiyat okunuyor.",
    supportedScopes: ["beach-eu", "queen-eu"],
    searchTemplate:
      "https://www.holidaycheck.de/suche?search={hotelName}&from={checkIn}&to={checkOut}"
  },
  {
    key: "loveholidays",
    name: "Loveholidays",
    shortName: "Loveholidays",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes: "Live beta aktif. Search sayfasina gidip anti-bot, JS gate ve hotel-level fiyat sinyalini kontrol ediyor.",
    supportedScopes: ["beach-uk"],
    searchTemplate:
      "https://www.loveholidays.com/holidays/?query={hotelName}&date={checkIn}"
  },
  {
    key: "onthebeach",
    name: "On the Beach",
    shortName: "OTB",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes: "Live beta aktif. Search sayfasina gidip anti-bot, JS gate ve hotel-level fiyat sinyalini kontrol ediyor.",
    supportedScopes: ["beach-uk"],
    searchTemplate:
      "https://www.onthebeach.co.uk/holidays/search?query={hotelName}&depart={checkIn}"
  },
  {
    key: "tui",
    name: "TUI",
    shortName: "TUI",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes: "Live beta aktif. Resmi TUI offer endpoint'inden hotel-only teklifleri ve oda aciklamalari okunuyor.",
    supportedScopes: ["beach-eu", "queen-eu"],
    searchTemplate:
      "https://www.tui.com/pauschalreisen/suchen/hotels/?search={hotelName}&from={checkIn}"
  }
];
