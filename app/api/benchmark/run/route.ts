import { NextResponse } from "next/server";
import { parseBenchmarkRequest } from "@/src/lib/benchmark/request";
import { runBenchmarkJob } from "@/src/lib/ota/run-benchmark";
import { checkAccess, checkRequestOrigin } from "@/src/lib/server/access";
import { readBoundedJson } from "@/src/lib/server/bounded-json";
import { acquireQuery } from "@/src/lib/server/query-gate";

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
  let payload;
  try {
    payload = parseBenchmarkRequest(await readBoundedJson(request, 4096));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SyntaxError
            ? "Geçersiz JSON isteği."
            : error instanceof Error
              ? error.message
              : "Geçersiz sorgu.",
      },
      { status: 400 },
    );
  }

  if (process.env.NODE_ENV === "production" && payload.mode !== "live")
    return NextResponse.json(
      { error: "Yayında yalnızca gerçek fiyat sorgulanabilir." },
      { status: 400 },
    );
  const release = acquireQuery();
  if (!release)
    return NextResponse.json(
      {
        error:
          "Bir sorgu çalışıyor veya çok kısa süre önce başlatıldı. Lütfen bekleyip tekrar deneyin.",
      },
      {
        status: 429,
        headers: { "Retry-After": "10", "Cache-Control": "no-store" },
      },
    );
  try {
    return NextResponse.json(await runBenchmarkJob(payload), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Rapor tamamlanamadı. Seçimlerinizi kontrol edip tekrar deneyin.",
      },
      { status: 500 },
    );
  } finally {
    release();
  }
}
