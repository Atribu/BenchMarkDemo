import type { CurrencyCode, HotelKey } from "@/src/lib/benchmark/types";

interface OtaHotelConfig {
  pageUrl: string;
  roomAliases: Record<string, string[]>;
  searchQuery?: string;
  cardName?: string;
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
      "superior-land": ["Superior Room with Land View", "Superior Corner Room"],
      "superior-sea": [
        "Superior Room with Sea View",
        "Superior Room with Side Sea View"
      ],
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
      "standard-sea": ["Triple Room with Sea View"],
      family: ["Family Room with Side Sea View"],
    },
  }
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
        "Superior Room with Side Sea View",
        "Superior Side Sea View",
        "Sea View"
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
        "teilmeerblick",
        "seitlicher meerblick",
        "sea view",
        "side sea view",
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
        "teilmeerblick",
        "seitlicher meerblick",
        "sea view",
        "side sea view",
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
      "Side Sea View",
      "Partial Sea View",
      "Standardzimmer mit Meerblick",
      "Standard-Doppelzimmer mit Meerblick",
      "Doppelzimmer mit Meerblick",
      "Zimmer mit seitlichem Meerblick",
      "Standardzimmer mit seitlichem Meerblick"
    ]
    }
  },
  "miramare-beach": {
    pageUrl: "https://www.loveholidays.com/de/urlaub/tuerkei/antalya/side/miramare-beach/",
    roomAliases: {
      "superior-land": ["Superior Doppel- oder Zweibettzimmer mit Landblick", "land view"],
      "superior-sea": ["Superior Doppel- oder Zweibettzimmer mit Meerblick", "sea view"],

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
  }
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
      "Side Sea View",
      "Partial Sea View",
      "Standardzimmer mit Meerblick",
      "Standard-Doppelzimmer mit Meerblick",
      "Doppelzimmer mit Meerblick",
      "Zimmer mit seitlichem Meerblick",
      "Standardzimmer mit seitlichem Meerblick"
    ]
    }
  },
  "miramare-beach": {
    pageUrl: "https://www.onthebeach.co.uk/hotels/turkey/antalya/side/miramare-beach",
    roomAliases: {
      "superior-land": [
        "superior land view",
        "land view",
        "garden view",
        "inland view",
        "Superior-Standardzimmer mit Blick ins Grüne"
      ],
      "superior-sea": [
        "superior sea view",
        "sea view",
        "side sea view",
        "meerblick",
        "Superior-Standardzimmer mit Meerblick"
      ],
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
  }
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
        "Superior Side Sea View",
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
      "Side Sea View",
      "Partial Sea View",
      "Standardzimmer mit Meerblick",
      "Standard-Doppelzimmer mit Meerblick",
      "Doppelzimmer mit Meerblick",
      "Zimmer mit seitlichem Meerblick",
      "Standardzimmer mit seitlichem Meerblick"
    ]
    }
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
};
