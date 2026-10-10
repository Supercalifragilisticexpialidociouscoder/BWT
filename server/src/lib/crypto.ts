import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/* ---------------------------------------------------------------- passwords
 * scrypt with N=2^14, r=8, p=5 — one of the OWASP-recommended parameter sets
 * (16 MiB memory). Stored as `scrypt$N$r$p$saltB64$hashB64`.
 */
const SCRYPT = { N: 2 ** 14, r: 8, p: 5, keyLen: 64 };

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLen);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Spend comparable time so missing accounts are not distinguishable by latency.
    await scryptAsync(password, randomBytes(16), SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLen);
    return false;
  }
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---------------------------------------------------------------- opaque tokens */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/* ---------------------------------------------------------------- human codes
 * Crockford-like alphabet without 0/O/1/I to avoid misreads when codes are typed.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function formatTeamCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/* ---------------------------------------------------------------- ticket tokens
 * QR payload: `CF1.<ticketId>.<signature>` where signature = HMAC-SHA256(secret, "ticket:<id>")
 * truncated to 128 bits. The payload carries no personal data; the backend resolves
 * everything else. Forged or altered payloads fail signature verification.
 */
const TICKET_PREFIX = 'CF1';

function ticketSignature(ticketId: string): string {
  return createHmac('sha256', env.TICKET_SECRET).update(`ticket:${ticketId}`).digest().subarray(0, 16).toString('base64url');
}

export function signTicket(ticketId: string): string {
  return `${TICKET_PREFIX}.${ticketId}.${ticketSignature(ticketId)}`;
}

export function verifyTicketToken(token: string): { ok: true; ticketId: string } | { ok: false } {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TICKET_PREFIX) return { ok: false };
  const [, ticketId, sig] = parts as [string, string, string];
  if (!/^[a-f0-9]{24}$/.test(ticketId)) return { ok: false };
  const expected = Buffer.from(ticketSignature(ticketId));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false };
  return { ok: true, ticketId };
}
