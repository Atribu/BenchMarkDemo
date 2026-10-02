import type { ProviderDescriptor } from "@/src/lib/benchmark/types";

export const OTA_PROVIDERS: ProviderDescriptor[] = [
  {
    key: "booking",
    name: "Booking.com",
    shortName: "Booking",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes:
      "Dogrudan otel oda tablosunu okur; tarih, kisi, para birimi ve konaklama toplamini dogrular. Ana sayfaya yonlendirme veya erisim engeli doluluk olarak isaretlenmez.",
    supportedScopes: ["beach-eu", "beach-uk", "queen-eu", "queen-uk"],
    searchTemplate:
      "https://www.booking.com/searchresults.html?ss={hotelName}&checkin={checkIn}&checkout={checkOut}",
  },
  {
    key: "expedia",
    name: "Expedia",
    shortName: "Expedia",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes:
      "Bolgesel Expedia otel sayfasinda oda kartlarinin mevcut konaklama toplamini okur; tarih/kisi/para birimi dogrulanmayan veya erisim engelli sonuc manual-review kalir.",
    supportedScopes: ["beach-eu", "beach-uk", "queen-eu", "queen-uk"],
    searchTemplate:
      "https://www.expedia.com/Hotel-Search?destination={hotelName}&startDate={checkIn}&endDate={checkOut}",
  },
  {
    key: "hotelbeds",
    name: "Hotelbeds",
    shortName: "Hotelbeds",
    collectionType: "api",
    liveSupported: true,
    readiness: "api-contract",
    notes:
      "Live beta aktif. Availability istegi icin resmi Hotelbeds API kullaniliyor; Api-key, X-Signature, mTLS sertifikasi ve hotel code env degerleri gerekli.",
    supportedScopes: ["beach-eu", "queen-eu"],
  },
  {
    key: "holidaycheck",
    name: "HolidayCheck",
    shortName: "HolidayCheck",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes:
      "Live beta aktif. Exact-date hotel-only offer sayfasi acilip all-offers-service cevabindan oda ve fiyat okunuyor.",
    supportedScopes: ["beach-eu", "queen-eu"],
    searchTemplate:
      "https://www.holidaycheck.de/suche?search={hotelName}&from={checkIn}&to={checkOut}",
  },
  {
    key: "loveholidays",
    name: "Loveholidays",
    shortName: "Loveholidays",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes:
      "Hotel Only oda seceneklerinden konaklama toplamini okur; GBP ve EUR, secilen tarih ve 1 oda/2 yetiskin dogrulanir. Ucakli paket ve gecelik fiyatlar kullanilmaz.",
    supportedScopes: ["beach-uk", "beach-eu", "queen-eu", "queen-uk"],
    searchTemplate:
      "https://www.loveholidays.com/holidays/?query={hotelName}&date={checkIn}",
  },
  {
    key: "onthebeach",
    name: "On the Beach",
    shortName: "OTB",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes:
      "Hotel Only formu: secilen tarih, 2-28 gece, 1 oda/2 yetiskin; otel adi ve Total Hotel Price / per party dogrulanir. GBP toplam oda fiyatini okur.",
    supportedScopes: ["beach-uk", "queen-uk"],
    searchTemplate: "https://www.onthebeach.co.uk/_p/hotels",
  },
  {
    key: "tui",
    name: "TUI",
    shortName: "TUI",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes:
      "Live beta aktif. Resmi TUI offer endpoint'inden hotel-only teklifleri ve oda aciklamalari okunuyor.",
    supportedScopes: ["beach-eu", "queen-eu"],
    searchTemplate:
      "https://www.tui.com/pauschalreisen/suchen/hotels/?search={hotelName}&from={checkIn}",
  },
];
