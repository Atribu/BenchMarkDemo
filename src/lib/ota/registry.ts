import type { ProviderDescriptor } from "@/src/lib/benchmark/types";

export const OTA_PROVIDERS: ProviderDescriptor[] = [
  {
  key: "anextour",
  name: "ANEX Tour",
  shortName: "ANEX",
  collectionType: "browser",
  liveSupported: true,
  readiness: "selector-mapping",
  notes:
    "Miramare Beach ve Port Nature Almanya EUR hotel-only akışından; Port Nature ayrıca ANEX Rusya RUB hotel-only akışından sorgulanır. RUB kaynak fiyatı korunur; panelde TCMB resmi günlük satış kuruyla EUR karşılığı gösterilir.",
  supportedScopes: ["beach-eu", "port-nature-eu", "port-nature-ru"],
  searchTemplate: "https://anextour.ru/hotels/",
},
  {
    key: "booking",
    name: "Booking.com",
    shortName: "Booking",
    collectionType: "browser",
    liveSupported: true,
    readiness: "selector-mapping",
    notes:
      "Dogrudan otel oda tablosunu okur; tarih, kisi, para birimi ve konaklama toplamini dogrular. Ana sayfaya yonlendirme veya erisim engeli doluluk olarak isaretlenmez.",
    supportedScopes: [
      "beach-eu",
      "beach-uk",
      "queen-eu",
      "queen-uk",
      "port-nature-eu",
      "sy-hotels-eu",
      "sy-hotels-uk",
    ],
    searchTemplate:
      "https://www.booking.com/searchresults.html?ss={hotelName}&checkin={checkIn}&checkout={checkOut}",
  },

{
  key: "check24",
  name: "CHECK24 Hotels",
  shortName: "CHECK24",
  collectionType: "browser",
  liveSupported: true,
  readiness: "selector-mapping",
  notes:
    "CHECK24 Almanya canlı otel fiyatları. " +
    "Miramare Beach için eski ve yeni API; Miramare Queen, Port Nature ve SY Hotels için tarihli otel araması desteklenir. " +
    "Seçilen tarih, 1 oda / 2 yetişkin, EUR ve " +
    "All Inclusive fiyat adayları toplanır. " +
    "Queen için yalnızca açık kara ve tam deniz manzaralı standart oda adları eşleştirilir; " +
    "genel, yandan deniz, superior, aile ve suite odalar kapsam dışında kalır. " +
    "İptal ve vergi koşulları ayrıca doğrulanmalıdır.",
  supportedScopes: [
    "beach-eu",
    "queen-eu",
    "port-nature-eu",
    "sy-hotels-eu",
  ],
  searchTemplate: "https://hotels.check24.de/",
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
    supportedScopes: [
      "beach-eu",
      "beach-uk",
      "queen-eu",
      "queen-uk",
      "port-nature-eu",
      "sy-hotels-eu",
      "sy-hotels-uk",
    ],
    searchTemplate:
      "https://www.expedia.com/Hotel-Search?destination={hotelName}&startDate={checkIn}&endDate={checkOut}",
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
    supportedScopes: [
      "beach-eu",
      "queen-eu",
      "port-nature-eu",
      "sy-hotels-eu",
    ],
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
    supportedScopes: [
      "beach-uk",
      "queen-uk",
      "port-nature-uk",
      "sy-hotels-uk",
    ],
    searchTemplate: "https://www.onthebeach.co.uk/_p/hotels",
  },
  {
    key: "pegastour",
    name: "PEGAS Touristik",
    shortName: "PEGAS",
    collectionType: "browser",
    liveSupported: true,
    readiness: "api-contract",
    notes:
      "Port Nature ve SY Hotels için Pegas Rusya hotel-only tekliflerini okur. Kesin tarih, 1 oda / 2 yetişkin, RUB, All Inclusive ve konaklama toplamı doğrulanır; uçuşlu paket ve gecelik fiyatlar kullanılmaz.",
    supportedScopes: ["port-nature-ru", "sy-hotels-ru"],
    searchTemplate:
      "https://pegast.ru/hotel/turkey/antalya/belek/port-nature-luxury-resort-hotel-and-spa-6609069",
  },
  {
    key: "restplatzboerse",
    name: "Restplatzbörse",
    shortName: "Restplatz",
    collectionType: "api",
    liveSupported: true,
    readiness: "api-contract",
    notes:
      "Miramare Beach, Miramare Queen, Port Nature ve SY Hotels için Restplatzbörse/Flux hotel-only tekliflerini okur. " +
      "Kesin tarih, 1 oda / 2 yetişkin, EUR, oda kodu ve All Inclusive pansiyon " +
      "doğrulanır; kişi başı fiyat yerine verify-offer toplamı kullanılır.",
    supportedScopes: [
      "beach-eu",
      "queen-eu",
      "port-nature-eu",
      "sy-hotels-eu",
    ],
    searchTemplate: "https://www.restplatzboerse.at/hotels/",
  },
  {
    key: "stayforlong",
    name: "Stayforlong",
    shortName: "Stayforlong",
    collectionType: "api",
    liveSupported: true,
    readiness: "api-contract",
    notes:
      "Miramare Beach, Miramare Queen ve Port Nature için Stayforlong Almanya hotel-only availability tekliflerini okur. " +
      "Kesin tarih, 1 oda / 2 yetişkin, EUR, All Inclusive, oda kodu ve vergiler " +
      "doğrulanır; son toplam bookingRules servisiyle yeniden kontrol edilir.",
    supportedScopes: ["beach-eu", "queen-eu", "port-nature-eu"],
    searchTemplate:
      "https://www.stayforlong.de/de-de/hotel/tr/port-nature-luxury-resort_serik",
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
    supportedScopes: ["beach-eu", "queen-uk", "sy-hotels-eu"],
    searchTemplate:
      "https://www.tui.com/pauschalreisen/suchen/hotels/?search={hotelName}&from={checkIn}",
  },


{
  key: "schauinsland",
  name: "Schauinsland Reisen",
  shortName: "Schauinsland",
  collectionType: "browser",
  liveSupported: true,
  readiness: "selector-mapping",
  notes:
    "Schauinsland Reisen GraphQL getOfferList uzerinden " +
    "yalnizca SLR operatorune ait HOTEL_ONLY teklifleri toplanir. " +
    "Secilen tarih, 1 oda / 2 yetiskin ve EUR toplam fiyat dogrulanir. " +
    "Canli collector baglantisi henuz tamamlanmadi." + "Canli GraphQL collector, oda eslestirme, " +
"pansiyon filtreleme ve pagination destegi aktif. " +
"Iptal ve vergi kosullari ayrica dogrulanmali.",
  supportedScopes: ["beach-eu", "queen-eu", "sy-hotels-eu"],
  searchTemplate:
    "https://www.schauinsland-reisen.de/hotel/4893-miramare-beach-hotel",
},

{
  key: "coraltravel",
  name: "Coral Travel",
  shortName: "Coral",
  collectionType: "browser",
  liveSupported: true,
  readiness: "selector-mapping",
  notes:
    "Miramare Beach Coral Travel Almanya EUR, Port Nature Coral Travel Rusya RUB hotel-only akışından sorgulanır. RUB kaynak fiyatı korunur; panelde TCMB resmi günlük satış kuruyla EUR karşılığı gösterilir. " +
    "Her iki otel için gerçek otel kimliğiyle fiyat API'si test edildi. " +
    "Miramare Queen tanıtım sayfası kayıtlıdır; ancak Almanya rezervasyon motoru oteli canlı önerilerde döndürmediği için kimlik ve fiyat akışı henüz doğrulanmadı.",
  supportedScopes: ["beach-eu", "port-nature-ru"],
  searchTemplate: "https://www.coral.ru/",
},

];
