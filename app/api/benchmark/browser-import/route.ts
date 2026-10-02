import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(_request: Request) {
  return NextResponse.json(
    { error: "Dosya aktarımı kaldırıldı. Fiyatları getir düğmesini kullanın." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
