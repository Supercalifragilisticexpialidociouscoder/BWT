import type { NextFunction, Request, Response } from 'express';
import type { Types } from 'mongoose';
import { env } from '../config/env';
import { randomToken, sha256 } from '../lib/crypto';
import { forbidden, unauthorized } from '../lib/errors';
import { Session, User, type IUser } from '../models';
import { disconnectSession } from '../realtime/bus';
import type { UserRole } from '@campusflow/shared';

export const SESSION_COOKIE = 'cf_sid';
const REFRESH_AFTER_MS = 60 * 60 * 1000;

export type AuthUser = Omit<IUser, 'passwordHash'>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: Types.ObjectId;
    }
  }
}

function ttlMs() {
  return env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ttlMs(),
  };
}

/** Create a server-side session; only a SHA-256 hash of the token is stored. */
export async function createSession(res: Response, userId: Types.ObjectId, userAgent: string): Promise<void> {
  const token = randomToken(32);
  const now = new Date();
  await Session.create({
    tokenHash: sha256(token),
    user: userId,
    expiresAt: new Date(now.getTime() + ttlMs()),
    lastSeenAt: now,
    userAgent: userAgent.slice(0, 200),
  });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  if (req.sessionId) {
    await Session.deleteOne({ _id: req.sessionId });
    disconnectSession(String(req.sessionId));
  }
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
}

/** Resolve a raw session token to its user. Shared by HTTP and Socket.IO authentication. */
export async function resolveSession(token: string | undefined) {
  if (!token || token.length > 100) return null;
  const session = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } }).lean();
  if (!session) return null;
  const user = await User.findById(session.user).lean<AuthUser>();
  if (!user) return null;
  return { session, user };
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export async function loadSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return next();
  const resolved = await resolveSession(token);
  if (!resolved) {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    return next();
  }
  req.user = resolved.user;
  req.sessionId = resolved.session._id;
  // Sliding expiry, refreshed at most hourly to avoid a write per request.
  if (Date.now() - resolved.session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    const now = new Date();
    await Session.updateOne({ _id: resolved.session._id }, { lastSeenAt: now, expiresAt: new Date(now.getTime() + ttlMs()) });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}
