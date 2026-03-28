import { NextResponse } from "next/server";
import { DEFAULT_REQUEST } from "@/src/lib/benchmark/sample-data";
import type { BenchmarkRequest } from "@/src/lib/benchmark/types";
import { runBenchmarkJob } from "@/src/lib/ota/run-benchmark";

export async function POST(request: Request) {
  let payload: Partial<BenchmarkRequest> = {};

  try {
    payload = (await request.json()) as Partial<BenchmarkRequest>;
  } catch {
    payload = {};
  }

  const report = await runBenchmarkJob({
    mode: payload.mode ?? DEFAULT_REQUEST.mode,
    providerKeys: payload.providerKeys ?? DEFAULT_REQUEST.providerKeys,
    scopeKeys: payload.scopeKeys ?? DEFAULT_REQUEST.scopeKeys,
    customWindow: payload.customWindow ?? DEFAULT_REQUEST.customWindow
  });

  return NextResponse.json(report);
}
