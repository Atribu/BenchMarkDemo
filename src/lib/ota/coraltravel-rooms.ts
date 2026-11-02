
import type {
  HotelKey,
  ReportScopeDefinition,
  RoomFeatures,
} from "@/src/lib/benchmark/types";

interface MatchResult {
  matchedRoomId?: string;
  features: RoomFeatures;
  reason: string;
}

type Mapping = {
  name: string;
  roomId?: string;
  category: RoomFeatures["category"];
  view: RoomFeatures["view"];
  confirmed: boolean;
};

const MAPPINGS: Partial<
  Record<HotelKey, Record<string, Mapping>>
> = {
  "miramare-beach": {
    DZEB: {
      name: "Doppelzimmer Economy",
      roomId: "economy",
      category: "variant",
      view: "unknown",
      confirmed: true,
    },

    "2NYB": {
      name: "DZ Superior Landbl.",
      roomId: "superior-land",
      category: "superior",
      view: "land",
      confirmed: true,
    },

    DUSB: {
      name: "DZ Superior seitl.Meerbl.",
      category: "superior",
      view: "partial-sea",
      confirmed: false,
    },

    OMUB: {
      name: "DZ Superior Meerbl.",
      roomId: "superior-sea",
      category: "superior",
      view: "sea",
      confirmed: true,
    },

    OSCB: {
      name: "DZ Superior Corner",
      roomId: "corner",
      category: "variant",
      view: "land",
      confirmed: true,
    },

    DGYB: {
      name: "DZ Deluxe priv. Garten",
      category: "variant",
      view: "garden",
      confirmed: false,
    },
  },
};

const PORT_NATURE_ROOM_NAMES: Record<string, Mapping> = {
  "standard room land view": {
    name: "Standard Room Land View",
    roomId: "standard-land",
    category: "standard",
    view: "land",
    confirmed: true,
  },
  "standard room side sea view": {
    name: "Standard Room Side Sea View",
    roomId: "standard-side-sea",
    category: "standard",
    view: "partial-sea",
    confirmed: true,
  },
  "standard room sea view": {
    name: "Standard Room Sea View",
    roomId: "standard-sea",
    category: "standard",
    view: "sea",
    confirmed: true,
  },
  "family room sea side view 2 bedrooms chd free": {
    name: "Family Room Sea Side View 2 Bedrooms Chd Free",
    roomId: "family",
    category: "variant",
    view: "partial-sea",
    confirmed: true,
  },
  "king suite": {
    name: "King Suite",
    roomId: "king-suite",
    category: "variant",
    view: "sea",
    confirmed: true,
  },
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchCoralTravelRoom(
  scope: ReportScopeDefinition,
  roomCode: string,
  roomName: string,
): MatchResult {
  const code = roomCode.trim().toUpperCase();

  const mapping =
    MAPPINGS[scope.hotelKey]?.[code] ??
    (scope.hotelKey === "port-nature"
      ? PORT_NATURE_ROOM_NAMES[normalize(roomName)]
      : undefined);

  const features: RoomFeatures = {
    category: mapping?.category ?? "unknown",
    view: mapping?.view ?? "unknown",

    // API örneğinde balkon bilgisi doğrulanmadı.
    balcony: "unknown",
  };

  if (!mapping) {
    return {
      features,
      reason:
        `Coral Travel oda kodu (${roomCode}) ` +
        "henüz eşleştirilmedi.",
    };
  }

  const descriptionMatches =
    normalize(mapping.name) === normalize(roomName);

  if (!descriptionMatches) {
    return {
      features,
      reason:
        `Oda kodu (${roomCode}) biliniyor, ancak ` +
        `açıklama değişmiş: ${roomName}.`,
    };
  }

  if (!mapping.confirmed) {
    return {
      features,
      reason:
        `${roomCode} (${roomName}) bulundu; ` +
        "benchmark oda eşdeğerliği henüz doğrulanmadı.",
    };
  }

  if (
    !mapping.roomId ||
    !scope.rooms.some(
      (room) => room.id === mapping.roomId,
    )
  ) {
    return {
      features,
      reason:
        "Kod doğrulandı ancak benchmark " +
        "kapsamındaki oda bulunamadı.",
    };
  }

  return {
    matchedRoomId: mapping.roomId,
    features,
    reason:
      `${roomCode} ve ${roomName} oda kodu/adı doğrulandı; ` +
      "iptal ve vergi koşulları ayrıca kontrol edilmeli.",
  };
}
