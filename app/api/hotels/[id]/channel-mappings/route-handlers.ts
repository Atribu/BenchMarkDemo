import { NextResponse } from "next/server";
import { HotelChannelManagementService } from "@/src/lib/hotels/channel-service";
import {
  createFileHotelStore,
  type HotelStore,
} from "@/src/lib/hotels/file-store";
import {
  HotelManagementError,
  type HotelManagementErrorKind,
} from "@/src/lib/hotels/service";
import { checkAccess, checkRequestOrigin } from "@/src/lib/server/access";
import { readBoundedJson } from "@/src/lib/server/bounded-json";

interface ChannelMappingRouteDependencies {
  store?: HotelStore;
  generateId?: () => string;
  now?: () => Date;
}

interface ChannelMappingRouteContext {
  params: Promise<{ id: string }>;
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

function errorStatus(kind: HotelManagementErrorKind): number {
  if (kind === "not_found") return 404;
  if (kind === "forbidden") return 403;
  if (kind === "conflict") return 409;
  return 400;
}

export function createChannelMappingRouteHandlers(
  dependencies: ChannelMappingRouteDependencies = {},
) {
  const service = new HotelChannelManagementService({
    store: dependencies.store ?? createFileHotelStore(),
    generateId: dependencies.generateId,
    now: dependencies.now,
  });

  return {
    async POST(request: Request, context: ChannelMappingRouteContext) {
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
        payload = await readBoundedJson(request, 131_072);
      } catch {
        return NextResponse.json(
          { error: "Geçerli ve en fazla 128 KB büyüklüğünde JSON gönderin." },
          { status: 400, headers: responseHeaders },
        );
      }

      try {
        const { id } = await context.params;
        const hotel = await service.create(
          id,
          payload,
          requestActor(request),
        );
        const mapping = hotel.channelMappings.at(-1);
        return NextResponse.json(
          { hotel, mapping },
          {
            status: 201,
            headers: {
              ...responseHeaders,
              Location: `/api/hotels/${hotel.id}/channel-mappings/${mapping?.id ?? ""}`,
            },
          },
        );
      } catch (error) {
        if (error instanceof HotelManagementError)
          return NextResponse.json(
            { error: error.message },
            { status: errorStatus(error.kind), headers: responseHeaders },
          );
          console.error("[ChannelMappings] Create failed:", error);
        return NextResponse.json(
          { error: "OTA kanal eşleştirmesi eklenemedi." },
          { status: 503, headers: responseHeaders },
        );
      }
    },
  };
}

const handlers = createChannelMappingRouteHandlers();

export const POST = handlers.POST;
