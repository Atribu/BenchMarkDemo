
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
      view: "unknown",
      confirmed: false,
    },

    DGYB: {
      name: "DZ Deluxe priv. Garten",
      category: "variant",
      view: "garden",
      confirmed: false,
    },
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
    MAPPINGS[scope.hotelKey]?.[code];

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
