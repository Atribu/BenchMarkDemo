import { NextResponse } from "next/server";
import { createFileHotelStore, type HotelStore } from "@/src/lib/hotels/file-store";
import { createHotelReadRepository } from "@/src/lib/hotels/repository";
import { discoverRoomAliases } from "@/src/lib/hotels/room-alias-discovery";
import { checkAccess, checkRequestOrigin } from "@/src/lib/server/access";
import { readBoundedJson } from "@/src/lib/server/bounded-json";
import { acquireQuery } from "@/src/lib/server/query-gate";

interface Dependencies {
  store?: HotelStore;
  discover?: typeof discoverRoomAliases;
  acquire?: typeof acquireQuery;
}

interface Context {
  params: Promise<{ id: string; mappingId: string }>;
}

export function createRoomSuggestionRouteHandlers(dependencies: Dependencies = {}) {
  const store = dependencies.store ?? createFileHotelStore();
  const discover = dependencies.discover ?? discoverRoomAliases;
  const acquire = dependencies.acquire ?? acquireQuery;
  return {
    async POST(request: Request, context: Context) {
      const denied = await checkAccess(request);
      if (denied) return denied;
      const originError = checkRequestOrigin(request);
      if (originError) return originError;
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
        return NextResponse.json({ error: "JSON isteği gönderin." }, { status: 415 });

      let input: { checkIn?: unknown; checkOut?: unknown };
      try {
        input = await readBoundedJson(request, 2048) as typeof input;
      } catch {
        return NextResponse.json({ error: "Geçerli tarih bilgileri gönderin." }, { status: 400 });
      }
      if (typeof input.checkIn !== "string" || typeof input.checkOut !== "string")
        return NextResponse.json({ error: "Giriş ve çıkış tarihleri zorunludur." }, { status: 400 });

      const release = acquire();
      if (!release)
        return NextResponse.json(
          { error: "Başka bir canlı sorgu çalışıyor. Lütfen biraz sonra tekrar deneyin." },
          { status: 429, headers: { "Retry-After": "10" } },
        );
      try {
        const { id, mappingId } = await context.params;
        const hotel = createHotelReadRepository(await store.load()).findById(id);
        if (!hotel) return NextResponse.json({ error: "Otel bulunamadı." }, { status: 404 });
        const result = await discover(hotel, mappingId, {
          checkIn: input.checkIn,
          checkOut: input.checkOut,
        });
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "OTA oda adları alınamadı." },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      } finally {
        release();
      }
    },
  };
}
