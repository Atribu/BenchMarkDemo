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

interface HotelMatchingPolicyRouteDependencies {
  store?: HotelStore;
  now?: () => Date;
}

interface HotelMatchingPolicyRouteContext {
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

export function createHotelMatchingPolicyRouteHandlers(
  dependencies: HotelMatchingPolicyRouteDependencies = {},
) {
  const service = new HotelManagementService({
    store: dependencies.store ?? createFileHotelStore(),
    now: dependencies.now,
  });

  async function mutate(
    request: Request,
    context: HotelMatchingPolicyRouteContext,
    action: "set" | "remove",
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
      const { id } = await context.params;
      const hotel =
        action === "set"
          ? await service.setMatchingPolicy(
              id,
              payload,
              requestActor(request),
            )
          : await service.removeMatchingPolicy(
              id,
              payload,
              requestActor(request),
            );
      return NextResponse.json(
        { hotel, matchingPolicy: hotel.matchingPolicy ?? null },
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
            action === "set"
              ? "Oda eşleştirme politikası kaydedilemedi."
              : "Oda eşleştirme politikası silinemedi.",
        },
        { status: 503, headers: responseHeaders },
      );
    }
  }

  return {
    PUT(request: Request, context: HotelMatchingPolicyRouteContext) {
      return mutate(request, context, "set");
    },
    DELETE(request: Request, context: HotelMatchingPolicyRouteContext) {
      return mutate(request, context, "remove");
    },
  };
}

const handlers = createHotelMatchingPolicyRouteHandlers();

export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
