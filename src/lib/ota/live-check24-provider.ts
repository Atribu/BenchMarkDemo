import type {
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
} from "@/src/lib/benchmark/types";

import { buildCheck24OfferTerms } from "./check24-offer-terms";

import { validateCheck24RoomIdentity } from "./check24-room-identity";

import { createPatchrightBrowserPage } from "./patchright-browser";
import { buildManualReviewQuotes } from "./live-helpers";
import { collectCheck24Beach } from "./live-check24";

import { extractCheck24RoomFeatures } from "./check24-room-features";

import { validateCheck24BeachOffer } from "./check24-room-validation";

export async function collectCheck24LiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];

  // Şimdilik yalnızca doğruladığımız Miramare Beach.
  if (scope.id !== "beach-eu" || scope.currency !== "EUR") {
    return buildManualReviewQuotes(
      provider,
      scope,
      "https://hotels.check24.de/",
      "CHECK24 bu otel/kapsam için henüz doğrulanmadı.",
    );
  }

  for (const window of scope.windows) {
    let handle:
      | Awaited<ReturnType<typeof createPatchrightBrowserPage>>
      | undefined;

    const sourceUrl = new URL(
      "https://hotels.check24.de/accommodation/" +
        "miramare-beach-hotel-ultra-all-inclusive-" +
        "019ab52846f67e3fa61a67dc9422e9de",
    );

    sourceUrl.searchParams.set("checkinDate", window.checkIn);
    sourceUrl.searchParams.set("checkoutDate", window.checkOut);
    sourceUrl.searchParams.set("occupancy", "[A|A]");

    let sourceHint = sourceUrl.toString();

    try {
      handle = await createPatchrightBrowserPage({
        profilePath: `./.benchmark-state/check24-${scope.id}`,
        headless: false,
        market: "de",
      });

      const result = await collectCheck24Beach(
        handle.page,
        window.checkIn,
        window.checkOut,
      );

      if (result.nights !== window.nights) {
        throw new Error("CHECK24 konaklama süresi uyuşmuyor.");
      }

      sourceHint = result.url;

      const collectedAt = new Date().toISOString();

      console.log("[CHECK24] Collection:", {
        hotel: scope.hotelName,
        apiVersion: result.apiVersion,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: result.nights,
        totalOffers: result.totalOffers,
        roomCandidates: Object.keys(result.bestOffers).length,
      });

      const bestValidatedOffers = new Map<
        string,
        {
          offer: (typeof result.offers)[number];
          validation: ReturnType<typeof validateCheck24BeachOffer>;
        }
      >();

      for (const offer of result.offers) {
        const validation = validateCheck24BeachOffer(offer, window.nights);

        if (validation.status === "rejected" || !validation.roomId) {
          continue;
        }

        const roomId = validation.roomId;

        const previous = bestValidatedOffers.get(roomId);

        // Teknik eşleşmesi daha güçlü olan adayları
        // manuel inceleme gerektirenlerden önce seç.
        const priority = {
          matched: 0,
          "manual-review": 1,
          rejected: 2,
        } as const;

        if (
          !previous ||
          priority[validation.status] < priority[previous.validation.status] ||
          (priority[validation.status] ===
            priority[previous.validation.status] &&
            offer.totalPrice < previous.offer.totalPrice)
        ) {
          bestValidatedOffers.set(roomId, {
            offer,
            validation,
          });
        }
      }

      console.log(
        "[CHECK24] Validated room candidates:",
        [...bestValidatedOffers.entries()].map(([roomId, entry]) => ({
          roomId,
          room: entry.offer.roomName,
          price: entry.offer.totalPrice,
          status: entry.validation.status,
        })),
      );

      const candidateOffers = [...bestValidatedOffers.values()];
      const confirmedMatchCount = candidateOffers.filter(
        ({ validation }) => validation.status === "matched",
      ).length;
      const manualReviewCount =
        candidateOffers.length - confirmedMatchCount;

      console.log("[CHECK24] Match summary:", {
        hotel: scope.hotelName,
        window: window.id,
        pricesFound: candidateOffers.length,
        confirmedMatches: confirmedMatchCount,
        manualReviewCandidates: manualReviewCount,
      });

      for (const [candidateId, { offer, validation }] of bestValidatedOffers) {
        const identity = validateCheck24RoomIdentity(offer);
        const terms = buildCheck24OfferTerms(offer);
        const confirmed = validation.status === "matched";

        offers.push({
          id:
            `check24:${scope.id}:${window.id}:` +
            `${candidateId}:${offer.offerId}`,
          sourceOfferId: offer.offerId,
          providerKey: provider.key,
          scopeKey: scope.id,
          windowId: window.id,
          checkIn: window.checkIn,
          checkOut: window.checkOut,
          nights: window.nights,
          rooms: 1,
          adults: 2,
          price: offer.totalPrice,
          currency: "EUR",
          roomName: offer.roomName,
          roomFeatures: validation.features,
          terms,
          sourceHint,
          observedAt: collectedAt,
          matchedRoomId: confirmed ? candidateId : undefined,
          matchReason:
            `${
              confirmed
                ? "Doğrulanmış oda eşleşmesi."
                : "Manuel oda eşleşme incelemesi gerekiyor."
            } ` +
            `Hedef oda: ${candidateId}. ` +
            `Kaynak kategorisi: ${offer.roomCategoryName}. ` +
            validation.reasons.join(" ") +
            " " +
            identity.reason,
        });
      }

      for (const room of scope.rooms) {
        const selected = bestValidatedOffers.get(room.id);

        if (!selected) {
          quotes.push({
            providerKey: provider.key,
            scopeKey: scope.id,
            roomId: room.id,
            windowId: window.id,
            price: null,
            currency: scope.currency,
            status: "manual-review",
            dataMode: "live",
            sourceHint,
            observedAt: collectedAt,
            reason:
              "CHECK24 üzerinde bu oda için " +
              "uygun bir fiyat adayı bulunamadı.",
          });
          continue;
        }

        const { offer, validation } = selected;
        const identity = validateCheck24RoomIdentity(offer);
        const terms = buildCheck24OfferTerms(offer);
        const confirmed = validation.status === "matched";
        const offerId =
          `check24:${scope.id}:${window.id}:` +
          `${room.id}:${offer.offerId}`;

        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: offer.totalPrice,
          currency: scope.currency,
          status: confirmed ? "available" : "manual-review",
          dataMode: "live",
          sourceHint,
          observedAt: collectedAt,
          offerId: confirmed ? offerId : undefined,
          offerDescription: offer.roomName,
          roomFeatures: validation.features,
          terms,
          reason:
            `${
              confirmed
                ? "CHECK24 oda adı, manzara, tarih, kişi sayısı, pansiyon ve toplam fiyat kontrolleri eşleşti."
                : "Manuel oda eşleşmesi gerekiyor."
            } ` +
            `CHECK24: ${offer.roomName}. ` +
            `Operatör: ${offer.supplierName}. ` +
            validation.reasons.join(" ") +
            " " +
            identity.reason +
            " " +
            `İptal: ${terms.cancellation}. ` +
            `Vergi: ${terms.taxes}.`,
        });
      }


      warnings.push(
        `CHECK24 / ${scope.hotelName} / ` +
          `${window.checkIn}: ` +
          `${result.totalOffers} teklif ayrıştırıldı; ` +
          `${confirmedMatchCount} oda eşleşti, ` +
          `${manualReviewCount} teklif manuel inceleme bekliyor.`,
      );
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message.split("\n")[0]
          : "CHECK24 fiyatları doğrulanamadı.";

      console.error("[CHECK24] Collection failed:", {
        hotel: scope.hotelName,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        reason,
      });

      warnings.push(
        `CHECK24 / ${scope.hotelName} / ` + `${window.checkIn}: ${reason}`,
      );

      for (const room of scope.rooms) {
        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: null,
          currency: scope.currency,
          status: "manual-review",
          dataMode: "live",
          sourceHint,
          reason,
        });
      }
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  return { quotes, offers, warnings };
}
