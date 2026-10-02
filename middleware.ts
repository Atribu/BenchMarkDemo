import { NextResponse, type NextRequest } from "next/server";
import { checkAccess } from "./src/lib/server/access";

export async function middleware(request: NextRequest) {
  return (await checkAccess(request)) ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
