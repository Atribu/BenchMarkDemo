import type { CurrencyCode, HotelKey } from "@/src/lib/benchmark/types";

interface OtaHotelConfig {
  pageUrl: string;
  roomAliases: Record<string, string[]>;
  searchQuery?: string;
  cardName?: string;
  propertyId?: string;
}

interface TuiMarketConfig {
  hotelId?: string;
  productId?: string;
  market: "de" | "uk";
  locale: "de-DE" | "en-GB";
  sourcing?: string;
}

interface TuiHotelConfig {
  giataId: number;
  offerSlug: string;
  offerPageUrl: string;

  markets: Partial<
    Record<CurrencyCode, TuiMarketConfig>
  >;

  roomAliases: Record<string, string[]>;
}

interface SchauinslandHotelConfig {
  giataId: string;
  pageUrl: string;
  market: "de";
  currency: "EUR";
}

interface AnexHotelConfig {
  accommodationId: string;
  ruHotelId?: string;
  ruHotelSlug?: string;
  roomMatchers: {
    roomId: string;
    patterns: RegExp[];
  }[];
}

export const ANEX_HOTEL_CONFIG: Partial<
  Record<HotelKey, AnexHotelConfig>
> = {
  "miramare-beach": {
    accommodationId: "1708",
    roomMatchers: [
      {
        roomId: "economy",
        patterns: [/\b(economy|ekonomi|ekonom|sparzimmer)\b/],
      },
      { roomId: "corner", patterns: [/\b(corner|eckzimmer|kose)\b/] },
      {
        roomId: "superior-land",
        patterns: [
          /(?=.*\b(superior)\b)(?=.*\b(land|kara|garden|garten)\b)/,
        ],
      },
      {
        roomId: "superior-sea",
        patterns: [
          /(?=.*\b(superior)\b)(?=.*\b(meerblick|sea view|deniz)\b)(?!.*\b(seitl|seitlich|side sea|partial sea|teilmeerblick)\b)/,
        ],
      },
    ],
  },
  "port-nature": {
    accommodationId: "136301",
    ruHotelId: "8356",
    ruHotelSlug: "port-nature-luxury-resort-hotelspa",
    roomMatchers: [
      {
        roomId: "family",
        patterns: [/\b(familienzimmer|family room|fz)\b/],
      },
      { roomId: "king-suite", patterns: [/\b(king suite|konigssuite)\b/] },
      {
        roomId: "standard-side-sea",
        patterns: [
          /(?=.*\b(standard|doppelzimmer|double room)\b)(?=.*\b(seitl|seitlich|side sea|partial sea|teilmeerblick)\b)/,
        ],
      },
      {
        roomId: "standard-land",
        patterns: [
          /(?=.*\b(standard|doppelzimmer|double room)\b)(?=.*\b(landblick|land view|garden view|gartenblick)\b)/,
        ],
      },
      {
        roomId: "standard-sea",
        patterns: [
          /(?=.*\b(standard|doppelzimmer|double room)\b)(?=.*\b(meerblick|sea view|ocean view)\b)(?!.*\b(seitl|seitlich|side sea|partial sea|teilmeerblick)\b)/,
        ],
      },
    ],
  },
};

export const BOOKING_HOTEL_CONFIG: Partial<Record<HotelKey, OtaHotelConfig>> = {
  "miramare-beach": {
    pageUrl: "https://www.booking.com/hotel/tr/miramare-beach-hotel-side.html",
    searchQuery: "Miramare Beach Hotel Ultra All Inclusive",
    cardName: "Miramare Beach Hotel - Ultra All Inclusive",
    roomAliases: {
      "superior-land": ["Superior Room with Land View"],
      "superior-sea": ["Superior Room with Sea View"],
      economy: [
        "Economy Room",
        "Economy Doppelzimmer",
        "Doppelzimmer Economy",
        "Double Economy Room"
      ],
      corner: ["Superior Corner Room", "Corner Room"]
    }
  },
  "miramare-queen": {
    pageUrl: "https://www.booking.com/hotel/tr/miramare-queen.ro.html",
    searchQuery: "Miramare Queen Hotel All Inclusive",
    cardName: "Miramare Queen Hotel - Ultra All Inclusive",
    roomAliases: {
      "standard-land": [
        "Standard Room",
        "Standard Room with Garden View",
        "Double Room with Garden View"
      ],
      "standard-sea": [
        "Standard Room, Sea View",
        "Double Room with Sea View",
        "Sea View"
      ]
    }
  },
  "port-nature": {
    pageUrl:
      "https://www.booking.com/hotel/tr/port-nature-luxury-resort-amp-spa.html",
    searchQuery: "Port Nature Luxury Resort Hotel & Spa",
    cardName: "Port Nature Luxury Resort",
    roomAliases: {
      "standard-land": [
        "Standard Double or Twin Room with Land View",
        "Standard Room with Land View",
        "Double or Twin Room with Land View",
        "Triple Room with Land View",
      ],
      "standard-side-sea": [
        "Standard Double or Twin Room with Side Sea View",
        "Standard Room with Side Sea View",
        "Double or Twin Room with Side Sea View",
        "Triple Room with Side Sea View",
      ],
      "standard-sea": [
        "Standard Double or Twin Room with Sea View",
        "Standard Room with Sea View",
        "Double or Twin Room with Sea View",
        "Triple Room with Sea View",
      ],
      family: [
        "Family Room with Side Sea View",
        "Family Room with Sea View",
        "Family Room",
      ],
      "king-suite": ["King Suite with Sea View", "King Suite"],
    },
  },
  "sy-hotels-belek": {
    pageUrl: "https://www.booking.com/hotel/tr/sy-hotels-belek.html",
    searchQuery: "SY Hotels Belek Boutique Luxury",
    cardName: "Sy Hotels Belek",
    roomAliases: {
      "deluxe-land": ["Deluxe Room with Land View", "Deluxe Land View"],
      "deluxe-pool": ["Deluxe Room with Pool View", "Deluxe Pool View"],
      "deluxe-superior": ["Deluxe Superior Room", "Superior Deluxe Room"],
      "deluxe-family": ["Deluxe Family Room"],
      "deluxe-duplex-family": ["Deluxe Duplex Family Room"],
      "deluxe-swim-up": ["Deluxe Swim-Up Room", "Deluxe Swim Up Room"],
      "deluxe-family-swim-up": [
        "Deluxe Swim-Up Family Room",
        "Deluxe Family Swim Up Room",
      ],
      "deluxe-shallow-pool": ["Deluxe Shallow Pool Room"],
    },
  },
};

export const EXPEDIA_HOTEL_CONFIG: Partial<Record<HotelKey, OtaHotelConfig>> = {
  "miramare-beach": {
    pageUrl:
      "https://www.expedia.com/Side-Hotels-Miramare-Beach-Hotel.h12354286.Hotel-Information",
    roomAliases: {
      "superior-land": [
        "Superior Room with Land View",
        "Superior Room Land View",
        "Superior Land View"
      ],
      "superior-sea": [
        "Superior Room with Sea View",
        "Superior Room Sea View",
      ],

      "economy":[
        "Economy Room",
        "Economy",
        "Great for two",
        "Economy Doppelzimmer",
        "Doppelzimmer Economy"
      ],

       "corner": [
        "Superior Corner Room",
        "Corner Room",
      ],
    }
  },
  "miramare-queen": {
    pageUrl:
      "https://www.expedia.com/Side-Hotels-Miramare-Queen-Hotel-All-Inclusive.h12354488.Hotel-Information",
    roomAliases: {
      "standard-land": ["Standard Room"],
      "standard-sea": ["Standard Room, Sea View", "Sea View"]
    }
  },
  "port-nature": {
    pageUrl:
      "https://www.expedia.com/Belek-Hotels-Port-Nature-Luxury-Resort-Spa-All-Inclusive.h8108100.Hotel-Information",
    roomAliases: {
      "standard-land": [
        "Standard Room, Land View",
        "Standard Room, Garden View",
        "Standard Room, Garden or Land View",
      ],
      "standard-side-sea": [
        "Standard Room, Side Sea View",
        "Standard Room, Partial Sea View",
      ],
      "standard-sea": ["Standard Room, Sea View"],
      family: [
        "Family Room, Side Sea View",
        "Family Room, Partial Sea View",
      ],
      "king-suite": ["King Suite, Sea View", "King Suite"],
    },
  },
  "sy-hotels-belek": {
    pageUrl:
      "https://www.expedia.com/Serik-Hotels-Sy-Hotels-Belek.h112329850.Hotel-Information",
    roomAliases: {
      "deluxe-land": [
        "Deluxe Room, Land View",
        "Deluxe Room Land view",
        "Deluxe Land View",
      ],
      "deluxe-pool": ["Deluxe Room, Pool View", "Deluxe Pool View"],
      "deluxe-superior": ["Deluxe Superior Room", "Deluxe Superior"],
      "deluxe-family": ["Deluxe Family Room"],
      "deluxe-duplex-family": ["Deluxe Duplex Family Room"],
      "deluxe-swim-up": ["Deluxe Swim-Up Room", "Deluxe Swim Up Room"],
      "deluxe-family-swim-up": [
        "Deluxe Swim-Up Family Room",
        "Deluxe Family Swim-Up Room",
      ],
      "deluxe-shallow-pool": ["Deluxe Shallow Pool Room"],
    },
  },
};

export const HOLIDAYCHECK_HOTEL_CONFIG: Partial<Record<HotelKey, OtaHotelConfig>> = {
  "miramare-beach": {
    pageUrl:
      "https://www.holidaycheck.de/hi/hotel-miramare-beach/976607ee-0f98-365d-bdbf-f96af4b03a6d",
    roomAliases: {
      "superior-land": [
        "landseite",
        "doppelzimmer landseite",
        "zimmer landseite",
        "land view",
        "garden view",
        "inland view",
        "Superior-Standardzimmer mit Blick ins Grüne"
      ],
      "superior-sea": [
        "meerblick",
        "direkter meerblick",
        "sea view",
        "Superior-Standardzimmer mit Meerblick"
      ],

            "economy":[
        "Economy Room",
        "Economy",
        "Great for two",
        "Economy Doppelzimmer",
        "Doppelzimmer Economy"
      ],

       "corner": [
        "Superior Corner Room",
        "Corner Room",
      ],
    }
  },
  "miramare-queen": {
    pageUrl:
      "https://www.holidaycheck.de/hi/miramare-queen-hotel/967550f2-2468-3829-ae9c-827ee3b91557",
    roomAliases: {
      "standard-land": [
        "landseite",
        "doppelzimmer",
        "super sparzimmer",
        "economy",
        "bestpreiszimmer",
        "gartenblick",
        "garden view",
        "Superior-Standardzimmer mit Blick ins Grüne"
      ],
      "standard-sea": [
        "meerblick",
        "direkter meerblick",
        "sea view",
        "Superior-Standardzimmer mit Meerblick"
      ],

       "economy":[
        "Economy Room",
        "Economy",
        "Great for two",
        "Economy Doppelzimmer",
        "Doppelzimmer Economy"
      ],

       "corner": [
        "Superior Corner Room",
        "Corner Room",
      ],
    }
  },
  "port-nature": {
    pageUrl:
      "https://www.holidaycheck.de/hi/port-nature-luxury-resort-spa/6a10924b-2286-3a46-b5db-ad9802b8d226",
    roomAliases: {
      "standard-land": [
        "Doppelzimmer",
        "Doppelzimmer Landblick",
        "Doppelzimmer mit Landblick",
      ],
      "standard-side-sea": [
        "DZ seitl. Meerblick",
        "Doppelzimmer seitl. Meerblick",
        "Doppelzimmer mit seitlichem Meerblick",
      ],
      "standard-sea": ["Doppelzimmer Meerblick", "Doppelzimmer mit Meerblick"],
      family: ["Familienzimmer", "FZ seitl. Meerblick"],
      "king-suite": ["King Suite", "Königssuite"],
    },
  },
  "sy-hotels-belek": {
    pageUrl:
      "https://www.holidaycheck.de/hi/sy-luxury-belek/3c0937bc-b1d6-42a8-9280-0644000c2a43",
    roomAliases: {
      "deluxe-land": [
        "Deluxe Land View",
        "Deluxe Zimmer Landblick",
        "Doppelzimmer Deluxe Landseite Klimaanlage Dusche Balkon",
        "Deluxe Room Land view",
        "Deluxe Room Land View - 1 Queen Bed And 1 Large Twin Sofa Bed",
      ],
      "deluxe-pool": [
        "Deluxe Pool View",
        "Deluxe Zimmer Poolblick",
        "Double Standard Room Pool View",
        "Doppelzimmer, Poolblick",
        "Standard Doppel Zimmer Poolblick",
        "Doppelzimmer Poolblick",
        "Doppelzimmer Deluxe Poolblick Klimaanlage Dusche Balkon",
        "Doppelzimmer Deluxe Poolblick",
      ],
      "deluxe-superior": ["Deluxe Superior Room", "Deluxe Superior Zimmer"],
      "deluxe-family": ["Deluxe Family Room", "Deluxe Familienzimmer"],
      "deluxe-duplex-family": ["Deluxe Duplex Family Room"],
      "deluxe-swim-up": [
        "Deluxe Swim Up Room",
        "Deluxe Room With Swim Up Pool And Terrace",
        "Doppelzimmer Swim Up",
        "Double Deluxe Room with Terrace with Swimup Pool",
        "Deluxe Doppel Zimmer mit Terrasse und Swimup Pool",
        "Doppelzimmer Deluxe swim-up Poolblick Klimaanlage Dusche Terrasse",
        "DZ Deluxe Poolzugang Terr",
      ],
      "deluxe-family-swim-up": [
        "Deluxe Family Swim Up",
        "Deluxe Family Room With Swim Up Pool And Terrace",
        "Familienzimmer swim-up Poolblick Klimaanlage Dusche Terrasse",
        "Deluxe Familien Zimmer mit Terrasse und Swimup Pool",
        "Deluxe Family Room with Terrace with Swimup Pool",
        "Deluxe Family Swim-Up Room",
        "Deluxe Family Swim-Up Room - 1 Queen Bed And 2 Large Twin Beds",
      ],
      "deluxe-shallow-pool": [
        "Deluxe Shallow Pool Room",
        "Deluxe Shallow Pool Room - 1 Queen Bed",
      ],
    },
  },
};

export const LOVEHOLIDAYS_HOTEL_CONFIG: Partial<Record<HotelKey, OtaHotelConfig>> = {
  "miramare-queen": {
    pageUrl: "https://www.loveholidays.com/holidays/turkey/antalya/side/miramare-queen.html",
    roomAliases: {
     "standard-land": [
      "Standard Room Land View",
      "Standard Land View",
      "Standard Room",
      "Land View",
      "Garden View",
      "Inland View",
      "Standardzimmer mit Landblick",
      "Standardzimmer mit Gartenblick",
      "Standardzimmer mit Blick ins Grüne",
      "Doppelzimmer mit Landblick",
      "Doppelzimmer mit Gartenblick"
    ],
    "standard-sea": [
      "Standard Room Sea View",
      "Standard Sea View",
      "Sea View",
      "Standardzimmer mit Meerblick",
      "Standard-Doppelzimmer mit Meerblick",
      "Doppelzimmer mit Meerblick",
    ]
    }
  },
  "miramare-beach": {
    pageUrl: "https://www.loveholidays.com/de/urlaub/tuerkei/antalya/side/miramare-beach/",
    roomAliases: {
      "superior-land": [
        "Superior Doppel- oder Zweibettzimmer mit Landblick",
        "Superior-Standardzimmer mit Blick ins Grüne",
        "land view",
      ],
      "superior-sea": [
        "Superior Doppel- oder Zweibettzimmer mit Meerblick",
        "Superior-Standardzimmer mit Meerblick",
        "sea view",
      ],

            "economy":[
        "Economy Room",
        "Economy",
        "Great for two",
        "Economy Doppelzimmer",
        "Doppelzimmer Economy"
      ],

       "corner": [
        "Superior Corner Room",
        "Corner Room",
        "Eckzimmer (Standard)",
      ],
    }
  },
  "sy-hotels-belek": {
    pageUrl:
      "https://www.loveholidays.com/holidays/turkey/antalya/belek/sy-hotels-belek-boutique-luxury.html",
    roomAliases: {
      "deluxe-land": ["Deluxe Standard Room with Land View Land View"],
      "deluxe-pool": ["Deluxe Pool View Room"],
      "deluxe-superior": ["Deluxe Superior Standard Room"],
      "deluxe-family": ["Deluxe Family Room"],
      "deluxe-duplex-family": ["Deluxe Duplex Family Room"],
      "deluxe-swim-up": ["Deluxe Swim-Up Standard Room"],
      "deluxe-family-swim-up": ["Deluxe Swim-Up Family Room"],
      "deluxe-shallow-pool": ["Deluxe Shallow Pool Room"],
    },
  },
};

export const ONTHEBEACH_HOTEL_CONFIG: Partial<Record<HotelKey, OtaHotelConfig>> = {
  "miramare-queen": {
    pageUrl: "https://www.onthebeach.co.uk/hotels/turkey/antalya/side/miramare-queen",
    roomAliases: {
      "standard-land": [
      "Standard Room Land View",
      "Standard Land View",
      "Standard Room",
      "Land View",
      "Garden View",
      "Inland View",
      "Standardzimmer mit Landblick",
      "Standardzimmer mit Gartenblick",
      "Standardzimmer mit Blick ins Grüne",
      "Doppelzimmer mit Landblick",
      "Doppelzimmer mit Gartenblick"
    ],
    "standard-sea": [
      "Standard Room Sea View",
      "Standard Sea View",
      "Sea View",
      "Standardzimmer mit Meerblick",
      "Standard-Doppelzimmer mit Meerblick",
      "Doppelzimmer mit Meerblick",
    ]
    }
  },
  "miramare-beach": {
    pageUrl: "https://www.onthebeach.co.uk/hotels/turkey/antalya/side/miramare-beach",
    roomAliases: {
            "economy":[
        "Economy Room",
        "Economy",
        "Great for two",
        "Economy Doppelzimmer",
        "Doppelzimmer Economy",
        "Double Or Twin Superior Promo Landview No Balcony"
      ],

       "corner": [
         "Superior Corner",
        "Superior Corner Room",
        "Corner Room",
        "Double Or Twin Superior Corner Balcony",
      ],
    }
  },
  "port-nature": {
    pageUrl:
      "https://www.onthebeach.co.uk/hotels/turkey/antalya/belek/port-nature-luxury-resort-hotel-spa",
    roomAliases: {
      "standard-land": [
        "Standard Room Land View",
        "Standard Land View",
        "Double Or Twin Standard Land View",
      ],
      "standard-side-sea": [
        "Standard Room Side Sea View",
        "Standard Side Sea View",
        "Double Or Twin Standard Side Sea View",
        "Standard Room Partial Sea View",
      ],
      "standard-sea": [
        "Standard Room Sea View",
        "Standard Sea View",
        "Double Or Twin Standard Sea View",
      ],
      family: ["Family Room Side Sea View", "Family Room"],
      "king-suite": ["King Suite Sea View", "King Suite"],
    },
  },
  "sy-hotels-belek": {
    pageUrl:
      "https://www.onthebeach.co.uk/hotels/turkey/antalya/belek/sy-hotels-boutique-luxury",
    cardName: "SY Hotels Boutique Luxury",
    propertyId: "3143226",
    roomAliases: {
      "deluxe-land": ["Deluxe Land View", "Deluxe Room Land View"],
      "deluxe-pool": ["Deluxe Pool View", "Deluxe Room Pool View"],
      "deluxe-superior": ["Deluxe Superior Room"],
      "deluxe-family": ["Deluxe Family Room"],
      "deluxe-duplex-family": ["Deluxe Duplex Family Room"],
      "deluxe-swim-up": ["Deluxe Swim Up Room", "Deluxe Swim-Up Room"],
      "deluxe-family-swim-up": ["Deluxe Family Swim Up Room"],
      "deluxe-shallow-pool": ["Deluxe Shallow Pool Room"],
    },
  },
};

export const TUI_HOTEL_CONFIG: Partial<Record<HotelKey, TuiHotelConfig>> = {
  "miramare-beach": {
    giataId: 4893,
  markets: {
    EUR: {
      market: "de",
      locale: "de-DE",
    },
  },
    offerSlug: "Hotel-Miramare-Beach",
    offerPageUrl: "https://www.tui.com/hotels/hotel-miramare-beach-4893/hotelinformation/",
    roomAliases: {
      "superior-land": ["Superior Land View", "Superior Corner"],
      "superior-sea": [
        "Superior Sea View",
        "Superior Room Sea View"
      ],

            "economy":[
        "Economy Room",
        "Economy",
        "Great for two",
        "Superior Land View Best Price without Balcony",
        "Doppel Standard Zimmer (Economy)"
      ],

       "corner": [
        "Superior Corner Room",
        "Corner Room",
      ],
    }
  },
  "miramare-queen": {
    giataId: 4894,
  offerSlug: "Hotel-Miramare-Queen",
  offerPageUrl:
    "https://www.tui.co.uk/hotels/miramare-queen-a0319662/",

     markets: {
    GBP: {
      hotelId: "A0319662",
      productId: "4924fd92-bd32-4763-a0dd-7d9bf76c872e",
      market: "uk",
      locale: "en-GB",
      sourcing: "DYNAMIC",
    },
  },

  roomAliases: {
      "standard-land": [
      "Standard Room Land View",
      "Standard Land View",
      "Standard Room",
      "Land View",
      "Garden View",
      "Inland View",
      "Standardzimmer mit Landblick",
      "Standardzimmer mit Gartenblick",
      "Standardzimmer mit Blick ins Grüne",
      "Doppelzimmer mit Landblick",
      "Doppelzimmer mit Gartenblick"
    ],
    "standard-sea": [
      "Standard Room Sea View",
      "Standard Sea View",
      "Sea View",
      "Standardzimmer mit Meerblick",
      "Standard-Doppelzimmer mit Meerblick",
      "Doppelzimmer mit Meerblick",
    ]
    }
  },
  "sy-hotels-belek": {
    giataId: 1449005,
    offerSlug: "Hotel-SY-Hotels-Belek-Boutique-Luxury",
    offerPageUrl:
      "https://www.tui.com/hotels/sy-hotels-belek-boutique-luxury-1449005/hotelinformation/",
    markets: {
      EUR: {
        market: "de",
        locale: "de-DE",
      },
    },
    roomAliases: {
      "deluxe-land": ["Deluxe Land View", "Deluxe Zimmer Landblick"],
      "deluxe-pool": [
        "Deluxe Pool View",
        "Deluxe Zimmer Poolblick",
        "Double Standard Room Pool View",
      ],
      "deluxe-superior": ["Deluxe Superior Room"],
      "deluxe-family": ["Deluxe Family Room"],
      "deluxe-duplex-family": ["Deluxe Duplex Family Room"],
      "deluxe-swim-up": [
        "Deluxe Swim Up Room",
        "Double Deluxe Room with Terrace with Swimup Pool",
      ],
      "deluxe-family-swim-up": [
        "Deluxe Family Swim Up Room",
        "Deluxe Familien Zimmer mit Terrasse und Swimup Pool",
        "Deluxe Family Room with Terrace with Swimup Pool",
      ],
      "deluxe-shallow-pool": ["Deluxe Shallow Pool Room"],
    },
  },
};


export const SCHAUINSLAND_HOTEL_CONFIG: Partial<
  Record<HotelKey, SchauinslandHotelConfig>
> = {
  "miramare-beach": {
    giataId: "4893",
    pageUrl:
      "https://www.schauinsland-reisen.de/hotel/4893-miramare-beach-hotel",
    market: "de",
    currency: "EUR",
  },
  "miramare-queen": {
    giataId: "4894",
    pageUrl:
      "https://www.schauinsland-reisen.de/hotel/4894-miramare-queen-hotel",
    market: "de",
    currency: "EUR",
  },
  "sy-hotels-belek": {
    giataId: "1449005",
    pageUrl:
      "https://www.schauinsland-reisen.de/hotel/1449005-sy-hotels-belek-boutique-luxury",
    market: "de",
    currency: "EUR",
  },
};



export const CHECK24_HOTEL_CONFIG = {
  "miramare-beach": {
    hotelId: "7776197",
    hotelName: "Miramare Beach Hotel - Ultra All Inclusive",
    pageUrl: "https://hotel.check24.de/hotel/turkey/7776197",
    market: "de",
    currency: "EUR",
  },
  "miramare-queen": {
    hotelId: "8571549",
    hotelName: "Miramare Queen Hotel - Ultra All Inclusive",
    pageUrl: "https://hotel.check24.de/hotel/turkey/8571549",
    market: "de",
    currency: "EUR",
    accommodationId: "019ab52936e17297ae2c11519fcc3f33",
  },
  "port-nature": {
    hotelId: "8393120",
    hotelName: "Port Nature Luxury Resort",
    pageUrl: "https://hotel.check24.de/hotel/turkey/8393120",
    market: "de",
    currency: "EUR",
    accommodationId: "019ab528fa947e0c8466cf670e1024e9",
    accommodationSlug: "port-nature-luxury-resort",
  },
  "sy-hotels-belek": {
    hotelId: "36332042",
    hotelName: "Sy Hotels Belek - All inclusive",
    pageUrl: "https://hotel.check24.de/hotel/turkey/36332042",
    market: "de",
    currency: "EUR",
    accommodationId: "019ab53308e673799d4d0b164fb80e79",
  },
} as const;


interface CoralTravelHotelConfig {
  pageUrl: string;
  hotelName: string;
  market: "de" | "ru";
  currency: "EUR" | "RUB";
  giataId?: string;
  searchQuery?: string;
  suggestion?: string;
  ruLocation?: {
    id: string;
    requestId: string;
    friendlyUrl: string;
    parentId: string;
    parentName: string;
  };
}

export const CORALTRAVEL_HOTEL_CONFIG: Partial<
  Record<HotelKey, CoralTravelHotelConfig>
> = {
  "miramare-beach": {
    pageUrl:
      "https://coraltravel.de/hotels/miramare-beach-hotel/",
    hotelName: "Miramare Beach Hotel",
    market: "de",
    currency: "EUR",
    giataId: "4893",
    searchQuery: "Miramare Beach",
    suggestion: "Miramare Beach Hotel",
  },

  "miramare-queen": {
    pageUrl:
      "https://coraltravel.de/hotels/miramare-queen-hotel/",
    hotelName: "Miramare Queen Hotel",
    market: "de",
    currency: "EUR",
  },
  "port-nature": {
    pageUrl:
      "https://www.coral.ru/hotels/turkey/port-nature-luxury-resort-hotel-spa-belek/",
    hotelName: "PORT NATURE LUXURY RESORT HOTEL & SPA",
    market: "ru",
    currency: "RUB",
    giataId: "365454",
    searchQuery: "Port Nature",
    suggestion: "Port Nature Luxury Resort Hotel & Spa",
    ruLocation: {
      id: "10197-7",
      requestId: "10197-7-100-6",
      friendlyUrl: "turkey/port-nature-luxury-resort-hotel-spa-belek",
      parentId: "100",
      parentName: "Боазкент (Bogazkent), Белек (Belek), Турция",
    },
  },
  "sy-hotels-belek": {
    pageUrl: "https://coraltravel.de/hotels/sy-hotels-belek/",
    hotelName: "SY Hotels Belek Boutique Luxury",
    market: "de",
    currency: "EUR",
  },
};
