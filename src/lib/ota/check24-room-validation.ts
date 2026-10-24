
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

export type Check24RoomValidationStatus =
  | "candidate"
  | "manual-review"
  | "rejected";

export interface Check24RoomValidationResult {
  status: Check24RoomValidationStatus;
  roomId: string | null;
  features: RoomFeatures;
  reasons: string[];
}

const EXPECTED_FEATURES: Record<
  string,
  Partial<RoomFeatures>
> = {
  economy: {
    category: "standard",
  },
  "superior-land": {
    category: "superior",
    view: "land",
  },
  "superior-sea": {
    category: "superior",
    view: "sea",
  },
  corner: {
    category: "variant",
  },
};

export function validateCheck24BeachOffer(
  offer: Check24ParsedOffer,
  expectedNights: number,
): Check24RoomValidationResult {
  const features = extractCheck24RoomFeatures(
    offer.roomName,
    offer.roomCategoryName,
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

  const expected = EXPECTED_FEATURES[roomId];

  if (!expected) {
    return reject("Bu oda için doğrulama kuralı bulunmuyor.");
  }

  // 3. Kaynak özellikleriyle çelişki kontrolü
  const featureKeys: Array<keyof RoomFeatures> = [
    "category",
    "view",
    "balcony",
  ];

  for (const key of featureKeys) {
    const expectedValue = expected[key];

    if (!expectedValue) continue;

    const actual = features[key];

    if (
      actual !== "unknown" &&
      actual !== expectedValue
    ) {
      return reject(
        `${key} uyuşmuyor: beklenen=${expectedValue}, gelen=${actual}`,
      );
    }

    if (actual === "unknown") {
      reasons.push(`${key} bilgisi kaynakta belirsiz.`);
    }
  }

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

  // 5. Teknik kontroller tamamlandı.
  // Henüz resmî oda eşdeğerliği onaylanmadı.
  return {
    status: "candidate",
    roomId,
    features,
    reasons: [
      ...reasons,
      "Teknik kontroller başarılı; resmî oda eşdeğerliği bekleniyor.",
    ],
  };
}
