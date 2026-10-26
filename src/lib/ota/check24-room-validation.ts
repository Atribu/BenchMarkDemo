
import type {
  RoomFeatures,
} from "@/src/lib/benchmark/types";

import type {
  Check24ParsedOffer,
} from "./check24-parser";

import {
  matchCheck24BeachRoom,
} from "./check24-room-mapping";

import {
  extractCheck24RoomFeatures,
} from "./check24-room-features";

import {
  CHECK24_BEACH_OFFICIAL_ROOMS,
  type Check24BeachRoomId,
} from "./check24-official-rooms";

export type Check24RoomValidationStatus =
  | "matched"
  | "manual-review"
  | "rejected";

export interface Check24RoomValidationResult {
  status: Check24RoomValidationStatus;
  roomId: string | null;
  features: RoomFeatures;
  reasons: string[];
}


function validateOfficialRoomFeatures(
  roomId: string,
  features: RoomFeatures,
): {
  rejected: boolean;
  reasons: string[];
} {
  const reference =
    CHECK24_BEACH_OFFICIAL_ROOMS[
      roomId as Check24BeachRoomId
    ];

  if (!reference) {
    return {
      rejected: true,
      reasons: ["Resmî oda referansı bulunamadı."],
    };
  }

  const reasons: string[] = [];

  const keys: Array<keyof RoomFeatures> = [
    "category",
    "view",
    "balcony",
  ];

  for (const key of keys) {
    const expected = reference.features[key];
    if (!expected) continue;

    const actual = features[key];

    if (actual === "unknown") {
      reasons.push(
        `${key}: CHECK24 kaynağında belirtilmemiş.`,
      );
      continue;
    }

    if (actual !== expected) {
      return {
        rejected: true,
        reasons: [
          `${key} uyuşmazlığı: ` +
          `resmî=${expected}, CHECK24=${actual}`,
        ],
      };
    }
  }

  if (reference.reviewRequired) {
    reasons.push(
      "Resmî oda eşdeğerliği manuel inceleme gerektiriyor.",
    );
  }

  return {
    rejected: false,
    reasons,
  };
}


export function validateCheck24BeachOffer(
  offer: Check24ParsedOffer,
  expectedNights: number,
): Check24RoomValidationResult {
  const features = extractCheck24RoomFeatures(
    offer.roomName,
    offer.sourceRoomDescription ?? offer.roomName,
  );

  const reasons: string[] = [];
  const roomId = matchCheck24BeachRoom(offer);

  const reject = (
    reason: string,
  ): Check24RoomValidationResult => ({
    status: "rejected",
    roomId,
    features,
    reasons: [...reasons, reason],
  });

  const offerRoomText = [offer.roomName, offer.sourceRoomDescription]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase("de-DE");

  const hasPartialSeaView =
    /side[\s-]*sea|partial[\s-]*sea|seitlich(?:er|es|e|en)?\s*meerblick|teilblick/.test(
      offerRoomText,
    );

  if (roomId === "superior-sea" && hasPartialSeaView) {
    return reject(
      "Kısmi/yan deniz manzaralı teklif, tam deniz " +
        "manzaralı Superior oda ile eşleştirilemez.",
    );
  }

  // 1. Rezervasyon koşulları
  if (offer.roomOccupancy !== "[A|A]") {
    return reject("Beklenen kişi sayısı 2 yetişkin değil.");
  }

  if (offer.currency !== "EUR") {
    return reject("Para birimi EUR değil.");
  }

  if (
    !Number.isFinite(offer.totalPrice) ||
    offer.totalPrice <= 0
  ) {
    return reject("Geçerli bir toplam fiyat bulunamadı.");
  }

  if (offer.nights !== expectedNights) {
    return reject("Konaklama süresi uyuşmuyor.");
  }

  if (
    ![
      "all_inclusive",
      "MEAL_TYPE_ALL_INCLUSIVE",
    ].includes(offer.mealType)
  ) {
    return reject("Pansiyon All Inclusive değil.");
  }

  // 2. Oda sınıflandırması
  if (!roomId) {
    return reject("Oda adı benchmark kategorileriyle eşleşmedi.");
  }

  const officialValidation = validateOfficialRoomFeatures(roomId, features);

  if (officialValidation.rejected) {
    return {
      status: "rejected",
      roomId,
      features,
      reasons: [...reasons, ...officialValidation.reasons],
    };
  }

  reasons.push(...officialValidation.reasons);
  
  // 4. Oda bazlı ilave kontroller
  if (roomId === "economy") {
    reasons.push(
      "Economy/Sparzimmer oda eşdeğerliği resmî olarak doğrulanmadı.",
    );

    return {
      status: "manual-review",
      roomId,
      features,
      reasons,
    };
  }

  if (
    roomId === "superior-land" ||
    roomId === "superior-sea"
  ) {
    if (features.view === "unknown") {
      reasons.push("Manzara bilgisi doğrulanamadı.");

      return {
        status: "manual-review",
        roomId,
        features,
        reasons,
      };
    }
  }

  if (roomId === "corner") {
    reasons.push(
      "Corner oda kategorisinin resmî eşdeğerliği doğrulanmalı.",
    );

    return {
      status: "manual-review",
      roomId,
      features,
      reasons,
    };
  }

  const missingFeatures = reasons.some((reason) =>
    reason.includes("CHECK24 kaynağında belirtilmemiş"),
  );

  return {
    status: "matched",
    roomId,
    features,
    reasons: [
      ...reasons,
      missingFeatures
        ? "Oda adı ve manzara eşleşti; kaynakta yer almayan ek özellikler ayrıca gösterilir."
        : "Oda özellikleri teknik olarak uyumlu.",
      "Tarife koşulları oda eşleşmesinden bağımsız olarak gösterilir.",
    ],
  };
}
