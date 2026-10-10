/**
 * Venue allocation engine — pure functions, no database or UI dependencies.
 *
 * Conflict rule: two bookings of the same venue conflict when their intervals overlap
 * once the venue's turnover buffer is applied between them:
 *
 *     a.start < b.end + buffer  &&  b.start < a.end + buffer
 *
 * so back-to-back bookings need at least `buffer` minutes between them.
 *
 * Selection rule for a single request (deterministic):
 *   1. discard inactive venues, venues that are too small, venues missing a required
 *      facility, venues closed at the requested time, and venues with a conflict
 *   2. rank the rest by best fit — fewest unused seats (as a share of capacity), then
 *      fewest unrequested facilities (keep specialised rooms free), then name
 *
 * Batch planning (`planAllocations`) is greedy: it processes the most constrained request
 * first (fewest eligible venues, then earliest start, then largest attendance) and books
 * the best-fit venue for each. This is a heuristic — it does not guarantee a globally
 * optimal assignment, and may fail to place a request that some other assignment could
 * have placed. Failures are reported with the reason each venue was rejected.
 */

import { formatInZone, parseHHmm, zonedParts } from '@campusflow/shared';

export interface EngineVenue {
  id: string;
  name: string;
  building: string;
  capacity: number;
  facilities: string[];
  availability: { days: number[]; opensAt: string; closesAt: string } | null;
  turnoverMinutes: number;
  active: boolean;
}

export interface EngineBooking {
  id: string;
  venueId: string;
  eventId: string;
  eventTitle: string;
  startsAt: Date;
  endsAt: Date;
}

export interface EngineRequest {
  eventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendance: number;
  facilities: string[];
}

export interface VenueEvaluation {
  venue: EngineVenue;
  eligible: boolean;
  /** Lower is better. Null when ineligible. */
  score: number | null;
  reasons: string[];
  blockers: string[];
  conflicts: EngineBooking[];
}

export interface Suggestion {
  selected: VenueEvaluation | null;
  candidates: VenueEvaluation[];
  explanation: string;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function intervalsConflict(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
  bufferMinutes: number,
): boolean {
  const buffer = bufferMinutes * 60_000;
  return a.startsAt.getTime() < b.endsAt.getTime() + buffer && b.startsAt.getTime() < a.endsAt.getTime() + buffer;
}

export function findConflicts(request: Pick<EngineRequest, 'eventId' | 'startsAt' | 'endsAt'>, venue: EngineVenue, bookings: EngineBooking[]): EngineBooking[] {
  return bookings.filter(
    (b) => b.venueId === venue.id && b.eventId !== request.eventId && intervalsConflict(request, b, venue.turnoverMinutes),
  );
}

/** Check opening hours in the institution's timezone. Returns a blocker message or null. */
export function availabilityBlocker(request: Pick<EngineRequest, 'startsAt' | 'endsAt'>, venue: EngineVenue, timezone: string): string | null {
  const a = venue.availability;
  if (!a) return null;
  const start = zonedParts(request.startsAt, timezone);
  // Use the last minute of the booking so an event ending exactly at midnight stays on its day.
  const end = zonedParts(new Date(request.endsAt.getTime() - 60_000), timezone);
  const hours = `${a.opensAt}–${a.closesAt} on ${a.days.map((d) => DAY_NAMES[d]).join(', ')}`;
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  if (!sameDay) return `Spans more than one day; venue is only open ${hours}`;
  if (!a.days.includes(start.weekday)) return `Closed on ${DAY_NAMES[start.weekday]} (open ${hours})`;
  const open = parseHHmm(a.opensAt);
  const close = parseHHmm(a.closesAt);
  const endMinutes = zonedParts(request.endsAt, timezone).minutesOfDay || 24 * 60;
  if (start.minutesOfDay < open || endMinutes > close) return `Outside opening hours (${hours})`;
  return null;
}

function describeWindow(b: { startsAt: Date; endsAt: Date }, timezone: string): string {
  return `${formatInZone(b.startsAt, timezone, 'EEE d MMM, HH:mm')}–${formatInZone(b.endsAt, timezone, 'HH:mm')}`;
}

export function evaluateVenue(request: EngineRequest, venue: EngineVenue, bookings: EngineBooking[], timezone: string): VenueEvaluation {
  const blockers: string[] = [];
  const reasons: string[] = [];

  if (!venue.active) blockers.push('Venue is marked inactive');

  if (venue.capacity < request.attendance) {
    blockers.push(`Holds ${venue.capacity}; ${request.attendance} expected`);
  } else {
    const fill = request.attendance > 0 ? Math.round((request.attendance / venue.capacity) * 100) : 0;
    reasons.push(`Seats ${venue.capacity} for ${request.attendance} expected (${fill}% full)`);
  }

  const missing = request.facilities.filter((f) => !venue.facilities.includes(f));
  if (missing.length) blockers.push(`Missing ${missing.map((m) => m.replace(/_/g, ' ')).join(', ')}`);
  else if (request.facilities.length) reasons.push(`Has ${request.facilities.map((f) => f.replace(/_/g, ' ')).join(', ')}`);

  const closed = availabilityBlocker(request, venue, timezone);
  if (closed) blockers.push(closed);

  const conflicts = findConflicts(request, venue, bookings);
  for (const c of conflicts) {
    blockers.push(`Booked for “${c.eventTitle}” ${describeWindow(c, timezone)} (+${venue.turnoverMinutes} min turnover)`);
  }
  if (!conflicts.length && !closed) reasons.push(`Free ${describeWindow(request, timezone)} including ${venue.turnoverMinutes} min turnover`);

  const eligible = blockers.length === 0;
  let score: number | null = null;
  if (eligible) {
    const unusedShare = venue.capacity > 0 ? (venue.capacity - request.attendance) / venue.capacity : 1;
    const extraFacilities = venue.facilities.filter((f) => !request.facilities.includes(f)).length;
    score = Math.round(unusedShare * 1000) + extraFacilities;
  }
  return { venue, eligible, score, reasons, blockers, conflicts };
}

function compareEvaluations(a: VenueEvaluation, b: VenueEvaluation): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.eligible && b.eligible && a.score !== b.score) return (a.score ?? 0) - (b.score ?? 0);
  if (!a.eligible && !b.eligible && a.blockers.length !== b.blockers.length) return a.blockers.length - b.blockers.length;
  return a.venue.name.localeCompare(b.venue.name) || a.venue.id.localeCompare(b.venue.id);
}

export function suggestVenue(request: EngineRequest, venues: EngineVenue[], bookings: EngineBooking[], timezone: string): Suggestion {
  const candidates = venues.map((v) => evaluateVenue(request, v, bookings, timezone)).sort(compareEvaluations);
  const selected = candidates.find((c) => c.eligible) ?? null;
  let explanation: string;
  if (selected) {
    const runnersUp = candidates.filter((c) => c.eligible).length - 1;
    explanation =
      `${selected.venue.name} (${selected.venue.building}) is the closest fit: ${selected.reasons.join('; ')}.` +
      (runnersUp > 0 ? ` ${runnersUp} other room${runnersUp === 1 ? '' : 's'} would also work but leave more seats unused.` : ' No other room meets every requirement.');
  } else if (!venues.length) {
    explanation = 'No venues are configured yet.';
  } else {
    const tally = new Map<string, number>();
    for (const c of candidates) {
      for (const b of c.blockers) {
        const kind = b.startsWith('Holds')
          ? 'too small'
          : b.startsWith('Missing')
            ? 'missing facilities'
            : b.startsWith('Booked')
              ? 'already booked'
              : b.includes('inactive')
                ? 'inactive'
                : 'closed at that time';
        tally.set(kind, (tally.get(kind) ?? 0) + 1);
      }
    }
    explanation =
      `No venue satisfies every requirement for ${request.attendance} people. ` +
      [...tally.entries()].map(([k, n]) => `${n} ${n === 1 ? 'is' : 'are'} ${k}`).join(', ') +
      '. Consider a smaller expected attendance, fewer required facilities, or a different time.';
  }
  return { selected, candidates, explanation };
}

export interface PlanResult {
  request: EngineRequest;
  suggestion: Suggestion;
}

export function planAllocations(
  requests: EngineRequest[],
  venues: EngineVenue[],
  existing: EngineBooking[],
  timezone: string,
): PlanResult[] {
  const bookings = [...existing];
  const eligibleCount = (r: EngineRequest) => venues.filter((v) => evaluateVenue(r, v, bookings, timezone).eligible).length;
  const order = [...requests].sort(
    (a, b) =>
      eligibleCount(a) - eligibleCount(b) ||
      a.startsAt.getTime() - b.startsAt.getTime() ||
      b.attendance - a.attendance ||
      a.eventId.localeCompare(b.eventId),
  );
  const results: PlanResult[] = [];
  for (const request of order) {
    const suggestion = suggestVenue(request, venues, bookings, timezone);
    if (suggestion.selected) {
      bookings.push({
        id: `planned:${request.eventId}`,
        venueId: suggestion.selected.venue.id,
        eventId: request.eventId,
        eventTitle: request.title,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
      });
    }
    results.push({ request, suggestion });
  }
  return results;
}
