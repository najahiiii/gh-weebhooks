import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { EVENT_NAMES } from "@/lib/services/github";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  return NextResponse.json({ events: EVENT_NAMES.slice().sort() });
}
