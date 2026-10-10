import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must carry a
 * custom header. Browsers cannot attach custom headers cross-origin without a CORS
 * preflight, which the CORS allowlist rejects for foreign origins.
 */
export function requireClientHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('x-requested-with') !== 'campusflow') {
    return next(new AppError(403, 'csrf_rejected', 'Request rejected: missing client header'));
  }
  next();
}

const skipInTest = () => env.isTest;

const handler = (_req: Request, _res: Response, next: NextFunction) =>
  next(new AppError(429, 'rate_limited', 'Too many requests — wait a moment and try again'));

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
  handler,
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 900,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
  handler,
});

/** Scanning is bursty at the gate; limit per signed-in volunteer rather than per IP. */
export const checkInLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
  // Per volunteer when signed in; otherwise per IP, with IPv6 addresses grouped by subnet.
  keyGenerator: (req) => (req.user ? `u:${String(req.user._id)}` : `ip:${ipKeyGenerator(req.ip ?? '')}`),
  handler,
});
