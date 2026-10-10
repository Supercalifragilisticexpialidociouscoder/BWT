import type { Types } from 'mongoose';
import {
  PAYMENT_STATUSES,
  REGISTRATION_STATUSES,
  formatInZone,
  type AttentionItemDTO,
  type OverviewDTO,
  type PaymentStatus,
  type RegistrationStatus,
  type ReportDTO,
} from '@campusflow/shared';
import {
  CheckIn,
  Event,
  PaymentRecord,
  Registration,
  Team,
  TeamMembership,
  Ticket,
  User,
  Venue,
  VenueAllocation,
  type IEvent,
} from '../../models';
import { audit } from '../../lib/audit';
import { badRequest, conflict } from '../../lib/errors';
import { iso } from '../../lib/http';
import { managedEventFilter } from '../../lib/access';
import type { AuthUser } from '../../middleware/auth';
import { getInstitution } from '../institution/service';
import { buildSummaryContext, eventSummaryDTO } from '../events/service';
import { calendar } from '../venues/service';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function buildReport(event: IEvent): Promise<ReportDTO> {
  const inst = await getInstitution();
  const eventId = event._id;
  const now = new Date();

  const [statusAgg, sourceAgg, payAgg, expected, checkedIn, corrections, byDay, allocation] = await Promise.all([
    Registration.aggregate<{ _id: RegistrationStatus; n: number }>([{ $match: { event: eventId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Registration.aggregate<{ _id: 'web' | 'import'; n: number }>([
      { $match: { event: eventId, status: { $nin: ['cancelled', 'rejected'] } } },
      { $group: { _id: '$source', n: { $sum: 1 } } },
    ]),
    PaymentRecord.aggregate<{ _id: PaymentStatus; n: number; amount: number }>([
      { $match: { event: eventId } },
      { $lookup: { from: 'registrations', localField: 'registration', foreignField: '_id', as: 'reg', pipeline: [{ $project: { status: 1 } }] } },
      { $unwind: '$reg' },
      // Payments of closed registrations only matter once money actually moved.
      { $match: { $or: [{ 'reg.status': { $nin: ['cancelled', 'rejected'] } }, { status: { $in: ['verified', 'refunded'] } }] } },
      { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amountDue' } } },
    ]),
    Ticket.countDocuments({ event: eventId, live: true }),
    CheckIn.countDocuments({ event: eventId, active: true }),
    CheckIn.countDocuments({ event: eventId, active: false }),
    Registration.aggregate<{ _id: string; n: number }>([
      { $match: { event: eventId } },
      { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: inst.timezone } }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    VenueAllocation.findOne({ event: eventId, status: 'confirmed' }).lean(),
  ]);

  const byStatus = Object.fromEntries(REGISTRATION_STATUSES.map((s) => [s, 0])) as Record<RegistrationStatus, number>;
  statusAgg.forEach((s) => (byStatus[s._id] = s.n));
  const payments = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s, { count: 0, amount: 0 }])) as ReportDTO['payments']['byStatus'];
  payAgg.forEach((p) => (payments[p._id] = { count: p.n, amount: p.amount }));

  let teams: ReportDTO['teams'] = null;
  let participantsTotal: number;
  if (event.mode === 'team') {
    const activeTeams = await Team.find({ event: eventId, status: 'active' }).select('memberCount').lean();
    teams = {
      total: activeTeams.length,
      complete: activeTeams.filter((t) => t.memberCount >= event.teamSize.min).length,
      incomplete: activeTeams.filter((t) => t.memberCount < event.teamSize.min).length,
    };
    participantsTotal = await TeamMembership.countDocuments({ event: eventId });
  } else {
    participantsTotal = await Registration.countDocuments({ event: eventId, status: { $nin: ['cancelled', 'rejected'] } });
  }

  // Department breakdown of participants holding tickets (confirmed) and of arrivals.
  const ticketUsers = await Ticket.find({ event: eventId, status: { $ne: 'void' } }).select('user status').lean();
  const users = await User.find({ _id: { $in: ticketUsers.map((t) => t.user) } }).select('department').lean();
  const deptByUser = new Map(users.map((u) => [String(u._id), u.department ?? 'Unspecified']));
  const deptMap = new Map<string, { participants: number; checkedIn: number }>();
  for (const t of ticketUsers) {
    const d = deptByUser.get(String(t.user)) ?? 'Unspecified';
    const row = deptMap.get(d) ?? { participants: 0, checkedIn: 0 };
    row.participants++;
    if (t.status === 'checked_in') row.checkedIn++;
    deptMap.set(d, row);
  }

  let venue: ReportDTO['venue'] = null;
  if (allocation) {
    const v = await Venue.findById(allocation.venue).select('name capacity').lean();
    if (v) venue = { name: v.name, capacity: v.capacity, peakUtilization: v.capacity ? checkedIn / v.capacity : 0 };
  }

  const ended = now >= event.endsAt;
  return {
    eventId: String(eventId),
    kind: 'live_snapshot',
    generatedAt: now.toISOString(),
    finalizedAt: iso(event.finalizedAt),
    registrations: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      bySource: { web: sourceAgg.find((s) => s._id === 'web')?.n ?? 0, import: sourceAgg.find((s) => s._id === 'import')?.n ?? 0 },
    },
    teams,
    participants: { total: participantsTotal, confirmed: expected },
    payments: { required: event.fee.amount > 0, byStatus: payments, currency: event.fee.currency },
    attendance: {
      checkedIn,
      expected,
      rate: expected > 0 ? checkedIn / expected : null,
      // No-shows are only meaningful once the event is over.
      noShows: ended ? Math.max(expected - checkedIn, 0) : null,
      corrections,
    },
    venue,
    registrationsByDay: byDay.map((d) => ({ day: d._id, count: d.n })),
    departments: [...deptMap.entries()]
      .map(([department, v]) => ({ department, ...v }))
      .sort((a, b) => b.participants - a.participants),
  };
}

export async function getReport(event: IEvent): Promise<ReportDTO> {
  if (event.finalizedAt && event.finalReport) return event.finalReport as ReportDTO;
  return buildReport(event);
}

export async function finalizeReport(user: AuthUser, eventId: Types.ObjectId) {
  const event = await Event.findById(eventId);
  if (!event) throw badRequest('Event not found');
  if (event.finalizedAt) throw conflict('This report is already finalized');
  if (new Date() < event.endsAt) throw conflict('Reports can be finalized after the event ends');
  if (event.status !== 'published') throw conflict(`A ${event.status} event cannot be finalized`);
  const snapshot = await buildReport(event.toObject());
  const finalizedAt = new Date();
  const finalReport: ReportDTO = { ...snapshot, kind: 'finalized', finalizedAt: finalizedAt.toISOString() };
  const updated = await Event.findOneAndUpdate(
    { _id: eventId, finalizedAt: null },
    { $set: { finalizedAt, finalReport, status: 'completed' } },
    { new: true },
  );
  if (!updated) throw conflict('This report is already finalized');
  await audit({
    actor: user._id,
    action: 'report.finalized',
    entityType: 'Event',
    entityId: event._id,
    event: event._id,
    summary: `Final report recorded: ${snapshot.attendance.checkedIn}/${snapshot.attendance.expected} attended`,
  });
  return finalReport;
}

/* ---------------------------------------------------------------- organizer overview */

export async function overview(user: AuthUser, scopeEvent?: IEvent): Promise<OverviewDTO> {
  const inst = await getInstitution();
  const now = new Date();
  const events = scopeEvent ? [scopeEvent] : await Event.find(managedEventFilter(user)).lean();
  const ids = events.map((e) => e._id);
  const activeRegs = { event: { $in: ids }, status: { $nin: ['cancelled', 'rejected'] } };

  const [regCount, confirmed, teamAgg, participantsTeam, participantsIndividual, awaitingVerification, awaitingReference, checkedIn, activity] =
    await Promise.all([
      Registration.countDocuments(activeRegs),
      Registration.countDocuments({ event: { $in: ids }, status: 'confirmed' }),
      Team.aggregate<{ _id: null; total: number; complete: number }>([
        { $match: { event: { $in: ids }, status: 'active' } },
        { $lookup: { from: 'events', localField: 'event', foreignField: '_id', as: 'ev', pipeline: [{ $project: { 'teamSize.min': 1 } }] } },
        { $unwind: '$ev' },
        { $group: { _id: null, total: { $sum: 1 }, complete: { $sum: { $cond: [{ $gte: ['$memberCount', '$ev.teamSize.min'] }, 1, 0] } } } },
      ]),
      TeamMembership.countDocuments({ event: { $in: ids } }),
      Registration.countDocuments({ ...activeRegs, kind: 'individual' }),
      paymentStageCount(ids, true),
      paymentStageCount(ids, false),
      CheckIn.countDocuments({ event: { $in: ids }, active: true }),
      Registration.aggregate<{ _id: string; n: number }>([
        { $match: { event: { $in: ids }, createdAt: { $gte: new Date(now.getTime() - 30 * DAY_MS) } } },
        { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: inst.timezone } }, n: { $sum: 1 } } },
      ]),
    ]);

  // Fill a contiguous 30-day series so gaps read as zero rather than disappearing.
  const series: OverviewDTO['activity'] = [];
  const counts = new Map(activity.map((a) => [a._id, a.n]));
  for (let i = 29; i >= 0; i--) {
    const day = formatInZone(new Date(now.getTime() - i * DAY_MS), inst.timezone, 'yyyy-MM-dd');
    series.push({ day, registrations: counts.get(day) ?? 0 });
  }

  const upcomingEvents = events
    .filter((e) => e.endsAt >= now && e.status !== 'cancelled')
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 6);
  const ctx = await buildSummaryContext(upcomingEvents);
  const pendingByEvent = await pendingVerificationByEvent(upcomingEvents.map((e) => e._id));
  const upcoming = upcomingEvents.map((e) => ({ ...eventSummaryDTO(e, ctx, now), pendingPayments: pendingByEvent.get(String(e._id)) ?? 0 }));

  return {
    scope: { eventIds: ids.map(String), label: scopeEvent ? scopeEvent.title : 'All events you manage' },
    totals: {
      events: events.length,
      registrations: regCount,
      confirmedRegistrations: confirmed,
      teams: teamAgg[0]?.total ?? 0,
      completeTeams: teamAgg[0]?.complete ?? 0,
      participants: participantsTeam + participantsIndividual,
      paymentsAwaitingVerification: awaitingVerification,
      paymentsAwaitingReference: awaitingReference,
      checkedIn,
    },
    activity: series,
    upcoming,
    attention: await attentionItems(user, events, now),
  };
}

async function paymentStageCount(eventIds: Types.ObjectId[], withReference: boolean): Promise<number> {
  const res = await PaymentRecord.aggregate<{ n: number }>([
    { $match: { event: { $in: eventIds }, status: withReference ? 'pending' : { $in: ['pending', 'rejected'] }, required: true, reference: withReference ? { $ne: null } : null } },
    { $lookup: { from: 'registrations', localField: 'registration', foreignField: '_id', as: 'reg', pipeline: [{ $project: { status: 1 } }] } },
    { $match: { 'reg.status': { $nin: ['cancelled', 'rejected'] } } },
    { $count: 'n' },
  ]);
  return res[0]?.n ?? 0;
}

async function pendingVerificationByEvent(eventIds: Types.ObjectId[]) {
  const rows = await PaymentRecord.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { event: { $in: eventIds }, status: 'pending', required: true, reference: { $ne: null } } },
    { $lookup: { from: 'registrations', localField: 'registration', foreignField: '_id', as: 'reg', pipeline: [{ $project: { status: 1 } }] } },
    { $match: { 'reg.status': { $nin: ['cancelled', 'rejected'] } } },
    { $group: { _id: '$event', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

async function attentionItems(user: AuthUser, events: IEvent[], now: Date): Promise<AttentionItemDTO[]> {
  const items: AttentionItemDTO[] = [];
  const live = events.filter((e) => e.status !== 'cancelled');
  const ids = live.map((e) => e._id);
  const title = new Map(live.map((e) => [String(e._id), e.title]));

  const pending = await pendingVerificationByEvent(ids);
  for (const [eventId, n] of pending) {
    items.push({
      kind: 'payments_awaiting_verification',
      severity: 'high',
      eventId,
      eventTitle: title.get(eventId) ?? '',
      count: n,
      message: `${n} payment${n === 1 ? '' : 's'} awaiting verification`,
      href: `/workspace/payments?event=${eventId}&stage=awaiting_verification`,
    });
  }

  const dupRefs = await PaymentRecord.aggregate<{ _id: { event: Types.ObjectId; key: string }; n: number }>([
    { $match: { event: { $in: ids }, referenceKey: { $ne: null } } },
    { $group: { _id: { event: '$event', key: '$referenceKey' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  const dupByEvent = new Map<string, number>();
  dupRefs.forEach((d) => dupByEvent.set(String(d._id.event), (dupByEvent.get(String(d._id.event)) ?? 0) + 1));
  for (const [eventId, n] of dupByEvent) {
    items.push({
      kind: 'duplicate_payment_reference',
      severity: 'high',
      eventId,
      eventTitle: title.get(eventId) ?? '',
      count: n,
      message: `${n} payment reference${n === 1 ? ' is' : 's are'} quoted by more than one registration`,
      href: `/workspace/payments?event=${eventId}`,
    });
  }

  const approvalEvents = live.filter((e) => e.requiresApproval).map((e) => e._id);
  if (approvalEvents.length) {
    const rows = await Registration.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { event: { $in: approvalEvents }, status: 'pending', statusReason: 'Awaiting organizer approval' } },
      { $group: { _id: '$event', n: { $sum: 1 } } },
    ]);
    rows.forEach((r) =>
      items.push({
        kind: 'pending_approvals',
        severity: 'medium',
        eventId: String(r._id),
        eventTitle: title.get(String(r._id)) ?? '',
        count: r.n,
        message: `${r.n} registration${r.n === 1 ? '' : 's'} awaiting your approval`,
        href: `/workspace/registrations?event=${r._id}&status=pending`,
      }),
    );
  }

  const soon = live.filter((e) => e.mode === 'team' && e.registrationDeadline > now && e.registrationDeadline.getTime() - now.getTime() < 3 * DAY_MS);
  if (soon.length) {
    const rows = await Registration.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { event: { $in: soon.map((e) => e._id) }, status: 'incomplete' } },
      { $group: { _id: '$event', n: { $sum: 1 } } },
    ]);
    rows.forEach((r) =>
      items.push({
        kind: 'incomplete_teams_near_deadline',
        severity: 'medium',
        eventId: String(r._id),
        eventTitle: title.get(String(r._id)) ?? '',
        count: r.n,
        message: `${r.n} team${r.n === 1 ? '' : 's'} still incomplete with the deadline under 3 days away`,
        href: `/workspace/teams?event=${r._id}&filter=incomplete`,
      }),
    );
  }

  const upcomingPublished = live.filter((e) => e.status === 'published' && e.endsAt > now);
  if (upcomingPublished.length) {
    const booked = await VenueAllocation.distinct('event', { event: { $in: upcomingPublished.map((e) => e._id) }, status: 'confirmed' });
    const bookedSet = new Set(booked.map(String));
    for (const e of upcomingPublished.filter((x) => !bookedSet.has(String(x._id)))) {
      items.push({
        kind: 'no_venue',
        severity: e.startsAt.getTime() - now.getTime() < 7 * DAY_MS ? 'high' : 'medium',
        eventId: String(e._id),
        eventTitle: e.title,
        count: 1,
        message: 'Published without a confirmed venue',
        href: `/workspace/events/${e._id}?tab=venue`,
      });
    }
    const horizon = new Date(now.getTime() + 120 * DAY_MS);
    const entries = await calendar(user, now, horizon);
    for (const entry of entries.filter((x) => x.manageable && x.conflicts.length)) {
      items.push({
        kind: 'venue_conflict',
        severity: 'high',
        eventId: entry.id,
        eventTitle: entry.title,
        count: entry.conflicts.length,
        message: `Venue clash: ${entry.conflicts.map((c) => `${c.venueName} with “${c.withEventTitle}”`).join('; ')}`,
        href: `/workspace/events/${entry.id}?tab=venue`,
      });
    }
  }

  for (const e of live.filter((x) => x.status === 'published' && x.endsAt > now && x.registrationDeadline > now && (!x.registrationOpensAt || x.registrationOpensAt <= now))) {
    const unit = e.mode === 'team' ? 'teams' : 'places';
    if (e.capacity && e.counters.activeRegistrations / e.capacity >= 0.85) {
      const full = e.counters.activeRegistrations >= e.capacity;
      items.push({
        kind: 'near_capacity',
        severity: full ? 'low' : 'medium',
        eventId: String(e._id),
        eventTitle: e.title,
        count: e.counters.activeRegistrations,
        message: full ? `Full — all ${e.capacity} ${unit} taken` : `${e.counters.activeRegistrations} of ${e.capacity} ${unit} taken`,
        href: `/workspace/registrations?event=${e._id}`,
      });
    }
    const hoursLeft = (e.registrationDeadline.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft < 48) {
      items.push({
        kind: 'deadline_soon',
        severity: 'low',
        eventId: String(e._id),
        eventTitle: e.title,
        count: Math.max(1, Math.round(hoursLeft)),
        message: `Registration closes in ${hoursLeft < 1 ? 'under an hour' : `${Math.round(hoursLeft)} h`}`,
        href: `/workspace/events/${e._id}?tab=registration`,
      });
    }
  }
  for (const e of live.filter((x) => x.status === 'draft' && x.startsAt.getTime() - now.getTime() < 3 * DAY_MS)) {
    items.push({
      kind: 'stale_draft',
      severity: 'low',
      eventId: String(e._id),
      eventTitle: e.title,
      count: 1,
      message: e.startsAt < now ? 'Draft whose start date has passed' : 'Still a draft, starting within 3 days',
      href: `/workspace/events/${e._id}`,
    });
  }
  for (const e of live.filter((x) => x.status === 'published' && x.endsAt < now && !x.finalizedAt)) {
    items.push({
      kind: 'unfinalized_report',
      severity: 'low',
      eventId: String(e._id),
      eventTitle: e.title,
      count: 1,
      message: 'Event has ended — finalize its report',
      href: `/workspace/reports?event=${e._id}`,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
}
