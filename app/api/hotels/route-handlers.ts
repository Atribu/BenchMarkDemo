import { NextResponse } from "next/server";
import { checkAccess, checkRequestOrigin } from "@/src/lib/server/access";
import { readBoundedJson } from "@/src/lib/server/bounded-json";
import {
  createFileHotelStore,
  type HotelStore,
} from "@/src/lib/hotels/file-store";
import {
  HotelManagementError,
  HotelManagementService,
} from "@/src/lib/hotels/service";

interface HotelRouteDependencies {
  store?: HotelStore;
  generateId?: () => string;
  now?: () => Date;
}

const responseHeaders = { "Cache-Control": "no-store" };

function requestActor(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  try {
    if (/^Basic /i.test(authorization) && authorization.length < 4096) {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      if (separator > 0) return decoded.slice(0, separator);
    }
  } catch {
    // checkAccess rejects malformed credentials outside local development.
  }
  return "local-development";
}

export function createHotelRouteHandlers(
  dependencies: HotelRouteDependencies = {},
) {
  const service = new HotelManagementService({
    store: dependencies.store ?? createFileHotelStore(),
    generateId: dependencies.generateId,
    now: dependencies.now,
  });

  return {
    async GET(request: Request) {
      const denied = await checkAccess(request);
      if (denied) return denied;
      try {
        const includeArchived =
          new URL(request.url).searchParams.get("includeArchived") === "true";
        return NextResponse.json(
          { hotels: await service.list(includeArchived) },
          { headers: responseHeaders },
        );
      } catch {
        return NextResponse.json(
          { error: "Otel kayıtları okunamadı." },
          { status: 503, headers: responseHeaders },
        );
      }
    },

    async POST(request: Request) {
      const denied = await checkAccess(request);
      if (denied) return denied;
      const originError = checkRequestOrigin(request);
      if (originError) return originError;
      if (
        request.headers.get("content-type")?.split(";")[0].trim() !==
        "application/json"
      )
        return NextResponse.json(
          { error: "JSON isteği gönderin." },
          { status: 415, headers: responseHeaders },
        );

      let payload: unknown;
      try {
        payload = await readBoundedJson(request, 16_384);
      } catch {
        return NextResponse.json(
          { error: "Geçerli ve en fazla 16 KB büyüklüğünde JSON gönderin." },
          { status: 400, headers: responseHeaders },
        );
      }

      try {
        const hotel = await service.createDraft(payload, requestActor(request));
        return NextResponse.json(
          { hotel },
          {
            status: 201,
            headers: {
              ...responseHeaders,
              Location: `/api/hotels/${hotel.id}`,
            },
          },
        );
      } catch (error) {
        if (error instanceof HotelManagementError)
          return NextResponse.json(
            { error: error.message },
            {
              status: error.kind === "conflict" ? 409 : 400,
              headers: responseHeaders,
            },
          );
        return NextResponse.json(
          { error: "Otel kaydı oluşturulamadı." },
          { status: 503, headers: responseHeaders },
        );
      }
    },
  };
}

const handlers = createHotelRouteHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
