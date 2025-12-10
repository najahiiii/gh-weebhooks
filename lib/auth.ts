import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "lib/config";
import { getSession } from "lib/services/sessions";
import { getUserBySessionToken, type User } from "lib/services/users";

export async function getAuthenticatedUser(): Promise<User | null> {
  const token = (await cookies()).get(config.sessionCookieName)?.value;
  if (!token) {
    return null;
  }
  const session = getSession(token);
  if (!session) {
    return null;
  }
  const expired = new Date(session.expiresAt) <= new Date();
  if (expired) {
    return null;
  }
  const user = getUserBySessionToken(token);
  return user ?? null;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
