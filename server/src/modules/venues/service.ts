import { Types, type HydratedDocument } from 'mongoose';
import type {
  AllocationSuggestionDTO,
  AllocationStatus,
  CalendarEntryDTO,
  VenueCandidateDTO,
  VenueInput,
} from '@campusflow/shared';
import { Event, Organization, Ticket, Venue, VenueAllocation, type IEvent, type IVenue } from '../../models';
import { audit } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import { eventAccess, managedEventFilter } from '../../lib/access';
import type { AuthUser } from '../../middleware/auth';
import { getInstitution } from '../institution/service';
import {
  availabilityBlocker,
  findConflicts,
  intervalsConflict,
  planAllocations,
  suggestVenue,
  type EngineBooking,
  type EngineRequest,
  type EngineVenue,
  type VenueEvaluation,
} from './engine';

const MAX_BUFFER_MS = 240 * 60_000;

export function venueDTO(v: IVenue) {
  return {
    id: String(v._id),
    name: v.name,
    building: v.building,
    roomCode: v.roomCode,
    kind: v.kind,
    capacity: v.capacity,
    facilities: v.facilities,
    accessibility: { stepFree: v.accessibility?.stepFree ?? false, notes: v.accessibility?.notes ?? '' },
    availability: v.availability ? { days: v.availability.days, opensAt: v.availability.opensAt, closesAt: v.availability.closesAt } : null,
    turnoverMinutes: v.turnoverMinutes,
    active: v.active,
    isDemo: v.isDemo,
  };
}
export type VenueDTO = ReturnType<typeof venueDTO>;

export function toEngineVenue(v: IVenue): EngineVenue {
  return {
    id: String(v._id),
    name: v.name,
    building: v.building,
    capacity: v.capacity,
    facilities: v.facilities,
    availability: v.availability ?? null,
    turnoverMinutes: v.turnoverMinutes,
    active: v.active,
  };
}

function candidateDTO(c: VenueEvaluation, venues: Map<string, IVenue>): VenueCandidateDTO {
  const v = venues.get(c.venue.id)!;
  return {
    venue: { id: c.venue.id, name: v.name, building: v.building, roomCode: v.roomCode, capacity: v.capacity, facilities: v.facilities },
    eligible: c.eligible,
    score: c.score,
    reasons: c.reasons,
    blockers: c.blockers,
  };
}

/** Bookings that overlap [from, to] (widened by the maximum turnover buffer), excluding cancelled events. */
export async function loadBookings(from: Date, to: Date, venueIds?: Types.ObjectId[]): Promise<EngineBooking[]> {
  const allocs = await VenueAllocation.find({
    ...(venueIds ? { venue: { $in: venueIds } } : {}),
    startsAt: { $lt: new Date(to.getTime() + MAX_BUFFER_MS) },
    endsAt: { $gt: new Date(from.getTime() - MAX_BUFFER_MS) },
  }).lean();
  const events = await Event.find({ _id: { $in: allocs.map((a) => a.event) } }).select('title status').lean();
  const byId = new Map(events.map((e) => [String(e._id), e]));
  return allocs
    .filter((a) => byId.get(String(a.event))?.status !== 'cancelled')
    .map((a) => ({
      id: String(a._id),
      venueId: String(a.venue),
      eventId: String(a.event),
      eventTitle: byId.get(String(a.event))?.title ?? 'Unknown event',
      startsAt: a.startsAt,
      endsAt: a.endsAt,
    }));
}

async function expectedAttendance(event: Pick<IEvent, '_id' | 'expectedAttendance' | 'capacity' | 'mode' | 'teamSize'>): Promise<number> {
  if (event.expectedAttendance) return event.expectedAttendance;
  if (event.capacity) return event.capacity * (event.mode === 'team' ? event.teamSize.max : 1);
  const live = await Ticket.countDocuments({ event: event._id, live: true });
  return Math.max(live, 1);
}

export async function requestFor(
  event: IEvent,
  overrides: { expectedAttendance?: number; requiredFacilities?: string[] } = {},
): Promise<EngineRequest> {
  return {
    eventId: String(event._id),
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    attendance: overrides.expectedAttendance ?? (await expectedAttendance(event)),
    facilities: overrides.requiredFacilities ?? event.requiredFacilities,
  };
}

export async function suggestForEvent(
  event: IEvent,
  overrides: { expectedAttendance?: number; requiredFacilities?: string[] } = {},
): Promise<AllocationSuggestionDTO> {
  const inst = await getInstitution();
  const [venues, request] = await Promise.all([Venue.find({ institution: inst._id }).lean(), requestFor(event, overrides)]);
  const bookings = await loadBookings(event.startsAt, event.endsAt);
  const result = suggestVenue(request, venues.map(toEngineVenue), bookings, inst.timezone);
  const vmap = new Map(venues.map((v) => [String(v._id), v]));
  return {
    eventId: String(event._id),
    required: {
      attendance: request.attendance,
      facilities: request.facilities,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
    },
    selected: result.selected ? candidateDTO(result.selected, vmap) : null,
    explanation: result.explanation,
    candidates: result.candidates.map((c) => candidateDTO(c, vmap)),
  };
}

/**
 * Book a venue for an event without double-booking under concurrency.
 *
 * Protocol (optimistic, per venue):
 *   1. read the venue's bookingVersion, then read overlapping bookings and check conflicts
 *   2. write our allocation
 *   3. bump bookingVersion only if it is still the value read in step 1
 *   4. if the bump fails another booking committed meanwhile: undo step 2 and retry
 * Because every writer inserts before bumping, a writer that wins step 3 has either seen
 * every competing allocation in step 1 or forced the competitor to retry and see its own.
 */
export async function bookVenue(opts: {
  event: Pick<IEvent, '_id' | 'title' | 'status'>;
  venueId: Types.ObjectId;
  startsAt: Date;
  endsAt: Date;
  status: AllocationStatus;
  actor: Types.ObjectId | null;
  reason: string;
}): Promise<{ allocationId: Types.ObjectId; warnings: string[] }> {
  const inst = await getInstitution();
  for (let attempt = 0; attempt < 6; attempt++) {
    const venue = await Venue.findById(opts.venueId).lean();
    if (!venue) throw notFound('Venue');
    if (!venue.active) throw conflict(`${venue.name} is marked inactive`);
    const bookings = await loadBookings(opts.startsAt, opts.endsAt, [venue._id]);
    const ev = toEngineVenue(venue);
    const request = { eventId: String(opts.event._id), startsAt: opts.startsAt, endsAt: opts.endsAt };
    const clashes = findConflicts(request, ev, bookings);
    if (clashes.length) {
      throw conflict(
        `${venue.name} is already booked for ${clashes.map((c) => `“${c.eventTitle}”`).join(', ')} within the ${venue.turnoverMinutes}-minute turnover window`,
        { conflicts: clashes.map((c) => ({ eventId: c.eventId, eventTitle: c.eventTitle, startsAt: c.startsAt, endsAt: c.endsAt })) },
        'venue_conflict',
      );
    }
    const closed = availabilityBlocker(request, ev, inst.timezone);
    if (closed) throw conflict(`${venue.name}: ${closed}`, undefined, 'venue_unavailable');

    const previous = await VenueAllocation.findOne({ event: opts.event._id, venue: venue._id }).lean();
    const saved = await VenueAllocation.findOneAndUpdate(
      { event: opts.event._id, venue: venue._id },
      {
        $set: { startsAt: opts.startsAt, endsAt: opts.endsAt, status: opts.status, reason: opts.reason, allocatedBy: opts.actor },
      },
      { upsert: true, new: true },
    );
    const bumped = await Venue.updateOne(
      { _id: venue._id, bookingVersion: venue.bookingVersion },
      { $inc: { bookingVersion: 1 } },
    );
    if (bumped.modifiedCount === 1) {
      const warnings: string[] = [];
      const attendance = await expectedAttendance((await Event.findById(opts.event._id).lean())!);
      if (venue.capacity < attendance) warnings.push(`${venue.name} holds ${venue.capacity}, fewer than the ${attendance} expected`);
      return { allocationId: saved._id, warnings };
    }
    // Lost the race: roll back our write and try again with fresh state.
    if (previous) {
      await VenueAllocation.updateOne(
        { _id: previous._id },
        { $set: { startsAt: previous.startsAt, endsAt: previous.endsAt, status: previous.status, reason: previous.reason } },
      );
    } else {
      await VenueAllocation.deleteOne({ _id: saved._id });
    }
  }
  throw new AppError(409, 'venue_busy', 'The venue is being booked by someone else right now. Try again.');
}

/** Move an event's bookings to a new time window, re-checking conflicts for each venue. */
export async function shiftEventAllocations(event: IEvent, startsAt: Date, endsAt: Date, actor: Types.ObjectId) {
  const allocs = await VenueAllocation.find({ event: event._id }).lean();
  for (const a of allocs) {
    await bookVenue({ event, venueId: a.venue, startsAt, endsAt, status: a.status, actor, reason: a.reason });
  }
}

export async function allocateManually(user: AuthUser, event: HydratedDocument<IEvent>, venueId: Types.ObjectId, status: AllocationStatus) {
  if (event.status === 'cancelled') throw conflict('Cancelled events cannot book venues');
  const venue = await Venue.findById(venueId).lean();
  if (!venue) throw notFound('Venue');
  const result = await bookVenue({
    event,
    venueId,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    status,
    actor: user._id,
    reason: 'Assigned manually by an organizer',
  });
  await audit({
    actor: user._id,
    action: 'venue.allocated',
    entityType: 'VenueAllocation',
    entityId: result.allocationId,
    event: event._id,
    summary: `${status === 'confirmed' ? 'Booked' : 'Proposed'} ${venue.name} for “${event.title}”`,
  });
  return result;
}

export async function planForEvents(user: AuthUser, events: IEvent[]) {
  const inst = await getInstitution();
  const venues = await Venue.find({ institution: inst._id }).lean();
  const from = new Date(Math.min(...events.map((e) => e.startsAt.getTime())));
  const to = new Date(Math.max(...events.map((e) => e.endsAt.getTime())));
  const planIds = new Set(events.map((e) => String(e._id)));
  // Existing bookings of the events being planned are replaced by the plan.
  const bookings = (await loadBookings(from, to)).filter((b) => !planIds.has(b.eventId));
  const requests = await Promise.all(events.map((e) => requestFor(e)));
  const plan = planAllocations(requests, venues.map(toEngineVenue), bookings, inst.timezone);
  const vmap = new Map(venues.map((v) => [String(v._id), v]));
  const out: { eventId: string; title: string; proposal: VenueCandidateDTO | null; explanation: string; error?: string }[] = [];
  for (const r of plan) {
    const event = events.find((e) => String(e._id) === r.request.eventId)!;
    let error: string | undefined;
    if (r.suggestion.selected) {
      try {
        await VenueAllocation.deleteMany({ event: event._id, status: 'proposed' });
        await bookVenue({
          event,
          venueId: new Types.ObjectId(r.suggestion.selected.venue.id),
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          status: 'proposed',
          actor: user._id,
          reason: r.suggestion.explanation,
        });
      } catch (err) {
        error = err instanceof AppError ? err.message : 'Could not save proposal';
      }
    }
    out.push({
      eventId: r.request.eventId,
      title: event.title,
      proposal: r.suggestion.selected && !error ? candidateDTO(r.suggestion.selected, vmap) : null,
      explanation: r.suggestion.explanation,
      error,
    });
  }
  await audit({
    actor: user._id,
    action: 'venue.plan_generated',
    entityType: 'Institution',
    entityId: inst._id,
    summary: `Generated venue proposals for ${events.length} event${events.length === 1 ? '' : 's'}`,
    meta: { placed: out.filter((o) => o.proposal).length },
  });
  return out;
}

/* ---------------------------------------------------------------- calendar */

export async function calendar(user: AuthUser | undefined, from: Date, to: Date, venueId?: Types.ObjectId): Promise<CalendarEntryDTO[]> {
  const visibility = user ? { $or: [{ status: { $in: ['published', 'completed'] } }, managedEventFilter(user)] } : { status: { $in: ['published', 'completed'] } };
  const events = await Event.find({ startsAt: { $lt: to }, endsAt: { $gt: from }, status: { $ne: 'cancelled' }, ...visibility })
    .sort({ startsAt: 1 })
    .limit(500)
    .lean();
  const allocs = await VenueAllocation.find({ event: { $in: events.map((e) => e._id) }, ...(venueId ? { venue: venueId } : {}) }).lean();
  const venues = await Venue.find({ _id: { $in: allocs.map((a) => a.venue) } }).lean();
  const vmap = new Map(venues.map((v) => [String(v._id), v]));
  const orgs = await Organization.find({ _id: { $in: events.map((e) => e.organization) } }).select('name').lean();
  const omap = new Map(orgs.map((o) => [String(o._id), o.name]));
  const titleById = new Map(events.map((e) => [String(e._id), e.title]));

  // Pairwise conflict detection per venue (sorted sweep keeps it near-linear in practice).
  const conflictsByEvent = new Map<string, CalendarEntryDTO['conflicts']>();
  const byVenue = new Map<string, typeof allocs>();
  for (const a of allocs) {
    const list = byVenue.get(String(a.venue)) ?? [];
    list.push(a);
    byVenue.set(String(a.venue), list);
  }
  for (const [vid, list] of byVenue) {
    const venue = vmap.get(vid);
    const buffer = venue?.turnoverMinutes ?? 0;
    list.sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (b.startsAt.getTime() >= a.endsAt.getTime() + buffer * 60_000) break;
        if (String(a.event) === String(b.event)) continue;
        if (intervalsConflict(a, b, buffer)) {
          for (const [x, y] of [
            [a, b],
            [b, a],
          ] as const) {
            const list2 = conflictsByEvent.get(String(x.event)) ?? [];
            list2.push({
              allocationId: String(x._id),
              withEventId: String(y.event),
              withEventTitle: titleById.get(String(y.event)) ?? 'Another event',
              venueName: venue?.name ?? 'Venue',
            });
            conflictsByEvent.set(String(x.event), list2);
          }
        }
      }
    }
  }

  return events
    .filter((e) => !venueId || allocs.some((a) => String(a.event) === String(e._id)))
    .map((e) => ({
      id: String(e._id),
      title: e.title,
      slug: e.slug,
      category: e.category,
      status: e.status,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      organization: omap.get(String(e.organization)) ?? '',
      isDemo: e.isDemo,
      manageable: eventAccess(user, e).canManage,
      allocations: allocs
        .filter((a) => String(a.event) === String(e._id))
        .map((a) => ({
          id: String(a._id),
          venueId: String(a.venue),
          venueName: vmap.get(String(a.venue))?.name ?? 'Venue',
          status: a.status,
          startsAt: a.startsAt.toISOString(),
          endsAt: a.endsAt.toISOString(),
        })),
      conflicts: conflictsByEvent.get(String(e._id)) ?? [],
    }));
}

/* ---------------------------------------------------------------- venue CRUD */

export async function createVenue(user: AuthUser, input: VenueInput & { availability: IVenue['availability'] }) {
  const inst = await getInstitution();
  const venue = await Venue.create({ ...input, institution: inst._id });
  await audit({ actor: user._id, action: 'venue.created', entityType: 'Venue', entityId: venue._id, summary: `Added venue ${venue.name}` });
  return venue;
}

export async function updateVenue(user: AuthUser, venue: HydratedDocument<IVenue>, input: Partial<IVenue>) {
  venue.set(input);
  await venue.save();
  await audit({ actor: user._id, action: 'venue.updated', entityType: 'Venue', entityId: venue._id, summary: `Updated venue ${venue.name}` });
  return venue;
}
