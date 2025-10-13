import { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { config } from "../config";
import { getUserBySessionToken } from "../services/users";
import { getSession } from "../services/sessions";

export const sessionMiddleware = [cookieParser(), attachUser];

function attachUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[config.sessionCookieName];
  if (!token) {
    return next();
  }
  const session = getSession(token);
  if (!session) {
    return next();
  }
  const expired = new Date(session.expiresAt) <= new Date();
  if (expired) {
    return next();
  }
  const user = getUserBySessionToken(token);
  if (user) {
    (req as any).user = user;
  }
  return next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}
