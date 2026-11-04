export function hasCompatibleView(
  roomId: string,
  description: string,
): boolean {
  const text = description
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const sea = /\b(sea|ocean|meerblick|teilmeerblick|seaview|meerseite)\b/.test(
    text,
  );
  const land =
    /\b(land|landseite|landblick|garden|gartenblick|gartenseite|inland)\b/.test(
      text,
    );
  const partialSea =
    /\b(side|partial|lateral|seitl|seitlich|seitlichem|seitlicher|teilmeerblick)\b/.test(
      text,
    );
  if (roomId.endsWith("side-sea") || roomId.endsWith("partial-sea"))
    return sea && partialSea && !land;
  if (roomId.endsWith("-sea")) return sea && !partialSea && !land;
  if (roomId.endsWith("-land")) return land && !sea;
  return true;
}
