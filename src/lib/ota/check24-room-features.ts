
import type {
  RoomFeatures,
} from "@/src/lib/benchmark/types";

function normalizeRoomText(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCheck24RoomFeatures(
  roomName: string,
  categoryName: string,
): RoomFeatures {
  const room = normalizeRoomText(roomName);
  const category = normalizeRoomText(categoryName);

  const text = `${room} ${category}`;

  let roomCategory: RoomFeatures["category"] = "unknown";
  let view: RoomFeatures["view"] = "unknown";
  let balcony: RoomFeatures["balcony"] = "unknown";

if (/corner|eckzimmer|eck-/.test(text)) {
  roomCategory = "variant";
} else if (/economy|sparzimmer|standard/.test(text)) {
  roomCategory = "standard";
} else if (/superior/.test(text)) {
  roomCategory = "superior";
}

  // Kısmi deniz manzarası tam deniz manzarasından önce.
  if (
    /side sea|partial sea|seitlich|eingeschränkt/.test(text)
  ) {
    view = "partial-sea";
  } else if (
    /sea view|meerblick/.test(text)
  ) {
    view = "sea";
  } else if (
    /land view|landblick|landschaftsblick/.test(text)
  ) {
    view = "land";
  } else if (
    /garden view|gartenblick/.test(text)
  ) {
    view = "garden";
  }

  // İfadeler çelişiyorsa özelliği kesinleştirmiyoruz.
  if (
    /ohne balkon|without balcony|no balcony/.test(text)
  ) {
    balcony = "no";
  } else if (
    /mit balkon|with balcony/.test(text)
  ) {
    balcony = "yes";
  }

  return {
    category: roomCategory,
    view,
    balcony,
  };
}
