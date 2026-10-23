
import type {
  CollectedOffer,
  ProviderCollectionResult,
  ProviderDescriptor,
  ProviderQuote,
  ReportScopeDefinition,
  RoomDefinition,
  RoomFeatures,
} from "@/src/lib/benchmark/types";

import { createPatchrightBrowserPage } from "./patchright-browser";
import { parseAnexTourOffers } from "./anextour-parser";
import { buildManualReviewQuotes } from "./live-helpers";

const ANEX_HOTELS: Partial<Record<ReportScopeDefinition["hotelKey"], string>> = {
  "miramare-beach": "1708",
  // Miramare Queen aid doğrulandığında buraya eklenecek.
};

type AnexRoomKind =
  | "economy"
  | "corner"
  | "partial-sea"
  | "land"
  | "sea";

function normalizeRoomName(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

function getRoomKind(value: string): AnexRoomKind | null {
  const text = normalizeRoomName(value);

  if (/economy|ekonomi|ekonom|sparzimmer/.test(text)) {
    return "economy";
  }

  if (/corner|eckzimmer|kose/.test(text)) {
    return "corner";
  }

  if (
    /partial.sea|side.sea|seitl|teilmeer|kismi.deniz|yan.deniz/.test(text)
  ) {
    return "partial-sea";
  }

  if (/land|kara|garden|garten/.test(text)) {
    return "land";
  }

  if (/meer|sea|deniz/.test(text)) {
    return "sea";
  }

  return null;
}

function findMatchingRoom(
  rooms: RoomDefinition[],
  roomName: string,
): RoomDefinition | undefined {
  const offerKind = getRoomKind(roomName);

  if (!offerKind) return undefined;

  return rooms.find((room) => {
    const expectedKind =
      getRoomKind(room.id) ?? getRoomKind(room.name);

    return expectedKind === offerKind;
  });
}

function getRoomFeatures(roomName: string): RoomFeatures {
  const kind = getRoomKind(roomName);

  return {
    category:
      kind === "economy" || kind === "corner"
        ? "variant"
        : /superior/i.test(roomName)
          ? "superior"
          : "unknown",
    view:
      kind === "partial-sea"
        ? "partial-sea"
        : kind === "sea"
          ? "sea"
          : kind === "land"
            ? "land"
            : "unknown",
    balcony: "unknown",
  };
}

function buildAnexUrl(
  accommodationId: string,
  checkIn: string,
  checkOut: string,
  nights: number,
): string {
  const url = new URL(
    "https://nurhotel.anextour.de/search/offer",
  );

  url.searchParams.set("aid", accommodationId);
  url.searchParams.set("dur", String(nights));
  url.searchParams.set("ibe", "hotel");
  url.searchParams.set("ddate", checkIn);
  url.searchParams.set("rdate", checkOut);
  url.searchParams.set("adult", "2");

  return url.toString();
}

export async function collectAnexTourLiveQuotes(
  provider: ProviderDescriptor,
  scope: ReportScopeDefinition,
): Promise<ProviderCollectionResult> {
  const quotes: ProviderQuote[] = [];
  const offers: CollectedOffer[] = [];
  const warnings: string[] = [];

  const accommodationId = ANEX_HOTELS[scope.hotelKey];

  if (!accommodationId || scope.currency !== "EUR") {
    return buildManualReviewQuotes(
      provider,
      scope,
      "https://nurhotel.anextour.de/",
      "ANEX Tour için bu otelin kimliği veya EUR kapsamı henüz doğrulanmadı.",
    );
  }

  for (const window of scope.windows) {
    const sourceHint = buildAnexUrl(
      accommodationId,
      window.checkIn,
      window.checkOut,
      window.nights,
    );

    let handle:
      | Awaited<ReturnType<typeof createPatchrightBrowserPage>>
      | undefined;

    try {
      handle = await createPatchrightBrowserPage({
        profilePath: `./.benchmark-state/anextour-${scope.id}`,
        headless: false,
        market: "de",
      });

      const page = handle.page;

      // Dinleyiciyi navigasyondan önce başlatıyoruz.
      const listResponsePromise = page.waitForResponse(
        (response) => {
          const request = response.request();
          const pathname = new URL(response.url()).pathname;

          return (
            response.url().startsWith(
              "https://nurhotel.anextour.de/",
            ) &&
            pathname === "/api/search/offers/list" &&
            request.method() === "POST"
          );
        },
        { timeout: 45_000 },
      );

      const navigation = await page.goto(sourceHint, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      if (!navigation || navigation.status() !== 200) {
        throw new Error(
          `ANEX navigasyon başarısız: HTTP ${navigation?.status() ?? "unknown"}`,
        );
      }

      const listResponse = await listResponsePromise;

      if (listResponse.status() !== 200) {
        throw new Error(
          `ANEX teklif servisi HTTP ${listResponse.status()}`,
        );
      }

      const requestPayload = listResponse
        .request()
        .postDataJSON();

      // API isteğinin gerçekten paneldeki aramaya ait
      // olduğunu fiyatları okumadan önce doğruluyoruz.
      if (
        requestPayload?.dates?.start !== window.checkIn ||
        requestPayload?.dates?.end !== window.checkOut ||
        requestPayload?.durations?.days?.[0] !== window.nights ||
        !requestPayload?.accommodations?.ids?.includes(
          accommodationId,
        ) ||
        requestPayload?.ageOfPersons?.adults?.length !== 2 ||
        requestPayload?.ageOfPersons?.children?.length > 0
      ) {
        throw new Error(
          "ANEX API arama koşulları benchmark kriterleriyle eşleşmiyor.",
        );
      }

      const responseJson = await listResponse.json();

      const parsedOffers = parseAnexTourOffers(responseJson, {
        accommodationId,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
      });

      console.log("[ANEX] Collection:", {
        hotel: scope.hotelName,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
        nights: window.nights,
        verifiedOffers: parsedOffers.length,
      });

      const collectedAt = new Date().toISOString();

      const matchedOffers = parsedOffers.map((offer, index) => {
        const matchedRoom = findMatchingRoom(
          scope.rooms,
          offer.roomName,
        );

        const collected: CollectedOffer = {
          id: `anextour:${scope.id}:${window.id}:${index}`,
          providerKey: "anextour",
          scopeKey: scope.id,
          windowId: window.id,
          checkIn: offer.checkIn,
          checkOut: offer.checkOut,
          nights: offer.nights,
          rooms: 1,
          adults: 2,
          price: offer.price,
          currency: "EUR",
          roomName: offer.roomName,
          roomFeatures: getRoomFeatures(offer.roomName),
          terms: {
            board: offer.board,
            cancellation: "Kaynakta doğrulanmalı",
            taxes: "Kaynakta doğrulanmalı",
            operator: "ANEX Tour",
            availability: "Teklif yanıtında listelendi",
          },
          sourceHint,
          observedAt: collectedAt,
          matchedRoomId: matchedRoom?.id,
          matchReason: matchedRoom
            ? "ANEX oda kategorisi eşleşti; tarife koşulları ayrıca kontrol edilmeli."
            : "Oda kategorisi güvenle eşleştirilemedi.",
        };

        return collected;
      });

      offers.push(...matchedOffers);

      for (const room of scope.rooms) {
        const matching = matchedOffers
          .filter((offer) => offer.matchedRoomId === room.id)
          .sort((a, b) => a.price - b.price);

        const best = matching[0];

        quotes.push({
          providerKey: provider.key,
          scopeKey: scope.id,
          roomId: room.id,
          windowId: window.id,
          price: best?.price ?? null,
          currency: scope.currency,
          status: best ? "available" : "manual-review",
          dataMode: "live",
          captureMethod: "automated",
          observedAt: collectedAt,
          sourceHint,
          offerDescription: best?.roomName,
          roomFeatures: best?.roomFeatures,
          terms: best?.terms,
          offerConditions: best
            ? `${best.terms.board}; ANEX Tour; ${window.nights} gece; 1 oda / 2 yetişkin; EUR toplam fiyat; iptal ve vergi koşulları ayrıca doğrulanmalı.`
            : undefined,
          reason: best
            ? undefined
            : "Bu oda kategorisinde kesin tarihli ANEX teklifi doğrulanamadı.",
        });
      }
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message.split("\n")[0]
          : "ANEX Tour fiyatları doğrulanamadı.";

      warnings.push(
        `ANEX Tour / ${scope.hotelName} / ${window.checkIn}: ${reason}`,
      );

      quotes.push(
        ...scope.rooms.map(
          (room): ProviderQuote => ({
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
          }),
        ),
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  return { quotes, warnings, offers };
}
