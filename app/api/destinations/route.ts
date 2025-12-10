import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { createDestination, listDestinations } from "@/lib/services/destinations";
import { parseTopicId } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({
  chatId: z.string().min(3),
  title: z.string().optional(),
  isDefault: z.boolean().optional(),
  topicId: z.union([z.number(), z.string()]).optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const destinations = listDestinations(user.id);
  return NextResponse.json({ destinations });
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const parseResult = createSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { chatId, title, isDefault, topicId } = parseResult.data;
  const parsedTopic = topicId === undefined ? null : parseTopicId(topicId);
  const destination = createDestination(user.id, chatId, title ?? "", Boolean(isDefault), parsedTopic);
  return NextResponse.json({ destination }, { status: 201 });
}
