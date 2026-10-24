
export interface Check24ParsedOffer {
  offerId: string;
  roomName: string;
  roomCategoryName: string;
  roomOccupancy: string;
  mealType: string;
  supplierName: string;
  totalPrice: number;
  currency: "EUR";
  nights: number;
  taxesIncluded: boolean;
  source: "recommendation" | "rate" | "group";
supplierId?: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function child(
  record: UnknownRecord | null,
  key: string,
): UnknownRecord | null {
  return asRecord(record?.[key]);
}

export function parseCheck24OldRecommendations(
  response: unknown,
  expectedNights: number,
): Check24ParsedOffer[] {
  const root = asRecord(response);
  const status = child(root, "status");

  if (
    status?.state !== "finished" ||
    status.isExpired !== false ||
    status.searchRoomConfiguration !== "[A|A]"
  ) {
    return [];
  }

  const roomRates = root?.roomRates;

  if (!Array.isArray(roomRates)) {
    return [];
  }

  const parsed: Check24ParsedOffer[] = [];

  for (const rawRoom of roomRates) {
    const room = asRecord(rawRoom);
    const offer = child(room, "recommendation");

    if (!offer) continue;

    const price = child(offer, "priceStructure");
    const totalPrice = child(
      child(price, "effectiveTotal"),
      "euro",
    );

    const supplier = child(offer, "supplier");

    const roomInformation = child(
      room,
      "roomInformation",
    );

    const offerId = offer.offerUuid;
    const amount = totalPrice?.amount;
    const currency = totalPrice?.currency;
    const nights = price?.numberOfNights;

    if (
      typeof offerId !== "string" ||
      offer.roomOccupancy !== "[A|A]" ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      currency !== "EUR" ||
      nights !== expectedNights
    ) {
      continue;
    }

const offerRoomInformation = child(
  offer,
  "roomInformation",
);

const roomNameCandidates = [
  offer.providerRoomDescription,
  offerRoomInformation?.providerRoomName,
  roomInformation?.providerRoomName,
  room?.roomCategoryTitle,
];

const roomName =
  roomNameCandidates.find(
    (value): value is string =>
      typeof value === "string" &&
      value.trim().length > 0,
  ) ?? "";

    if (!roomName) continue;

    parsed.push({
      offerId,
      roomName,
      roomCategoryName:
        typeof room?.roomCategoryTitle === "string"
          ? room.roomCategoryTitle
          : roomName,
      roomOccupancy: "[A|A]",
      mealType:
        typeof offer.mealType === "string"
          ? offer.mealType
          : "unknown",
      supplierName:
        typeof supplier?.displayLabel === "string"
          ? supplier.displayLabel
          : "unknown",
      totalPrice: amount,
      currency: "EUR",
      nights,
      taxesIncluded:
        price?.inclusiveTaxesAndFees === true,
      source: "recommendation",
    });
  }

  return parsed;
}


export function parseCheck24OldAllOffers(
  response: unknown,
  expectedNights: number,
): Check24ParsedOffer[] {
  const root = asRecord(response);
  const status = child(root, "status");

  if (
    status?.state !== "finished" ||
    status.isExpired !== false ||
    status.searchRoomConfiguration !== "[A|A]"
  ) {
    return [];
  }

  const roomRates = root?.roomRates;

  if (!Array.isArray(roomRates)) {
    return [];
  }

  const offers: Check24ParsedOffer[] = [];
  const seenIds = new Set<string>();

  for (const rawRoom of roomRates) {
    const room = asRecord(rawRoom);
    if (!room) continue;

    const candidates: Array<{
      data: UnknownRecord;
      source: "recommendation" | "rate";
    }> = [];

    const recommendation = child(
      room,
      "recommendation",
    );

    if (recommendation) {
      candidates.push({
        data: recommendation,
        source: "recommendation",
      });
    }

    const rates = room.rates;

    if (Array.isArray(rates)) {
      for (const rawRate of rates) {
        const rateWrapper = asRecord(rawRate);
        const rate = child(rateWrapper, "rate");

        if (rate) {
          candidates.push({
            data: rate,
            source: "rate",
          });
        }
      }
    }

    for (const candidate of candidates) {
      const offer = candidate.data;
      const offerId = offer.offerUuid;

      const priceStructure = child(
        offer,
        "priceStructure",
      );

      const totalPrice = child(
        child(priceStructure, "effectiveTotal"),
        "euro",
      );

      const supplier = child(offer, "supplier");

      const roomInformation = child(
        offer,
        "roomInformation",
      );

      const groupRoomInformation = child(
        room,
        "roomInformation",
      );

      const amount = totalPrice?.amount;

      if (
        typeof offerId !== "string" ||
        offer.roomOccupancy !== "[A|A]" ||
        priceStructure?.numberOfNights !== expectedNights ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        totalPrice?.currency !== "EUR" ||
        seenIds.has(offerId)
      ) {
        continue;
      }

      const roomNameCandidates = [
        offer.providerRoomDescription,
        roomInformation?.providerRoomName,
        groupRoomInformation?.providerRoomName,
        room.roomCategoryTitle,
      ];

      const roomName = roomNameCandidates.find(
        (value): value is string =>
          typeof value === "string" &&
          value.trim().length > 0,
      );

      if (!roomName) continue;

      seenIds.add(offerId);

      offers.push({
        offerId,
        roomName,
        roomCategoryName:
          typeof room.roomCategoryTitle === "string"
            ? room.roomCategoryTitle
            : roomName,
        roomOccupancy: "[A|A]",
        mealType:
          typeof offer.mealType === "string"
            ? offer.mealType
            : "unknown",
        supplierName:
          typeof supplier?.displayLabel === "string"
            ? supplier.displayLabel
            : "unknown",
        supplierId:
          typeof supplier?.id === "string"
            ? supplier.id
            : undefined,
        totalPrice: amount,
        currency: "EUR",
        nights: expectedNights,
        taxesIncluded:
          priceStructure?.inclusiveTaxesAndFees === true,
        source: candidate.source,
      });
    }
  }

  return offers;
}


export function parseCheck24NewRecommendations(
  response: unknown,
): Check24ParsedOffer[] {
  const root = asRecord(response);
  const offersData = child(root, "offers");

  if (!offersData) return [];

  const groups = [
    child(offersData, "recommendation"),
    child(offersData, "freeCancelableRecommendation"),
  ];

  const parsed: Check24ParsedOffer[] = [];
  const seenIds = new Set<string>();

  for (const group of groups) {
    const rawOffers = group?.offers;

    if (!Array.isArray(rawOffers)) continue;

    for (const rawOffer of rawOffers) {
      const offer = asRecord(rawOffer);
      if (!offer) continue;

      const offerId = offer.offerId;

      if (
        typeof offerId !== "string" ||
        seenIds.has(offerId)
      ) {
        continue;
      }

      const roomConfig = child(offer, "roomConfig");

      if (
        roomConfig?.value !== "[A|A]" ||
        offer.quantity !== 1
      ) {
        continue;
      }

      const priceComposition = child(
        offer,
        "priceComposition",
      );

      const totalPrice = child(
        child(priceComposition, "totalPrice"),
        "tenant",
      );

      const amountRaw = totalPrice?.amount;
      const amount =
        typeof amountRaw === "string" &&
        amountRaw.trim().length > 0
          ? Number(amountRaw)
          : NaN;

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        totalPrice?.currency !== "EUR"
      ) {
        continue;
      }

      const roomName =
        typeof offer.roomName === "string"
          ? offer.roomName.trim()
          : "";

      if (!roomName) continue;

      seenIds.add(offerId);

      parsed.push({
        offerId,
        roomName,
        roomCategoryName:
          typeof offer.roomCategoryName === "string"
            ? offer.roomCategoryName
            : roomName,
        roomOccupancy: "[A|A]",
        mealType:
          typeof offer.mealType === "string"
            ? offer.mealType
            : "unknown",
        supplierName:
          typeof offer.supplier === "string"
            ? offer.supplier
            : "unknown",
        supplierId:
          typeof offer.supplierKey === "string"
            ? offer.supplierKey
            : undefined,
        totalPrice: amount,
        currency: "EUR",
        // Yeni yanıtın bu bölümünde gece sayısı yok.
        // Tarihler collector tarafından doğrulanmalı.
        nights: 0,
        taxesIncluded: false,
        source: "recommendation",
      });
    }
  }

  return parsed;
}



export function parseCheck24NewAllOffers(
  response: unknown,
): Check24ParsedOffer[] {
  const root = asRecord(response);
  const offersData = child(root, "offers");

  // İlk ara yanıtı değil, tamamlanmış aramayı işle.
  // Gözlemlediğimiz akışta status 1 -> 2 oldu.
  if (offersData?.status !== 2) {
    return [];
  }

  const categories = offersData.roomCategoriesFitting;

  if (!Array.isArray(categories)) {
    return [];
  }

  const parsed: Check24ParsedOffer[] = [];
  const seenIds = new Set<string>();

  for (const rawCategory of categories) {
    const category = asRecord(rawCategory);
    if (!category) continue;

    const groups = category.characteristicsGroupsFitting;
    if (!Array.isArray(groups)) continue;

    for (const rawGroup of groups) {
      const group = asRecord(rawGroup);
      if (!group || !Array.isArray(group.offers)) {
        continue;
      }

      for (const rawOffer of group.offers) {
        const offer = asRecord(rawOffer);
        if (!offer) continue;

        const offerId = offer.offerId;
        const roomConfig = child(offer, "roomConfig");

        // Sadece 1 odalık, 2 yetişkinli teklifler.
        const quantity =
          offer.quantity === undefined
            ? 1
            : offer.quantity;

        if (
          typeof offerId !== "string" ||
          seenIds.has(offerId) ||
          roomConfig?.value !== "[A|A]" ||
          quantity !== 1
        ) {
          continue;
        }

        const priceComposition = child(
          offer,
          "priceComposition",
        );

        const totalPrice = child(
          child(priceComposition, "totalPrice"),
          "tenant",
        );

        const rawAmount = totalPrice?.amount;

        const amount =
          typeof rawAmount === "string" &&
          rawAmount.trim() !== ""
            ? Number(rawAmount)
            : NaN;

        if (
          !Number.isFinite(amount) ||
          amount <= 0 ||
          totalPrice?.currency !== "EUR"
        ) {
          continue;
        }

        const roomName = offer.roomName;

        // Genel kategori adını teklifin oda adı
        // yerine kullanmıyoruz.
        if (
          typeof roomName !== "string" ||
          !roomName.trim()
        ) {
          continue;
        }

        const supplier = offer.supplier;
        const supplierKey = offer.supplierKey;
        const mealType = offer.mealType;

        // Pansiyon bilinmiyorsa fiyatı kabul etme.
        if (typeof mealType !== "string") {
          continue;
        }

        seenIds.add(offerId);

        parsed.push({
          offerId,
          roomName: roomName.trim(),
          roomCategoryName:
            typeof category.roomCategoryName === "string"
              ? category.roomCategoryName
              : roomName.trim(),
          roomOccupancy: "[A|A]",
          mealType,
          supplierName:
            typeof supplier === "string"
              ? supplier
              : "unknown",
          supplierId:
            typeof supplierKey === "string"
              ? supplierKey
              : undefined,
          totalPrice: amount,
          currency: "EUR",

          // API teklifinde gece sayısı yok.
          // Collector tarihleri doğrulayana kadar 0.
          nights: 0,

          // Bu bayrak henüz tüm yerel vergilerin
          // dahil olduğunu doğrulamıyor.
          taxesIncluded: false,
          source: "group",
        });
      }
    }
  }

  return parsed;
}
