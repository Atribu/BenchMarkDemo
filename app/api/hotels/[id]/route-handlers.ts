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

interface HotelDetailRouteDependencies {
  store?: HotelStore;
  now?: () => Date;
}

interface HotelRouteContext {
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

function managementError(error: HotelManagementError): NextResponse {
  return NextResponse.json(
    { error: error.message },
    { status: errorStatus(error.kind), headers: responseHeaders },
  );
}

export function createHotelDetailRouteHandlers(
  dependencies: HotelDetailRouteDependencies = {},
) {
  const service = new HotelManagementService({
    store: dependencies.store ?? createFileHotelStore(),
    now: dependencies.now,
  });

  return {
    async GET(request: Request, context: HotelRouteContext) {
      const denied = await checkAccess(request);
      if (denied) return denied;
      try {
        const { id } = await context.params;
        return NextResponse.json(
          { hotel: await service.getById(id) },
          { headers: responseHeaders },
        );
      } catch (error) {
        if (error instanceof HotelManagementError)
          return managementError(error);
        return NextResponse.json(
          { error: "Otel kaydı okunamadı." },
          { status: 503, headers: responseHeaders },
        );
      }
    },

    async PATCH(request: Request, context: HotelRouteContext) {
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
        const { id } = await context.params;
        const hotel = await service.updateDetails(
          id,
          payload,
          requestActor(request),
        );
        return NextResponse.json({ hotel }, { headers: responseHeaders });
      } catch (error) {
        if (error instanceof HotelManagementError)
          return managementError(error);
        return NextResponse.json(
          { error: "Otel kaydı güncellenemedi." },
          { status: 503, headers: responseHeaders },
        );
      }
    },
  };
}

const handlers = createHotelDetailRouteHandlers();

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
