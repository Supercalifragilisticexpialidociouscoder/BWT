import type { Types } from 'mongoose';
import type { CheckInResultDTO, CheckInRowDTO, LiveStatsDTO } from '@campusflow/shared';
import {
  CheckIn,
  Event,
  Registration,
  Team,
  Ticket,
  User,
  Venue,
  VenueAllocation,
  type ICheckIn,
  type IEvent,
} from '../../models';
import { audit } from '../../lib/audit';
import { verifyTicketToken } from '../../lib/crypto';
import { conflict, isDuplicateKeyError, notFound } from '../../lib/errors';
import { escapeRegex, iso } from '../../lib/http';
import type { AuthUser } from '../../middleware/auth';
import { publish } from '../../realtime/bus';
import { liveParticipation } from '../documents/service';
import { participationBlockMessage } from '../documents/status';

export interface CheckInResponse {
  httpStatus: number;
  body: CheckInResultDTO;
}

const fail = (httpStatus: number, body: CheckInResultDTO): CheckInResponse => ({ httpStatus, body });

export function checkInWindow(event: Pick<IEvent, 'startsAt' | 'endsAt' | 'checkInOpensMinutesBefore'>, now = new Date()) {
  const opensAt = new Date(event.startsAt.getTime() - event.checkInOpensMinutesBefore * 60_000);
  const closesAt = event.endsAt;
  const state = now < opensAt ? 'not_open' : now > closesAt ? 'closed' : 'open';
  return { opensAt, closesAt, state } as const;
}

/**
 * Validate a ticket and record attendance.
 *
 * Concurrency: the CheckIn collection has a partial unique index on {ticket} for active
 * records. Inserting the CheckIn is therefore the single atomic decision point — when two
 * volunteers scan the same ticket simultaneously exactly one insert succeeds and the other
 * receives a duplicate-key error, which is reported as "already checked in". The ticket's
 * status field is a denormalised mirror updated afterwards.
 */
export async function performCheckIn(opts: {
  event: IEvent;
  staff: AuthUser;
  token?: string;
  ticketId?: Types.ObjectId;
}): Promise<CheckInResponse> {
  const { event, staff } = opts;
  const method: 'qr' | 'manual' = opts.token ? 'qr' : 'manual';

  let ticketId: Types.ObjectId | string | undefined = opts.ticketId;
  if (opts.token) {
    const verified = verifyTicketToken(opts.token);
    if (!verified.ok) {
      return fail(404, { outcome: 'invalid', message: 'This code is not a CAMPUSFLOW ticket, or it has been altered.' });
    }
    ticketId = verified.ticketId;
  }
  const ticket = await Ticket.findById(ticketId).lean();
  if (!ticket) return fail(404, { outcome: 'invalid', message: 'No ticket matches this code.' });

  if (String(ticket.event) !== String(event._id)) {
    const other = await Event.findById(ticket.event).select('title status').lean();
    const visible = other && other.status !== 'draft';
    return fail(422, {
      outcome: 'wrong_event',
      message: visible ? `This ticket is for “${other!.title}”.` : 'This ticket belongs to a different event.',
      eventTitle: visible ? other!.title : undefined,
    });
  }

  const [registration, participant, team] = await Promise.all([
    Registration.findById(ticket.registration).lean(),
    User.findById(ticket.user).select('name rollNumber department').lean(),
    ticket.team ? Team.findById(ticket.team).select('name memberCount').lean() : Promise.resolve(null),
  ]);
  const who = participant
    ? { id: String(participant._id), name: participant.name, rollNumber: participant.rollNumber, department: participant.department }
    : undefined;
  const base = {
    participant: who,
    registrationCode: registration?.code,
    ticketShortCode: ticket.shortCode,
    method,
  };

  const existing = await CheckIn.findOne({ ticket: ticket._id, active: true }).lean();
  if (existing) return alreadyCheckedIn(existing, base, team);

  if (event.status !== 'published' && event.status !== 'completed') {
    return fail(422, { ...base, outcome: 'not_eligible', reason: 'event_not_active', message: `This event is ${event.status}.` });
  }
  if (ticket.status === 'void') {
    return fail(422, {
      ...base,
      outcome: 'not_eligible',
      reason: 'ticket_void',
      message: `This ticket was voided${ticket.voidReason ? `: ${ticket.voidReason.toLowerCase()}` : ''}. Ask the participant to open their latest ticket.`,
    });
  }
  if (!registration || registration.status !== 'confirmed') {
    return fail(422, {
      ...base,
      outcome: 'not_eligible',
      reason: 'registration_not_confirmed',
      message: `Registration ${registration?.code ?? ''} is ${registration?.status ?? 'missing'}${registration?.statusReason ? ` — ${registration.statusReason.toLowerCase()}` : ''}.`,
    });
  }
  const window = checkInWindow(event);
  if (window.state !== 'open') {
    return fail(422, {
      ...base,
      outcome: 'not_eligible',
      reason: window.state === 'not_open' ? 'window_not_open' : 'window_closed',
      message: window.state === 'not_open' ? `Check-in opens at ${window.opensAt.toISOString()}.` : 'Check-in for this event has closed.',
    });
  }

  // Only when the event explicitly asks for it. Evaluated from the database at scan time; volunteers
  // learn why entry is refused, never what the documents contain. Runs after the duplicate check above,
  // and the unique-index insert below remains the single decision point for admission.
  if (event.participation?.checkInRequiresApproval) {
    const participation = await liveParticipation(registration, event);
    if (participation.status !== 'approved') {
      return fail(422, { ...base, outcome: 'not_eligible', reason: 'participation_not_approved', message: participationBlockMessage(participation) });
    }
  }

  const at = new Date();
  let record: ICheckIn;
  try {
    record = (
      await CheckIn.create({
        event: event._id,
        ticket: ticket._id,
        registration: ticket.registration,
        user: ticket.user,
        team: ticket.team,
        staff: staff._id,
        method,
        at,
        active: true,
      })
    ).toObject();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const winner = await CheckIn.findOne({ ticket: ticket._id, active: true }).lean();
      if (winner) return alreadyCheckedIn(winner, base, team);
    }
    throw err;
  }
  await Ticket.updateOne({ _id: ticket._id }, { $set: { status: 'checked_in', checkedInAt: at } });

  const arrived = team ? await CheckIn.countDocuments({ event: event._id, team: team._id, active: true }) : 0;
  publish(String(event._id), {
    type: 'checkin.created',
    checkInId: String(record._id),
    at: at.toISOString(),
    participantName: participant?.name ?? 'Participant',
    teamName: team?.name ?? null,
    method,
  });
  return {
    httpStatus: 200,
    body: {
      ...base,
      outcome: 'valid',
      message: `${participant?.name ?? 'Participant'} is checked in.`,
      checkInId: String(record._id),
      checkedInAt: at.toISOString(),
      checkedInBy: { id: String(staff._id), name: staff.name },
      team: team ? { id: String(team._id), name: team.name, arrived, size: team.memberCount } : null,
    },
  };
}

async function alreadyCheckedIn(
  existing: ICheckIn,
  base: Partial<CheckInResultDTO>,
  team: { _id: Types.ObjectId; name: string; memberCount: number } | null,
): Promise<CheckInResponse> {
  const by = existing.staff ? await User.findById(existing.staff).select('name').lean() : null;
  const arrived = team ? await CheckIn.countDocuments({ event: existing.event, team: team._id, active: true }) : 0;
  return fail(409, {
    ...base,
    outcome: 'already_checked_in',
    message: `Already checked in at ${existing.at.toISOString()}${by ? ` by ${by.name}` : ''}.`,
    checkInId: String(existing._id),
    checkedInAt: existing.at.toISOString(),
    checkedInBy: by ? { id: String(by._id), name: by.name } : null,
    team: team ? { id: String(team._id), name: team.name, arrived, size: team.memberCount } : null,
  });
}

/** Authorised correction: deactivate a check-in, keep the record, and restore the ticket. */
export async function voidCheckIn(actor: AuthUser, checkInId: Types.ObjectId, reason: string) {
  const updated = await CheckIn.findOneAndUpdate(
    { _id: checkInId, active: true },
    { $set: { active: false, voidedAt: new Date(), voidedBy: actor._id, voidReason: reason } },
    { new: true },
  ).lean();
  if (!updated) throw conflict('This check-in is already corrected');
  await Ticket.updateOne({ _id: updated.ticket, status: 'checked_in' }, { $set: { status: 'active', checkedInAt: null } });
  const participant = await User.findById(updated.user).select('name').lean();
  await audit({
    actor: actor._id,
    action: 'checkin.voided',
    entityType: 'CheckIn',
    entityId: updated._id,
    event: updated.event,
    summary: `Check-in of ${participant?.name ?? 'participant'} reversed`,
    meta: { reason, originalAt: updated.at, originalStaff: updated.staff ? String(updated.staff) : null },
  });
  publish(String(updated.event), { type: 'checkin.voided', checkInId: String(updated._id) });
  return updated;
}

export async function checkInRows(filter: Record<string, unknown>, limit = 200): Promise<CheckInRowDTO[]> {
  const rows = await CheckIn.find(filter).sort({ at: -1 }).limit(limit).lean();
  const userIds = new Set<string>();
  rows.forEach((r) => {
    userIds.add(String(r.user));
    if (r.staff) userIds.add(String(r.staff));
    if (r.voidedBy) userIds.add(String(r.voidedBy));
  });
  const [users, teams, regs, tickets] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select('name rollNumber').lean(),
    Team.find({ _id: { $in: rows.map((r) => r.team).filter(Boolean) } }).select('name').lean(),
    Registration.find({ _id: { $in: rows.map((r) => r.registration) } }).select('code').lean(),
    Ticket.find({ _id: { $in: rows.map((r) => r.ticket) } }).select('shortCode').lean(),
  ]);
  const u = new Map(users.map((x) => [String(x._id), x]));
  const t = new Map(teams.map((x) => [String(x._id), x]));
  const g = new Map(regs.map((x) => [String(x._id), x]));
  const k = new Map(tickets.map((x) => [String(x._id), x]));
  const ref = (id: Types.ObjectId | null) => (id && u.get(String(id)) ? { id: String(id), name: u.get(String(id))!.name } : null);
  return rows.map((r) => ({
    id: String(r._id),
    at: r.at.toISOString(),
    method: r.method === 'import' ? 'manual' : r.method,
    active: r.active,
    participant: { id: String(r.user), name: u.get(String(r.user))?.name ?? 'Unknown', rollNumber: u.get(String(r.user))?.rollNumber ?? null },
    team: r.team && t.get(String(r.team)) ? { id: String(r.team), name: t.get(String(r.team))!.name } : null,
    registrationCode: g.get(String(r.registration))?.code ?? '',
    ticketShortCode: k.get(String(r.ticket))?.shortCode ?? '',
    staff: ref(r.staff),
    voidedAt: iso(r.voidedAt),
    voidedBy: ref(r.voidedBy),
    voidReason: r.voidReason,
  }));
}

/** Staff lookup for manual entry: ticket code, registration code, name, roll number or email. */
export async function lookupTickets(eventId: Types.ObjectId, q: string) {
  const rx = new RegExp(escapeRegex(q), 'i');
  const compact = q.toUpperCase().replace(/[\s-]/g, '');
  const users = await User.find({ $or: [{ name: rx }, { rollNumber: rx }, { email: rx }] }).select('_id').limit(100).lean();
  const regs = await Registration.find({ event: eventId, $or: [{ code: rx }, { externalId: rx }] }).select('_id').limit(50).lean();
  const teams = await Team.find({ event: eventId, name: rx }).select('_id').limit(50).lean();
  const tickets = await Ticket.find({
    event: eventId,
    $or: [
      { shortCode: compact },
      { user: { $in: users.map((x) => x._id) } },
      { registration: { $in: regs.map((x) => x._id) } },
      { team: { $in: teams.map((x) => x._id) } },
    ],
  })
    .sort({ live: -1, issuedAt: -1 })
    .limit(30)
    .lean();
  const [people, regDocs, teamDocs] = await Promise.all([
    User.find({ _id: { $in: tickets.map((x) => x.user) } }).select('name rollNumber department').lean(),
    Registration.find({ _id: { $in: tickets.map((x) => x.registration) } }).select('code status statusReason').lean(),
    Team.find({ _id: { $in: tickets.map((x) => x.team).filter(Boolean) } }).select('name').lean(),
  ]);
  const p = new Map(people.map((x) => [String(x._id), x]));
  const r = new Map(regDocs.map((x) => [String(x._id), x]));
  const tm = new Map(teamDocs.map((x) => [String(x._id), x]));
  return tickets.map((tk) => ({
    ticketId: String(tk._id),
    shortCode: tk.shortCode,
    status: tk.status,
    checkedInAt: iso(tk.checkedInAt),
    participant: {
      name: p.get(String(tk.user))?.name ?? 'Unknown',
      rollNumber: p.get(String(tk.user))?.rollNumber ?? null,
      department: p.get(String(tk.user))?.department ?? null,
    },
    registration: {
      code: r.get(String(tk.registration))?.code ?? '',
      status: r.get(String(tk.registration))?.status ?? 'cancelled',
      statusReason: r.get(String(tk.registration))?.statusReason ?? '',
    },
    team: tk.team ? (tm.get(String(tk.team))?.name ?? null) : null,
  }));
}

/* ---------------------------------------------------------------- live dashboard */

export async function liveStats(event: IEvent): Promise<LiveStatsDTO> {
  const now = new Date();
  const eventId = event._id;
  const bucketMs = 5 * 60_000;
  const since = new Date(Math.floor((now.getTime() - 2 * 60 * 60_000) / bucketMs) * bucketMs);

  const [expected, confirmed, checkedIn, buckets, last15, recent, allocation] = await Promise.all([
    // Expected = participants holding a live ticket (confirmed registrations).
    Ticket.countDocuments({ event: eventId, live: true }),
    Registration.countDocuments({ event: eventId, status: 'confirmed' }),
    CheckIn.countDocuments({ event: eventId, active: true }),
    CheckIn.aggregate<{ _id: number; count: number }>([
      { $match: { event: eventId, active: true, at: { $gte: since } } },
      { $group: { _id: { $subtract: [{ $toLong: '$at' }, { $mod: [{ $toLong: '$at' }, bucketMs] }] }, count: { $sum: 1 } } },
    ]),
    CheckIn.countDocuments({ event: eventId, active: true, at: { $gte: new Date(now.getTime() - 15 * 60_000) } }),
    checkInRows({ event: eventId }, 25),
    VenueAllocation.findOne({ event: eventId, status: 'confirmed' }).sort({ startsAt: 1 }).lean(),
  ]);

  const counts = new Map(buckets.map((b) => [Number(b._id), b.count]));
  const entryBuckets: LiveStatsDTO['entryBuckets'] = [];
  for (let t = since.getTime(); t <= now.getTime(); t += bucketMs) {
    entryBuckets.push({ at: new Date(t).toISOString(), count: counts.get(t) ?? 0 });
  }

  let teams: LiveStatsDTO['teams'] = null;
  let teamBoard: LiveStatsDTO['teamBoard'] = [];
  if (event.mode === 'team') {
    const confirmedRegs = await Registration.find({ event: eventId, status: 'confirmed' }).select('team').lean();
    const teamIds = confirmedRegs.map((r) => r.team).filter(Boolean) as Types.ObjectId[];
    const [teamDocs, arrivals] = await Promise.all([
      Team.find({ _id: { $in: teamIds } }).select('name memberCount').sort({ name: 1 }).lean(),
      CheckIn.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { event: eventId, active: true, team: { $in: teamIds } } },
        { $group: { _id: '$team', n: { $sum: 1 } } },
      ]),
    ]);
    const arrivedBy = new Map(arrivals.map((a) => [String(a._id), a.n]));
    teamBoard = teamDocs.map((t) => ({ id: String(t._id), name: t.name, size: t.memberCount, arrived: arrivedBy.get(String(t._id)) ?? 0 }));
    teams = {
      total: teamBoard.length,
      arrivedComplete: teamBoard.filter((t) => t.arrived >= t.size && t.size > 0).length,
      arrivedPartial: teamBoard.filter((t) => t.arrived > 0 && t.arrived < t.size).length,
      notArrived: teamBoard.filter((t) => t.arrived === 0).length,
    };
  }

  let venue: LiveStatsDTO['venue'] = null;
  if (allocation) {
    const v = await Venue.findById(allocation.venue).select('name capacity').lean();
    if (v) venue = { name: v.name, capacity: v.capacity, occupancyRate: v.capacity ? checkedIn / v.capacity : 0 };
  }
  const window = checkInWindow(event, now);
  return {
    eventId: String(eventId),
    generatedAt: now.toISOString(),
    expectedParticipants: expected,
    confirmedRegistrations: confirmed,
    checkedIn,
    attendanceRate: expected > 0 ? checkedIn / expected : null,
    teams,
    entryBuckets,
    entriesLast15Min: last15,
    venue,
    recent,
    teamBoard,
    window: { opensAt: window.opensAt.toISOString(), closesAt: window.closesAt.toISOString(), state: window.state },
  };
}

export async function ensureCheckInBelongs(checkInId: Types.ObjectId) {
  const c = await CheckIn.findById(checkInId).lean();
  if (!c) throw notFound('Check-in');
  return c;
}
