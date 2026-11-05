import { NextResponse } from "next/server";
import {
  createFileHotelStore,
  type HotelStore,
} from "@/src/lib/hotels/file-store";
import {
  HotelManagementError,
  HotelManagementService,
  type HotelManagementErrorKind,
} from "@/src/lib/hotels/service";
import { checkAccess, checkRequestOrigin } from "@/src/lib/server/access";
import { readBoundedJson } from "@/src/lib/server/bounded-json";

interface HotelRoomDetailRouteDependencies {
  store?: HotelStore;
  now?: () => Date;
}

interface HotelRoomDetailRouteContext {
  params: Promise<{ id: string; roomId: string }>;
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

export function createHotelRoomDetailRouteHandlers(
  dependencies: HotelRoomDetailRouteDependencies = {},
) {
  const service = new HotelManagementService({
    store: dependencies.store ?? createFileHotelStore(),
    now: dependencies.now,
  });

  async function mutate(
    request: Request,
    context: HotelRoomDetailRouteContext,
    action: "update" | "remove",
  ) {
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
      payload = await readBoundedJson(request, 4096);
    } catch {
      return NextResponse.json(
        { error: "Geçerli ve en fazla 4 KB büyüklüğünde JSON gönderin." },
        { status: 400, headers: responseHeaders },
      );
    }

    try {
      const { id, roomId } = await context.params;
      const hotel =
        action === "update"
          ? await service.updateRoom(
              id,
              roomId,
              payload,
              requestActor(request),
            )
          : await service.removeRoom(
              id,
              roomId,
              payload,
              requestActor(request),
            );
      return NextResponse.json(
        {
          hotel,
          ...(action === "update"
            ? { room: hotel.rooms.find((item) => item.id === roomId) }
            : {}),
        },
        { headers: responseHeaders },
      );
    } catch (error) {
      if (error instanceof HotelManagementError)
        return NextResponse.json(
          { error: error.message },
          { status: errorStatus(error.kind), headers: responseHeaders },
        );
      return NextResponse.json(
        {
          error:
            action === "update"
              ? "Otel oda tipi güncellenemedi."
              : "Otel oda tipi silinemedi.",
        },
        { status: 503, headers: responseHeaders },
      );
    }
  }

  return {
    PATCH(request: Request, context: HotelRoomDetailRouteContext) {
      return mutate(request, context, "update");
    },
    DELETE(request: Request, context: HotelRoomDetailRouteContext) {
      return mutate(request, context, "remove");
    },
  };
}

const handlers = createHotelRoomDetailRouteHandlers();

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
