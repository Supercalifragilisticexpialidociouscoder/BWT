import { describe, expect, it } from 'vitest';
import { availabilityBlocker, evaluateVenue, intervalsConflict, planAllocations, suggestVenue, type EngineBooking, type EngineVenue } from '../../src/modules/venues/engine';

const TZ = 'Asia/Kolkata';
// 2026-10-12 is a Monday. 10:00 IST = 04:30Z.
const at = (hhmm: string, day = '2026-10-12') => new Date(`${day}T${hhmm}:00+05:30`);

const venue = (over: Partial<EngineVenue>): EngineVenue => ({
  id: over.name ?? 'v',
  name: 'V',
  building: 'B',
  capacity: 50,
  facilities: [],
  availability: null,
  turnoverMinutes: 30,
  active: true,
  ...over,
});

const booking = (venueId: string, start: string, end: string, eventId = 'other'): EngineBooking => ({
  id: `${venueId}-${start}`,
  venueId,
  eventId,
  eventTitle: 'Other event',
  startsAt: at(start),
  endsAt: at(end),
});

describe('intervalsConflict', () => {
  const a = { startsAt: at('10:00'), endsAt: at('12:00') };
  it('detects overlap', () => expect(intervalsConflict(a, { startsAt: at('11:00'), endsAt: at('13:00') }, 0)).toBe(true));
  it('allows back-to-back bookings without a buffer', () => expect(intervalsConflict(a, { startsAt: at('12:00'), endsAt: at('13:00') }, 0)).toBe(false));
  it('rejects back-to-back bookings inside the turnover buffer', () => expect(intervalsConflict(a, { startsAt: at('12:20'), endsAt: at('13:00') }, 30)).toBe(true));
  it('accepts a booking exactly one buffer later', () => expect(intervalsConflict(a, { startsAt: at('12:30'), endsAt: at('13:00') }, 30)).toBe(false));
  it('is symmetric', () => {
    const b = { startsAt: at('08:00'), endsAt: at('09:45') };
    expect(intervalsConflict(a, b, 30)).toBe(intervalsConflict(b, a, 30));
    expect(intervalsConflict(a, b, 30)).toBe(true);
  });
});

describe('availabilityBlocker (institution timezone)', () => {
  const v = venue({ availability: { days: [1, 2, 3, 4, 5], opensAt: '09:00', closesAt: '17:00' } });
  it('accepts a booking inside opening hours', () => expect(availabilityBlocker({ startsAt: at('10:00'), endsAt: at('12:00') }, v, TZ)).toBeNull());
  it('rejects closed days', () => expect(availabilityBlocker({ startsAt: at('10:00', '2026-10-11'), endsAt: at('12:00', '2026-10-11') }, v, TZ)).toMatch(/Closed on Sun/));
  it('rejects bookings outside hours', () => expect(availabilityBlocker({ startsAt: at('16:00'), endsAt: at('18:00') }, v, TZ)).toMatch(/Outside opening hours/));
  it('rejects multi-day bookings', () => expect(availabilityBlocker({ startsAt: at('10:00'), endsAt: at('10:00', '2026-10-13') }, v, TZ)).toMatch(/more than one day/));
  it('evaluates hours in the configured zone, not UTC', () => {
    // 08:30 IST is 03:00Z; a UTC interpretation would be wrong in both directions.
    expect(availabilityBlocker({ startsAt: at('08:30'), endsAt: at('10:00') }, v, TZ)).toMatch(/Outside/);
  });
});

describe('suggestVenue', () => {
  const venues = [
    venue({ id: 'big', name: 'Auditorium', capacity: 500, facilities: ['projector', 'microphones', 'stage'] }),
    venue({ id: 'mid', name: 'Seminar Hall', capacity: 120, facilities: ['projector', 'microphones'] }),
    venue({ id: 'small', name: 'Classroom', capacity: 60, facilities: ['projector'] }),
    venue({ id: 'off', name: 'Closed Lab', capacity: 150, facilities: ['projector', 'microphones'], active: false }),
  ];
  const request = { eventId: 'e1', title: 'Talk', startsAt: at('10:00'), endsAt: at('12:00'), attendance: 100, facilities: ['projector', 'microphones'] };

  it('picks the smallest room that satisfies every requirement and explains why', () => {
    const s = suggestVenue(request, venues, [], TZ);
    expect(s.selected?.venue.id).toBe('mid');
    expect(s.explanation).toMatch(/Seminar Hall/);
    expect(s.explanation).toMatch(/1 other room/);
  });
  it('reports precise blockers for rejected rooms', () => {
    const s = suggestVenue(request, venues, [], TZ);
    const small = s.candidates.find((c) => c.venue.id === 'small')!;
    expect(small.eligible).toBe(false);
    expect(small.blockers.join(' ')).toMatch(/Holds 60; 100 expected/);
    expect(small.blockers.join(' ')).toMatch(/Missing microphones/);
    expect(s.candidates.find((c) => c.venue.id === 'off')!.blockers).toContain('Venue is marked inactive');
  });
  it('skips rooms with a conflicting booking (including turnover)', () => {
    const s = suggestVenue(request, venues, [booking('mid', '12:15', '14:00')], TZ);
    expect(s.selected?.venue.id).toBe('big');
    expect(s.candidates.find((c) => c.venue.id === 'mid')!.blockers[0]).toMatch(/Booked for “Other event”/);
  });
  it('ignores the event’s own existing booking', () => {
    const s = suggestVenue(request, venues, [booking('mid', '10:00', '12:00', 'e1')], TZ);
    expect(s.selected?.venue.id).toBe('mid');
  });
  it('explains when nothing fits', () => {
    const s = suggestVenue({ ...request, attendance: 1000 }, venues, [], TZ);
    expect(s.selected).toBeNull();
    expect(s.explanation).toMatch(/No venue satisfies every requirement/);
    expect(s.explanation).toMatch(/too small/);
  });
  it('is deterministic', () => {
    const a = suggestVenue(request, venues, [], TZ).candidates.map((c) => c.venue.id);
    const b = suggestVenue(request, [...venues].reverse(), [], TZ).candidates.map((c) => c.venue.id);
    expect(a).toEqual(b);
  });
  it('scores a tighter fit better', () => {
    const tight = evaluateVenue({ ...request, facilities: [] }, venue({ id: 't', capacity: 110 }), [], TZ);
    const loose = evaluateVenue({ ...request, facilities: [] }, venue({ id: 'l', capacity: 400 }), [], TZ);
    expect(tight.score!).toBeLessThan(loose.score!);
  });
});

describe('planAllocations (greedy, most-constrained first)', () => {
  it('places the constrained event first so both events get a room', () => {
    const venues = [venue({ id: 'hall', name: 'Hall', capacity: 200, facilities: ['stage'] }), venue({ id: 'room', name: 'Room', capacity: 80 })];
    // "flexible" fits in either room; "stage" fits only in the hall. Processing in input order
    // with best-fit would still work here, so make flexible prefer the hall by attendance.
    const reqs = [
      { eventId: 'flexible', title: 'Flexible', startsAt: at('10:00'), endsAt: at('12:00'), attendance: 70, facilities: [] },
      { eventId: 'stage', title: 'Needs stage', startsAt: at('10:00'), endsAt: at('12:00'), attendance: 150, facilities: ['stage'] },
    ];
    const plan = planAllocations(reqs, venues, [], TZ);
    expect(plan[0]!.request.eventId).toBe('stage');
    const byEvent = Object.fromEntries(plan.map((p) => [p.request.eventId, p.suggestion.selected?.venue.id]));
    expect(byEvent).toEqual({ stage: 'hall', flexible: 'room' });
  });
  it('reports events it could not place', () => {
    const venues = [venue({ id: 'only', capacity: 100 })];
    const reqs = [
      { eventId: 'a', title: 'A', startsAt: at('10:00'), endsAt: at('12:00'), attendance: 50, facilities: [] },
      { eventId: 'b', title: 'B', startsAt: at('11:00'), endsAt: at('13:00'), attendance: 50, facilities: [] },
    ];
    const plan = planAllocations(reqs, venues, [], TZ);
    expect(plan.filter((p) => p.suggestion.selected).length).toBe(1);
    expect(plan.find((p) => !p.suggestion.selected)!.suggestion.explanation).toMatch(/already booked/);
  });
});
