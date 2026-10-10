import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Load server/.env when present (Node's built-in loader; real environment variables win).
if (process.env.NODE_ENV !== 'test' && existsSync('.env')) process.loadEnvFile('.env');

const DEV_SECRET = 'dev-only-secret-change-me-dev-only-secret-change-me';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/campusflow'),
  /** Comma-separated list of browser origins allowed to call the API with credentials. */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** HMAC key for signing ticket QR payloads. Must be long and private in production. */
  TICKET_SECRET: z.string().min(32).default(DEV_SECRET),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  UPLOAD_DIR: z.string().default('uploads'),
  /**
   * Participant documents and requirement templates. Never served statically: files here are only
   * reachable through authorized API routes. Must not be inside UPLOAD_DIR.
   */
  DOCUMENT_DIR: z.string().default('private-documents'),
  /** Serve the built web client from this directory (production single-process mode). */
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
  process.exit(1);
}

const raw = parsed.data;

{
  const docs = path.resolve(raw.DOCUMENT_DIR);
  const pub = path.resolve(raw.UPLOAD_DIR);
  if (docs === pub || docs.startsWith(pub + path.sep)) {
    console.error('DOCUMENT_DIR must not be inside UPLOAD_DIR: everything under UPLOAD_DIR is publicly served.');
    process.exit(1);
  }
}

if (raw.NODE_ENV === 'production' && raw.TICKET_SECRET === DEV_SECRET) {
  console.error('TICKET_SECRET must be set to a private value of at least 32 characters in production.');
  process.exit(1);
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  cookieSecure: raw.COOKIE_SECURE ?? raw.NODE_ENV === 'production',
  webOrigins: raw.WEB_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
