import { describe, expect, it } from 'vitest';
import { formatInZone, isValidTimeZone, utcToZonedInput, zonedInputToUtc, zonedParts } from '../src/time';
import { EventInputSchema } from '../src/schemas';

describe('timezone helpers', () => {
  it('converts wall-clock input in a zone to UTC and back', () => {
    const utc = zonedInputToUtc('2026-10-12T10:00', 'Asia/Kolkata');
    expect(utc.toISOString()).toBe('2026-10-12T04:30:00.000Z');
    expect(utcToZonedInput(utc, 'Asia/Kolkata')).toBe('2026-10-12T10:00');
  });
  it('handles daylight saving zones', () => {
    // New York switches to EDT on 2026-03-08.
    expect(zonedInputToUtc('2026-03-07T12:00', 'America/New_York').toISOString()).toBe('2026-03-07T17:00:00.000Z');
    expect(zonedInputToUtc('2026-03-09T12:00', 'America/New_York').toISOString()).toBe('2026-03-09T16:00:00.000Z');
  });
  it('computes local date boundaries in the zone, not UTC', () => {
    const lateEvening = new Date('2026-10-12T19:00:00Z'); // 00:30 on the 13th in IST
    expect(zonedParts(lateEvening, 'Asia/Kolkata')).toMatchObject({ day: 13, hours: 0, minutes: 30, weekday: 2 });
    expect(formatInZone(lateEvening, 'UTC', 'yyyy-MM-dd')).toBe('2026-10-12');
  });
  it('validates IANA names', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('EventInputSchema', () => {
  const base = {
    title: 'Event',
    organization: '6ac94119f6033a81b51f9249',
    category: 'workshop',
    summary: 'A useful summary line',
    startsAt: '2026-10-12T04:30:00.000Z',
    endsAt: '2026-10-12T08:30:00.000Z',
    registrationDeadline: '2026-10-11T14:30:00.000Z',
    mode: 'team',
    teamSize: { min: 2, max: 4 },
    capacity: 20,
    fee: { amount: 0 },
  };
  it('accepts a valid event', () => expect(EventInputSchema.safeParse(base).success).toBe(true));
  it('rejects an end before the start, with a field path', () => {
    const r = EventInputSchema.safeParse({ ...base, endsAt: '2026-10-12T03:00:00.000Z' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path.join('.') === 'endsAt')).toBe(true);
  });
  it('rejects inverted team sizes and schedule items outside the event', () => {
    const r = EventInputSchema.safeParse({ ...base, teamSize: { min: 5, max: 3 }, schedule: [{ title: 'Late', startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T10:00:00.000Z' }] });
    const paths = r.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('teamSize.min');
    expect(paths).toContain('schedule.0.startsAt');
  });
});
