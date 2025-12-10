import { config } from "@/lib/config";
import { revokeSession } from "@/lib/services/sessions";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(config.sessionCookieName)?.value;
  if (token) {
    revokeSession(token);
    jar.delete(config.sessionCookieName);
  }
  return NextResponse.json({ ok: true });
}
