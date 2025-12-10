import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { deleteDestination, getDestination, updateDestination } from "@/lib/services/destinations";
import { countSubscriptionsForDestination } from "@/lib/services/subscriptions";
import { parseTopicId } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateSchema = z.object({
  chatId: z.string().optional(),
  title: z.string().optional(),
  isDefault: z.boolean().optional(),
  topicId: z.union([z.number(), z.string(), z.null()]).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const parseResult = updateSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { chatId, title, isDefault, topicId } = parseResult.data;
  const parsedTopic = topicId === undefined ? destination.topicId : parseTopicId(topicId);
  updateDestination(
    user.id,
    id,
    chatId ?? destination.chatId,
    title ?? destination.title,
    isDefault ?? destination.isDefault,
    parsedTopic
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const activeSubs = countSubscriptionsForDestination(destination.id);
  if (activeSubs > 0) {
    return NextResponse.json(
      {
        error: "destination_has_subscriptions",
        message: "Remove subscriptions linked to this destination before deleting it."
      },
      { status: 409 }
    );
  }
  deleteDestination(id);
  return NextResponse.json({ ok: true });
}
