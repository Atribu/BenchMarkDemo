
import type {
  Check24ParsedOffer,
} from "./check24-parser";

export type Check24BeachRoomId =
  | "economy"
  | "superior-land"
  | "superior-sea"
  | "corner";

export type Check24PortNatureRoomId =
  | "standard-land"
  | "standard-side-sea"
  | "standard-sea"
  | "family"
  | "king-suite";

export type Check24QueenRoomId = "standard-land" | "standard-sea";

function normalizeRoomName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchCheck24BeachRoom(
  offer: Check24ParsedOffer,
): Check24BeachRoomId | null {
  // Yalnızca teklifin kendi oda adını kullanıyoruz.
  // Genel CHECK24 kategori adı tek başına yeterli değil.
  const name = normalizeRoomName(offer.roomName);

  if (!name) return null;

  // Diğer oda tiplerini dışarıda tut.
  if (
    /\b(family|familien|suite|deluxe|apartment|einzelzimmer|single)\b/.test(name)
  ) {
    return null;
  }

  // Yan/ kısmi deniz manzarası tam deniz manzarası değildir.
  if (
    /\b(side sea|side ocean|partial sea|lateral sea|seitlicher meerblick|eingeschranktem meerblick)\b/.test(name)
  ) {
    return null;
  }

    // Balkon bulunmadığı açıkça belirtilen odaları
  // balkonlu oda ile eşleştirmiyoruz.
  if (
    /\b(without balcony|no balcony|ohne balkon)\b/.test(name)
  ) {
    return null;
  }

  if (
    /\b(economy|economical|sparzimmer)\b/.test(name)
  ) {
    return "economy";
  }

  if (
    /\b(corner|eckzimmer|eck dreibettzimmer)\b/.test(name)
  ) {
    return "corner";
  }

  if (
    /\bsuperior\b/.test(name) &&
    /\b(sea view|ocean view|meerblick)\b/.test(name)
  ) {
    return "superior-sea";
  }

  if (
    /\bsuperior\b/.test(name) &&
    /\b(land view|landblick|countryside view|garden view|gartenblick)\b/.test(name)
  ) {
    return "superior-land";
  }

  return null;
}

export function matchCheck24PortNatureRoom(
  offer: Check24ParsedOffer,
): Check24PortNatureRoomId | null {
  const name = normalizeRoomName(
    [offer.roomName, offer.sourceRoomDescription].filter(Boolean).join(" "),
  );

  if (!name) return null;

  if (/\b(king suite|konigssuite)\b/.test(name)) {
    return "king-suite";
  }

  if (/\b(family|familienzimmer|familien|fz)\b/.test(name)) {
    return "family";
  }

  if (
    /\b(side sea|partial sea|seitl|seitlich|seitlicher|teilmeerblick|seitl mb)\b/.test(
      name,
    )
  ) {
    return "standard-side-sea";
  }

  if (/\b(sea view|ocean view|meerblick)\b/.test(name)) {
    return "standard-sea";
  }

  if (
    /\b(land view|landblick|countryside view|garden view|gartenblick)\b/.test(
      name,
    )
  ) {
    return "standard-land";
  }

  return null;
}

export function matchCheck24QueenRoom(
  offer: Check24ParsedOffer,
): Check24QueenRoomId | null {
  const name = normalizeRoomName(
    [offer.roomName, offer.sourceRoomDescription].filter(Boolean).join(" "),
  );

  if (!name) return null;
  if (/\b(family|familien|suite|deluxe|superior|economy|sparzimmer)\b/.test(name))
    return null;
  if (
    /\b(side sea|partial sea|lateral sea|seitl|seitlich|seitlicher|teilmeerblick)\b/.test(
      name,
    )
  )
    return null;
  if (/\b(sea view|ocean view|meerblick)\b/.test(name))
    return "standard-sea";
  if (
    /\b(land view|landblick|countryside view|garden view|gartenblick)\b/.test(
      name,
    )
  )
    return "standard-land";
  return null;
}

export function getCheck24BeachBestOffers(
  offers: Check24ParsedOffer[],
  expectedNights: number,
): Partial<
  Record<Check24BeachRoomId, Check24ParsedOffer>
> {
  const best: Partial<
    Record<Check24BeachRoomId, Check24ParsedOffer>
  > = {};

  for (const offer of offers) {
   if (
  offer.roomOccupancy !== "[A|A]" ||
  offer.currency !== "EUR" ||
  offer.nights !== expectedNights ||
  !Number.isFinite(offer.totalPrice) ||
  offer.totalPrice <= 0 ||
  ![
    "all_inclusive",
    "MEAL_TYPE_ALL_INCLUSIVE",
  ].includes(offer.mealType)
) {
  continue;
}
    const roomId = matchCheck24BeachRoom(offer);

    if (!roomId) continue;

    const previous = best[roomId];

    if (
      !previous ||
      offer.totalPrice < previous.totalPrice
    ) {
      best[roomId] = offer;
    }
  }

  return best;
}
