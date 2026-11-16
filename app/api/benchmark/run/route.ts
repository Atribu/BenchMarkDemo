import { NextResponse } from "next/server";
import { parseBenchmarkRequest } from "@/src/lib/benchmark/request";
import { runBenchmarkJob } from "@/src/lib/ota/run-benchmark";
import { checkAccess, checkRequestOrigin } from "@/src/lib/server/access";
import { readBoundedJson } from "@/src/lib/server/bounded-json";
import {
  acquireQuery,
  getQueryGateStatus,
} from "@/src/lib/server/query-gate";
import { loadDynamicHotelRuntimeContext } from "@/src/lib/hotels/runtime-store";
import { createFileHotelStore } from "@/src/lib/hotels/file-store";
import { recordLiveCollectorEvidence } from "@/src/lib/hotels/live-verification";

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
  let runtimeContext;
  const hotelStore = createFileHotelStore();
  try {
    runtimeContext = await loadDynamicHotelRuntimeContext(hotelStore);
  } catch {
    return NextResponse.json(
      { error: "Aktif otel collector yapılandırması okunamadı." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    payload = parseBenchmarkRequest(
      await readBoundedJson(request, 4096),
      undefined,
      runtimeContext.catalog,
      runtimeContext.providers,
    );
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
  if (!release) {
    const gateStatus = getQueryGateStatus();
    const retryAfter = Math.max(
      1,
      Math.ceil(gateStatus.retryAfterMs / 1_000),
    );
    return NextResponse.json(
      {
        error:
          gateStatus.reason === "running"
            ? "Başka bir canlı sorgu halen arka planda çalışıyor. Tamamlandığında yeniden deneyin."
            : "Yeni bir sorgu başlatmak için 10 saniyelik bekleme süresinin dolmasını bekleyin.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }
  try {
    const report = await runBenchmarkJob(payload, undefined, runtimeContext);
    if (payload.mode === "live") {
      try {
        await recordLiveCollectorEvidence({
          store: hotelStore,
          manifests: runtimeContext.manifests,
          attempts: report.collectionAttempts ?? [],
        });
      } catch {
        report.warnings = [
          ...report.warnings,
          "Canlı kanal doğrulama kanıtı otel kaydına yazılamadı; fiyat raporu etkilenmedi.",
        ];
      }
    }
    return NextResponse.json(
      report,
      {
      headers: { "Cache-Control": "no-store" },
      },
    );
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
