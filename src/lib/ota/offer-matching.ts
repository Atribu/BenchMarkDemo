import type {
  BenchmarkWindowDefinition,
  CollectedOffer,
  OfferTerms,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
  RoomFeatures,
} from "../benchmark/types";

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function classifyRoom(name: string, details = ""): RoomFeatures {
  const text = normalize(`${name} ${details}`);
  const variant =
    /\b(economy|eco|sparzimmer|spar|best price|promotion|promo|family|familienzimmer|familien|suite|junior|corner|eckzimmer|swim up|deluxe|comfort|komfort)\b/.test(
      text,
    );
  const sea = /\b((sea|ocean) view|meerblick|teilmeerblick)\b/.test(text);
  const partial =
    sea &&
    /\b(side|partial|lateral|seitl|seitlich\w*|eingeschrankt\w*|teilmeerblick)\b/.test(
      text,
    );
  const garden =
    /\b(garden view|gartenblick|gartenseite|blick ins grune)\b/.test(text);
  const land = /\b(land|landseite|landblick|inland)\b/.test(text);
  const negatedView =
    /\b(no|without|ohne) ((sea|ocean|garden|land) view|meerblick|gartenblick)\b/.test(
      text,
    );
  const noBalcony = /\b(without|no|ohne) (a |einen )?(balcony|balkon)\b/.test(
    text,
  );
  return {
    category: variant
      ? "variant"
      : /\bsuperior\b/.test(text)
        ? "superior"
        : /\b(standard|standardzimmer|double|doppelzimmer|dz)\b/.test(text)
          ? "standard"
          : "unknown",
    view:
      negatedView || (sea && (garden || land))
        ? "unknown"
        : partial
          ? "partial-sea"
          : sea
            ? "sea"
            : garden
              ? "garden"
              : land
                ? "land"
                : "unknown",
    balcony: noBalcony
      ? "no"
      : /\b(balcony|balkon)\b/.test(text)
        ? "yes"
        : "unknown",
  };
}

export function matchOfferRoom(
  scope: ReportScopeDefinition,
  features: RoomFeatures,
) {
  if (features.category === "variant")
    return { matchReason: "Ekonomi, aile veya farklı oda kategorisi." };
  if (features.view === "partial-sea")
    return {
      matchReason:
        "Yan/kısmi deniz manzarası; tam deniz manzarası ile eşdeğer değil.",
    };
  if (features.view === "unknown")
    return { matchReason: "Odanın manzarası doğrulanamadı." };
  if (features.balcony === "no")
    return {
      matchReason: "Balkonsuz oda; normal oda satırına dahil edilmedi.",
    };
  const expectedCategory =
    scope.hotelKey === "miramare-beach" ? "superior" : "standard";
  if (features.category !== expectedCategory)
    return { matchReason: "İstenen oda kategorisi doğrulanamadı." };
  if (scope.hotelKey === "miramare-beach" && features.balcony !== "yes")
    return { matchReason: "Superior odanın balkon bilgisi doğrulanamadı." };
  const roomId = `${expectedCategory}-${features.view === "sea" ? "sea" : "land"}`;
  return scope.rooms.some((room) => room.id === roomId)
    ? {
        matchedRoomId: roomId,
        matchReason:
          "Oda kategorisi eşleşti; pansiyon ve iptal koşulları ayrıca karşılaştırılmalı.",
      }
    : { matchReason: "Bu oda raporun oda kategorilerinde yok." };
}

export function offerConditions(terms: OfferTerms): string {
  return [
    `Pansiyon: ${terms.board}`,
    `İptal: ${terms.cancellation}`,
    `Vergiler: ${terms.taxes}`,
    terms.operator ? `Operatör: ${terms.operator}` : "",
    terms.cashback
      ? `Cashback: ${terms.cashback.amount} ${terms.cashback.currency} (toplamdan düşülmedi). ${terms.cashback.conditions}`
      : "",
    terms.availability,
  ]
    .filter(Boolean)
    .join("; ");
}

export function selectOfferQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
  window: BenchmarkWindowDefinition,
  offers: CollectedOffer[],
  sourceHint: string,
): ProviderQuote[] {
  return scope.rooms.map((room) => {
    const best = offers
      .filter((offer) => offer.matchedRoomId === room.id)
      .sort((a, b) => a.price - b.price)[0];
    return {
      providerKey: provider.key,
      scopeKey: scope.id,
      windowId: window.id,
      roomId: room.id,
      currency: scope.currency,
      dataMode: "live",
      captureMethod: "automated",
      status: best ? "available" : "manual-review",
      price: best?.price ?? null,
      sourceHint: best?.sourceHint ?? sourceHint,
      observedAt: best?.observedAt,
      offerId: best?.id,
      roomFeatures: best?.roomFeatures,
      terms: best?.terms,
      offerDescription: best
        ? `${best.roomName} · ${best.terms.board}`
        : undefined,
      offerConditions: best ? offerConditions(best.terms) : undefined,
      reason: best
        ? undefined
        : offers.length
          ? "Gerçek teklifler bulundu; bu oda için eşleşme doğrulanamadı. Alternatif tekliflere bakın."
          : "Seçilen tarih ve kişi sayısı için doğrulanmış uçaksız toplam fiyat alınamadı.",
    };
  });
}

export function deduplicateOffers(offers: CollectedOffer[]): CollectedOffer[] {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = JSON.stringify([
      offer.providerKey,
      offer.scopeKey,
      offer.windowId,
      offer.roomName,
      offer.price,
      offer.currency,
      offer.roomFeatures,
      offer.terms,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
