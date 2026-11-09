import { NextResponse } from "next/server";
import {
  benchmarkXlsx,
  parseBenchmarkXlsxPayload,
} from "@/src/lib/benchmark/xlsx-export";
import { checkAccess, checkRequestOrigin } from "@/src/lib/server/access";
import { readBoundedJson } from "@/src/lib/server/bounded-json";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
      { status: 415 },
    );

  try {
    const payload = parseBenchmarkXlsxPayload(
      await readBoundedJson(request, 1024 * 1024),
    );
    const bytes = await benchmarkXlsx(payload);
    const safeRunId = payload.runId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="dgtlface-fiyat-karsilastirma-${safeRunId}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Excel dosyası oluşturulamadı.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
