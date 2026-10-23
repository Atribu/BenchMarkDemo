
import type {
  HotelKey,
  ReportScopeDefinition,
  RoomDefinition,
  RoomFeatures,
} from "@/src/lib/benchmark/types";

export interface SchauinslandRoomMatch {
  room: RoomDefinition | undefined;
  features: RoomFeatures;
  reason: string;
  confirmed: boolean;
}

interface RoomMapping {
  roomId: string | null;
  view: RoomFeatures["view"];
  category: RoomFeatures["category"];
  balcony?: RoomFeatures["balcony"];
  confirmed: boolean;
  descriptionPattern?: RegExp;

  evidence?: string;
  reviewNote?: string;
}


const ROOM_MAPPINGS: Partial<
  Record<HotelKey, Record<string, RoomMapping>>
> = {
  "miramare-beach": {
    // Economy Room - Henüz kesin eşleşme değil
   
SOZ3: {
  roomId: "economy",
  view: "land",
  category: "unknown",
  confirmed: true,
  descriptionPattern: /^sparzimmer ohne balkon$/i,
  balcony: "no",
},
SOZA: {
  roomId: "economy",
  view: "land",
  category: "unknown",
  confirmed: true,
  descriptionPattern: /^sparzimmer ohne balkon$/i,
  balcony: "no",
},


    // Corner Room - Doğrulanmış eşleşme
    D2X3: {
      roomId: "corner",
      view: "land",
      category: "superior",
      confirmed: true,
      descriptionPattern: /^grosses doppelzimmer$/i,
    },
    D2XA: {
      roomId: "corner",
      view: "land",
      category: "superior",
      confirmed: true,
      descriptionPattern: /^grosses doppelzimmer$/i,
    },

    // Superior Land - Henüz kesin eşleşme değil
   DSU3: {
  roomId: "superior-land",
  view: "land",
  category: "superior",
  confirmed: true,
  descriptionPattern: /^doppelzimmer superior$/i,
  evidence: "DSU3: Doppelzimmer Superior",
  reviewNote:
    "Kara manzarası API'de belirtilmiyor. Kategori eşdeğerliği doğrulanmalı.",
},
    DSUA: {
      roomId: "superior-land",
      view: "land",
      category: "superior",
      confirmed: true,
      descriptionPattern: /^doppelzimmer superior$/i,
      evidence: "DSUA: Doppelzimmer Superior",
reviewNote:
  "Kara manzarası API'de belirtilmiyor. Kategori eşdeğerliği doğrulanmalı.",
    },

    // Superior Sea - Doğrulanmış eşleşme
    DMU3: {
      roomId: "superior-sea",
      view: "sea",
      category: "superior",
      confirmed: true,
      descriptionPattern: /^(?:dz|doppelzimmer) superior meerblick$/i,
    },
    DMUA: {
      roomId: "superior-sea",
      view: "sea",
      category: "superior",
      confirmed: true,
      descriptionPattern: /^(?:dz|doppelzimmer) superior meerblick$/i,
    },
  },

  "miramare-queen": {
    // Standard Land - Henüz kesin eşleşme değil
   "D  3": {
  roomId: "standard-land",
  view: "land",
  category: "unknown",
  confirmed: true,
  descriptionPattern: /^doppelzimmer$/i,
  evidence: "D  3: Doppelzimmer",
  reviewNote:
    "API views=null dönüyor. Standard Land eşleşmesi ayrıca doğrulanmalı.",
},
    "D  A": {
      roomId: "standard-land",
      view: "land",
      category: "unknown",
      confirmed: true,
      descriptionPattern: /^doppelzimmer$/i,
      evidence: "D  A: Doppelzimmer",
reviewNote:
  "API views=null dönüyor. Standard Land eşleşmesi ayrıca doğrulanmalı.",
    },

    // Standard Sea - Doğrulanmış eşleşme
    "DM 3": {
      roomId: "standard-sea",
      view: "sea",
      category: "unknown",
      confirmed: true,
      descriptionPattern: /^doppelzimmer meerblick$/i,
    },
    "DM A": {
      roomId: "standard-sea",
      view: "sea",
      category: "unknown",
      confirmed: true,
      descriptionPattern: /^doppelzimmer meerblick$/i,
    },
  },
};


function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase();
}


export function matchSchauinslandRoom(
  scope: ReportScopeDefinition,
  roomCode: string,
  roomName: string,
): SchauinslandRoomMatch {
  const code = normalizeRoomCode(roomCode);
  const mapping = ROOM_MAPPINGS[scope.hotelKey]?.[code];

  const normalizedName = roomName
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");

  const descriptionMatches =
    mapping?.descriptionPattern?.test(normalizedName) ?? false;

  const room = mapping?.roomId
    ? scope.rooms.find(
        (candidate) => candidate.id === mapping.roomId,
      )
    : undefined;

  const confirmed =
    Boolean(mapping?.confirmed) &&
    Boolean(room) &&
    descriptionMatches;

  const features: RoomFeatures = {
    category: mapping?.category ?? "unknown",
    view: mapping?.view ?? "unknown",
    balcony: mapping?.balcony ?? "unknown",
  };

  if (!mapping) {
    return {
      room: undefined,
      features,
      confirmed: false,
      reason:
        `Schauinsland oda kodu (${roomCode}) ve ` +
        `açıklaması (${roomName}) için güvenilir ` +
        "benchmark oda eşleşmesi bulunamadı.",
    };
  }

  let reason: string;

  if (!descriptionMatches) {
    reason =
      `Schauinsland oda kodu (${roomCode}) biliniyor ancak ` +
      `oda açıklaması (${roomName}) beklenen açıklamayla eşleşmiyor.`;
  } else if (!room) {
    reason =
      `Schauinsland oda kodu (${roomCode}) için ` +
      "benchmark oda kategorisi bulunamadı.";
  } else if (confirmed) {
    reason =
      `Schauinsland oda kodu (${roomCode}) ve ` +
      `açıklaması (${roomName}) doğrulandı. ` +
      "Pansiyon, iptal ve vergi koşulları ayrıca kontrol edilmeli.";
} else {
  reason =
    `Schauinsland oda kodu (${roomCode}) ve ` +
    `açıklaması (${roomName}) olası kategoriyle eşleşiyor. ` +
    (mapping.evidence
      ? `Eşleştirme kanıtı: ${mapping.evidence}. `
      : "") +
    (mapping.reviewNote ??
      "Oda özellikleri henüz doğrulanmadı.");
}

  return {
    room,
    features,
    confirmed,
    reason,
  };
}

