import type { HotelKey } from "@/src/lib/benchmark/types";

interface OtaHotelConfig {
  pageUrl: string;
  roomAliases: Record<string, string[]>;
  searchQuery?: string;
  cardName?: string;
}

interface TuiHotelConfig {
  giataId: number;
  offerSlug: string;
  offerPageUrl: string;
  roomAliases: Record<string, string[]>;
}

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
      ]
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
        "Great for two"
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
  }
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
        "inland view"
      ],
      "superior-sea": [
        "meerblick",
        "direkter meerblick",
        "teilmeerblick",
        "seitlicher meerblick",
        "sea view",
        "side sea view"
      ]
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
        "garden view"
      ],
      "standard-sea": [
        "meerblick",
        "direkter meerblick",
        "teilmeerblick",
        "seitlicher meerblick",
        "sea view",
        "side sea view"
      ]
    }
  }
};

export const HOTELBEDS_HOTEL_CONFIG: Partial<Record<HotelKey, OtaHotelConfig>> = {
  "miramare-beach": {
    pageUrl: "https://api-mtls.test.hotelbeds.com/hotel-api/1.0/hotels",
    roomAliases: {
      "superior-land": [
        "superior land view",
        "land view",
        "garden view",
        "inland view"
      ],
      "superior-sea": [
        "superior sea view",
        "sea view",
        "side sea view",
        "meerblick"
      ]
    }
  },
  "miramare-queen": {
    pageUrl: "https://api-mtls.test.hotelbeds.com/hotel-api/1.0/hotels",
    roomAliases: {
      "standard-land": [
        "standard room",
        "land view",
        "garden view",
        "inland view",
        "economy"
      ],
      "standard-sea": [
        "standard sea view",
        "sea view",
        "side sea view",
        "meerblick"
      ]
    }
  }
};

export const LOVEHOLIDAYS_HOTEL_CONFIG: Partial<Record<HotelKey, OtaHotelConfig>> = {
  "miramare-queen": {
    pageUrl: "https://www.loveholidays.com/holidays/turkey/antalya/side/miramare-queen.html",
    roomAliases: {
      "standard-land": ["Standard Room with Land View", "Standard Room with Garden View"],
      "standard-sea": ["Standard Room with Sea View", "Standard Room with Partial Sea View"]
    }
  },
  "miramare-beach": {
    pageUrl: "https://www.loveholidays.com/de/urlaub/tuerkei/antalya/side/miramare-beach/",
    roomAliases: {
      "superior-land": ["Superior Doppel- oder Zweibettzimmer mit Landblick", "land view"],
      "superior-sea": ["Superior Doppel- oder Zweibettzimmer mit Meerblick", "sea view"]
    }
  }
};

export const ONTHEBEACH_HOTEL_CONFIG: Partial<Record<HotelKey, OtaHotelConfig>> = {
  "miramare-queen": {
    pageUrl: "https://www.onthebeach.co.uk/hotels/turkey/antalya/side/miramare-queen",
    roomAliases: {
      "standard-land": ["standard land view", "standard garden view"],
      "standard-sea": ["standard sea view", "standard side sea view"]
    }
  },
  "miramare-beach": {
    pageUrl: "https://www.onthebeach.co.uk/hotels/turkey/antalya/side/miramare-beach",
    roomAliases: {
      "superior-land": ["land view", "inland view", "garden view"],
      "superior-sea": ["sea view", "side sea view"]
    }
  }
};

export const TUI_HOTEL_CONFIG: Partial<Record<HotelKey, TuiHotelConfig>> = {
  "miramare-beach": {
    giataId: 4893,
    offerSlug: "Hotel-Miramare-Beach",
    offerPageUrl: "https://www.tui.com/hotels/hotel-miramare-beach-4893/hotelinformation/",
    roomAliases: {
      "superior-land": ["Superior Land View", "Superior Corner"],
      "superior-sea": [
        "Superior Sea View",
        "Superior Side Sea View",
        "Superior Room Sea View"
      ]
    }
  },
  "miramare-queen": {
    giataId: 4894,
    offerSlug: "Hotel-Miramare-Queen",
    offerPageUrl: "https://www.tui.com/hotels/hotel-miramare-queen-4894/hotelinformation/",
    roomAliases: {
      "standard-land": [
        "Standard Room",
        "Double Room",
        "Land View",
        "Garden View"
      ],
      "standard-sea": ["Sea View", "Standard Room Sea View", "Side Sea View"]
    }
  }
};
