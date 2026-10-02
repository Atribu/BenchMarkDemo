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
  if (roomId.endsWith("-sea")) return sea && !land;
  if (roomId.endsWith("-land")) return land && !sea;
  return true;
}
