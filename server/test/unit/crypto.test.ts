import { describe, expect, it } from 'vitest';
import { hashPassword, randomCode, signTicket, verifyPassword, verifyTicketToken } from '../../src/lib/crypto';
import { toCsv } from '../../src/lib/csv';

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct-horse-battery');
    const b = await hashPassword('correct-horse-battery');
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^scrypt\$16384\$8\$5\$/);
    expect(await verifyPassword('correct-horse-battery', a)).toBe(true);
    expect(await verifyPassword('wrong-password', a)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
  });
});

describe('ticket tokens', () => {
  const id = '6ac94119f6033a81b51f9249';
  it('round-trips and carries no personal data', () => {
    const token = signTicket(id);
    expect(token.split('.')).toHaveLength(3);
    expect(verifyTicketToken(token)).toEqual({ ok: true, ticketId: id });
  });
  it('rejects altered ids and signatures', () => {
    const token = signTicket(id);
    expect(verifyTicketToken(token.replace(id, '6ac94119f6033a81b51f9250')).ok).toBe(false);
    expect(verifyTicketToken(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`).ok).toBe(false);
    expect(verifyTicketToken('https://example.com').ok).toBe(false);
    expect(verifyTicketToken('CF1.not-an-id.sig').ok).toBe(false);
  });
});

describe('codes and CSV', () => {
  it('generates unambiguous codes', () => {
    const c = randomCode(200);
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]+$/);
  });
  it('quotes fields and neutralises spreadsheet formulas', () => {
    const csv = toCsv(['a', 'b'], [['=HYPERLINK("x")', 'x,y'], ['line\nbreak', '+1']]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain(`'+1`);
    expect(csv).toContain('"line\nbreak"');
  });
});
