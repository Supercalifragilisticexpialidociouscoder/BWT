import type { Request } from 'express';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { AppError, notFound, unauthorized } from './errors';
import type { AuthUser } from '../middleware/auth';

export function issuesToFields(issues: z.core.$ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

/** Validate untrusted input against a schema; throws a 400 with per-field messages. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: issuesToFields(result.error.issues) });
  }
  return result.data;
}

/** Parse a route parameter as an ObjectId; malformed ids are reported as not found. */
export function oid(value: unknown, what = 'Resource'): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value) || !/^[a-f0-9]{24}$/i.test(value)) throw notFound(what);
  return new Types.ObjectId(value);
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
