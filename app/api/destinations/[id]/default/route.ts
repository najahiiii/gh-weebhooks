import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { getDestination, setDefaultDestination } from "@/lib/services/destinations";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Destination not found" }, { status: 404 });
  }
  const destination = getDestination(id);
  if (!destination || destination.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Destination not found" }, { status: 404 });
  }
  setDefaultDestination(user.id, id);
  return NextResponse.json({ ok: true });
}
