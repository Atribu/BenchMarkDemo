
import { REPORT_SCOPES } from "../src/lib/benchmark/sample-data";
import { OTA_PROVIDERS } from "../src/lib/ota/registry";
import { collectSchauinslandLiveQuotes } from "../src/lib/ota/live-schauinsland";

async function main() {
  // İlk testte yalnızca Miramare Beach kullanıyoruz.
  const scope = REPORT_SCOPES.find(
    (item) => item.id === "queen-eu",
  );

  if (!scope) {
    throw new Error("Miramare Queen EUR kapsamı bulunamadı.");
  }

  // Registry entegrasyonunu henüz yapmadığımız için
  // geçici olarak başka bir sağlayıcının tanımını kullanıyoruz.
const existingProvider = OTA_PROVIDERS.find(
  (item) => item.key === "schauinsland",
);

  if (!existingProvider) {
    throw new Error("Test sağlayıcısı bulunamadı.");
  }

  // Test için sağlayıcı anahtarını ayarlıyoruz.
  // TypeScript tipine Schauinsland henüz eklenmediği için
  // bu adımda geçici tanım kullanıyoruz.
  const provider = {
    ...existingProvider,
    name: "Schauinsland Reisen",
  };

  // Bütün tarih pencereleri yerine yalnızca ilkini test et.
const testScope = {
  ...scope,
  windows: [
    {
      ...scope.windows[0],
      checkIn: "2026-10-29",
      checkOut: "2026-11-03",
      nights: 5,
    },
  ],
};

  console.log("[SCHAUINSLAND] Collector test started", {
    hotel: testScope.hotelName,
    windows: testScope.windows.map((window) => ({
      checkIn: window.checkIn,
      checkOut: window.checkOut,
      nights: window.nights,
    })),
  });

  const result = await collectSchauinslandLiveQuotes(
    provider,
    testScope,
  );

  console.log("\n[SCHAUINSLAND] Collection summary:", {
    quotes: result.quotes.length,
    offers: result.offers?.length ?? 0,
    warnings: result.warnings.length,
  });

  console.log("\n[SCHAUINSLAND] Quotes:");

  console.table(
    result.quotes.map((quote) => ({
      roomId: quote.roomId,
      status: quote.status,
      price: quote.price,
      currency: quote.currency,
      offer: quote.offerDescription ?? "-",
      reason: quote.reason ?? "-",
    })),
  );

  console.log("\n[SCHAUINSLAND] Offers:");

  console.table(
    (result.offers ?? []).map((offer) => ({
      room: offer.roomName,
      matchedRoomId: offer.matchedRoomId ?? "-",
      price: offer.price,
      currency: offer.currency,
      checkIn: offer.checkIn,
      checkOut: offer.checkOut,
    })),
  );

  if (result.warnings.length > 0) {
    console.log(
      "\n[SCHAUINSLAND] Warnings:",
      result.warnings,
    );
  }
}

main().catch((error) => {
  console.error("[SCHAUINSLAND] Collector test failed:", error);
  process.exitCode = 1;
});
