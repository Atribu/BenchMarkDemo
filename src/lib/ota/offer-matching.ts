import type {
  BenchmarkWindowDefinition,
  CollectedOffer,
  OfferTerms,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
  RoomFeatures,
} from "../benchmark/types";
import { getHotelDefinition } from "../hotels/catalog";
import { hasCompatibleView } from "./room-matching";
import type { ManagedHotelMatchingPolicy } from "../hotels/model";

export type RoomAliasMap = Readonly<Record<string, readonly string[]>>;

export interface ResolvedRoomMatch {
  roomFeatures: RoomFeatures;
  matchedRoomId?: string;
  matchReason: string;
}

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
  runtimePolicy?: ManagedHotelMatchingPolicy,
) {
  const policy = runtimePolicy ?? getHotelDefinition(scope.hotelKey).matchingPolicy;
  if (features.category === "variant")
    return { matchReason: "Ekonomi, aile veya farklı oda kategorisi." };
  if (features.view === "partial-sea" && !policy.roomByView["partial-sea"])
    return {
      matchReason:
        "Yan/kısmi deniz manzarası; tam deniz manzarası ile eşdeğer değil.",
    };
  if (features.view === "unknown")
    return { matchReason: "Odanın manzarası doğrulanamadı." };
  if (features.balcony === "no" && policy.requireBalcony)
    return {
      matchReason: "Balkonsuz oda; normal oda satırına dahil edilmedi.",
    };
  if (features.category !== policy.category)
    return { matchReason: "İstenen oda kategorisi doğrulanamadı." };
  if (policy.requireBalcony && features.balcony !== "yes")
    return { matchReason: "Odanın balkon bilgisi doğrulanamadı." };
  const roomId = policy.roomByView[features.view];
  if (!roomId)
    return { matchReason: "Bu manzara için doğrulanmış oda eşleştirmesi yok." };
  return scope.rooms.some((room) => room.id === roomId)
    ? {
        matchedRoomId: roomId,
        matchReason:
          "Oda kategorisi eşleşti; pansiyon ve iptal koşulları ayrıca karşılaştırılmalı.",
      }
    : { matchReason: "Bu oda raporun oda kategorilerinde yok." };
}

export function resolveRoomMatch(
  scope: ReportScopeDefinition,
  roomName: string,
  aliases: RoomAliasMap = {},
  details = "",
  runtimePolicy?: ManagedHotelMatchingPolicy,
): ResolvedRoomMatch {
  const roomFeatures = classifyRoom(roomName, details);
  const normalizedRoomName = normalize(roomName);
  const exactRoomIds = Object.entries(aliases)
    .filter(([, roomAliases]) =>
      roomAliases.some((alias) => normalize(alias) === normalizedRoomName),
    )
    .map(([roomId]) => roomId);

  if (exactRoomIds.length > 1) {
    return {
      roomFeatures,
      matchReason:
        "Oda adı birden fazla doğrulanmış kategoriyle çakıştığı için eşleştirilmedi.",
    };
  }

  const exactRoomId = exactRoomIds[0];
  if (!exactRoomId) {
    return {
      roomFeatures,
      ...matchOfferRoom(scope, roomFeatures, runtimePolicy),
    };
  }

  if (!scope.rooms.some((room) => room.id === exactRoomId)) {
    return {
      roomFeatures,
      matchReason: "Doğrulanan oda rapor kapsamındaki odalarda yok.",
    };
  }

  const policy = runtimePolicy ?? getHotelDefinition(scope.hotelKey).matchingPolicy;
  const expectedViews = Object.entries(policy.roomByView)
    .filter(([, roomId]) => roomId === exactRoomId)
    .map(([view]) => view);

  if (
    roomFeatures.view !== "unknown" &&
    expectedViews.length > 0 &&
    !expectedViews.includes(roomFeatures.view)
  ) {
    return {
      roomFeatures,
      matchReason:
        roomFeatures.view === "partial-sea"
          ? "Yan/kısmi deniz manzarası; tam deniz manzarası ile eşdeğer değil."
          : "Oda adındaki manzara, doğrulanmış oda kategorisiyle çelişiyor.",
    };
  }

  if (
    expectedViews.length > 0 &&
    (roomFeatures.category === "standard" ||
      roomFeatures.category === "superior") &&
    roomFeatures.category !== policy.category
  ) {
    return {
      roomFeatures,
      matchReason: "Oda adındaki kategori, otelin oda kategorisiyle çelişiyor.",
    };
  }

  if (
    expectedViews.length > 0 &&
    policy.requireBalcony &&
    roomFeatures.balcony === "no"
  ) {
    return {
      roomFeatures,
      matchReason: "Balkonsuz oda; normal oda satırına dahil edilmedi.",
    };
  }

  return {
    roomFeatures,
    matchedRoomId: exactRoomId,
    matchReason: "Oda adı doğrulanmış alias ile kesin olarak eşleşti.",
  };
}

export function namedRoomRank(
  roomId: string,
  name: string,
  aliases: readonly string[] = [],
): number | null {
  const normalizedName = name.replace(/\s+/g, " ").trim();
  const aliasRank = aliases.findIndex(
    (alias) => normalize(alias) === normalize(normalizedName),
  );

  if (roomId === "economy") {
    if (aliasRank >= 0) return aliasRank;
    if (/^Economy Room$/i.test(normalizedName)) return 0;
    if (/^Economy$/i.test(normalizedName)) return 5;
    return null;
  }

  if (roomId === "family" || roomId === "king-suite")
    return aliasRank >= 0 ? aliasRank : null;

  if (roomId === "corner") {
    if (/^Superior Corner Room$/i.test(normalizedName)) return 0;
    if (/\bcorner\b/i.test(normalizedName)) return 5;
    return null;
  }

  if (
    !hasCompatibleView(roomId, normalizedName) ||
    /\b(suite|family|deluxe|corner|familienzimmer|eckzimmer)\b/i.test(
      normalizedName,
    )
  ) {
    return null;
  }

  if (
    roomId.startsWith("superior") &&
    !/\bsuperior\b/i.test(normalizedName)
  ) {
    return null;
  }

  if (
    roomId.startsWith("standard") &&
    /\bsuperior\b/i.test(normalizedName)
  ) {
    return null;
  }

  return (
    (aliasRank >= 0 ? aliasRank : 10) +
    (/promo|economy|no balcony|without balcony/i.test(normalizedName) ? 20 : 0)
  );
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
