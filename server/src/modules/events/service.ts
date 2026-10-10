import type { HydratedDocument, Types } from 'mongoose';
import {
  type AllocationDTO,
  type EventDetailDTO,
  type EventInputParsed,
  type EventStatus,
  type EventSummaryDTO,
  type RegistrationWindowState,
  type StaffMemberDTO,
} from '@campusflow/shared';
import {
  Event,
  Organization,
  PaymentRecord,
  Registration,
  Team,
  TeamMembership,
  User,
  Venue,
  VenueAllocation,
  type IEvent,
  type IInstitution,
  type IOrganization,
  type IVenue,
  type IVenueAllocation,
} from '../../models';
import { audit } from '../../lib/audit';
import { randomCode } from '../../lib/crypto';
import { AppError, badRequest, conflict, forbidden } from '../../lib/errors';
import { iso } from '../../lib/http';
import { eventAccess, type EventAccess } from '../../lib/access';
import type { AuthUser } from '../../middleware/auth';
import { categoryName, getInstitution } from '../institution/service';
import { shiftEventAllocations } from '../venues/service';
import { recomputeEventRegistrations } from '../registrations/service';
import { requirementDTO } from '../documents/dto';

/* ---------------------------------------------------------------- helpers */

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'event'
  );
}

async function uniqueSlug(title: string, excludeId?: Types.ObjectId): Promise<string> {
  const base = slugify(title);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await Event.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (!clash) return candidate;
  }
  return `${base}-${randomCode(4).toLowerCase()}`;
}

async function uniqueCodePrefix(title: string): Promise<string> {
  const initials =
    title
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase())
      .join('')
      .slice(0, 3) || 'EV';
  for (let i = 0; i < 20; i++) {
    const candidate = `${initials}${randomCode(2)}`;
    if (!(await Event.exists({ codePrefix: candidate }))) return candidate;
  }
  return `${initials}${randomCode(4)}`;
}

export function registrationState(e: Pick<IEvent, 'status' | 'endsAt' | 'registrationOpensAt' | 'registrationDeadline' | 'capacity' | 'counters'>, now = new Date()): RegistrationWindowState {
  if (e.status === 'draft') return 'draft';
  if (e.status === 'cancelled') return 'cancelled';
  if (e.status === 'completed' || now >= e.endsAt) return 'ended';
  if (e.registrationOpensAt && now < e.registrationOpensAt) return 'not_yet_open';
  if (now > e.registrationDeadline) return 'closed';
  if (e.capacity != null && e.counters.activeRegistrations >= e.capacity) return 'full';
  return 'open';
}

export function coverUrl(e: Pick<IEvent, 'coverPath' | 'updatedAt'>): string | null {
  return e.coverPath ? `/uploads/${e.coverPath}?v=${new Date(e.updatedAt).getTime()}` : null;
}

/* ---------------------------------------------------------------- serialisation */

export interface SummaryContext {
  inst: IInstitution;
  orgs: Map<string, IOrganization>;
  allocations: Map<string, (IVenueAllocation & { venueDoc: IVenue | null })[]>;
}

type LeanEvent = IEvent;

export async function buildSummaryContext(events: LeanEvent[]): Promise<SummaryContext> {
  const inst = await getInstitution();
  const orgIds = [...new Set(events.map((e) => String(e.organization)))];
  const [orgs, allocs] = await Promise.all([
    Organization.find({ _id: { $in: orgIds } }).lean(),
    VenueAllocation.find({ event: { $in: events.map((e) => e._id) } }).sort({ startsAt: 1 }).lean(),
  ]);
  const venues = await Venue.find({ _id: { $in: [...new Set(allocs.map((a) => String(a.venue)))] } }).lean();
  const venueMap = new Map(venues.map((v) => [String(v._id), v]));
  const allocations = new Map<string, (IVenueAllocation & { venueDoc: IVenue | null })[]>();
  for (const a of allocs) {
    const key = String(a.event);
    const list = allocations.get(key) ?? [];
    list.push({ ...a, venueDoc: venueMap.get(String(a.venue)) ?? null });
    allocations.set(key, list);
  }
  return { inst, orgs: new Map(orgs.map((o) => [String(o._id), o])), allocations };
}

function primaryVenue(ctx: SummaryContext, eventId: Types.ObjectId) {
  const list = ctx.allocations.get(String(eventId)) ?? [];
  const chosen = list.find((a) => a.status === 'confirmed') ?? null;
  return chosen?.venueDoc ?? null;
}

export function eventSummaryDTO(e: LeanEvent, ctx: SummaryContext, now = new Date()): EventSummaryDTO {
  const org = ctx.orgs.get(String(e.organization));
  const venue = primaryVenue(ctx, e._id);
  return {
    id: String(e._id),
    slug: e.slug,
    title: e.title,
    summary: e.summary,
    category: e.category,
    categoryName: categoryName(ctx.inst, e.category),
    organization: { id: String(e.organization), name: org?.name ?? 'Unknown organizer', slug: org?.slug ?? '' },
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    registrationOpensAt: iso(e.registrationOpensAt),
    registrationDeadline: e.registrationDeadline.toISOString(),
    mode: e.mode,
    teamSize: { min: e.teamSize.min, max: e.teamSize.max },
    capacity: e.capacity,
    fee: { amount: e.fee.amount, currency: e.fee.currency, basis: e.fee.basis },
    status: e.status,
    coverUrl: coverUrl(e),
    isDemo: e.isDemo,
    venue: venue ? { id: String(venue._id), name: venue.name, building: venue.building, roomCode: venue.roomCode } : null,
    activeRegistrations: e.counters.activeRegistrations,
    remaining: e.capacity == null ? null : Math.max(0, e.capacity - e.counters.activeRegistrations),
    registrationState: registrationState(e, now),
  };
}

export function allocationDTO(a: IVenueAllocation & { venueDoc: IVenue | null }, e: Pick<IEvent, '_id' | 'title' | 'slug'>): AllocationDTO {
  const v = a.venueDoc;
  return {
    id: String(a._id),
    event: { id: String(e._id), title: e.title, slug: e.slug },
    venue: {
      id: String(a.venue),
      name: v?.name ?? 'Removed venue',
      building: v?.building ?? '',
      roomCode: v?.roomCode ?? '',
      capacity: v?.capacity ?? 0,
    },
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    reason: a.reason,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function eventDetailDTO(e: LeanEvent, viewer: AuthUser | undefined): Promise<EventDetailDTO> {
  const ctx = await buildSummaryContext([e]);
  const access = eventAccess(viewer, e);
  let staff: StaffMemberDTO[] | null = null;
  if (access.canManage) {
    const users = await User.find({ _id: { $in: e.staff.map((s) => s.user) } }).select('name email').lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    staff = e.staff.map((s) => {
      const u = byId.get(String(s.user));
      return { user: { id: String(s.user), name: u?.name ?? 'Unknown', email: u?.email ?? '' }, role: s.role };
    });
  }
  let registrationId: string | null = null;
  if (viewer) {
    const own =
      e.mode === 'individual'
        ? await Registration.findOne({ event: e._id, user: viewer._id, status: { $nin: ['cancelled', 'rejected'] } }).select('_id').lean()
        : await findTeamRegistrationForUser(e._id, viewer._id);
    registrationId = own ? String(own._id) : null;
  }
  return {
    ...eventSummaryDTO(e, ctx),
    description: e.description,
    eligibility: e.eligibility,
    rules: e.rules,
    schedule: e.schedule.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      title: s.title,
      location: s.location,
    })),
    paymentInstructions: e.paymentInstructions,
    requiresApproval: e.requiresApproval,
    allowedDepartments: e.allowedDepartments,
    expectedAttendance: e.expectedAttendance,
    requiredFacilities: e.requiredFacilities,
    checkInOpensMinutesBefore: e.checkInOpensMinutesBefore,
    allocations: (ctx.allocations.get(String(e._id)) ?? []).map((a) => allocationDTO(a, e)),
    staff,
    finalizedAt: iso(e.finalizedAt),
    documents: {
      approvalRequired: e.participation?.approvalRequired ?? false,
      checkInRequiresApproval: e.participation?.checkInRequiresApproval ?? false,
      requirements: (e.documentRequirements ?? []).filter((r) => r.active).map(requirementDTO),
    },
    viewer: { canManage: access.canManage, canCheckIn: access.canCheckIn, registrationId },
  };
}

async function findTeamRegistrationForUser(eventId: Types.ObjectId, userId: Types.ObjectId) {
  const m = await TeamMembership.findOne({ event: eventId, user: userId }).lean();
  if (!m) return null;
  const team = await Team.findById(m.team).select('registration').lean();
  return team?.registration ? { _id: team.registration } : null;
}

/* ---------------------------------------------------------------- validation against configuration */

async function assertConfigured(input: EventInputParsed, user: AuthUser): Promise<IInstitution> {
  const inst = await getInstitution();
  if (!inst.categories.some((c) => c.slug === input.category)) {
    throw new AppError(400, 'validation_failed', 'Unknown category', { fields: { category: 'Choose a configured category' } });
  }
  const unknownDepts = input.allowedDepartments.filter((d) => !inst.departments.some((x) => x.code === d));
  if (unknownDepts.length) {
    throw new AppError(400, 'validation_failed', 'Unknown departments', {
      fields: { allowedDepartments: `Unknown: ${unknownDepts.join(', ')}` },
    });
  }
  const org = await Organization.findById(input.organization).lean();
  if (!org) throw new AppError(400, 'validation_failed', 'Unknown organization', { fields: { organization: 'Choose an organization' } });
  if (user.role !== 'admin' && !user.organizations.some((o) => String(o) === String(org._id))) {
    throw new AppError(403, 'forbidden', 'You can only create events for organizations you belong to', {
      fields: { organization: 'You are not a member of this organization' },
    });
  }
  return inst;
}

function normalise(input: EventInputParsed, inst: IInstitution) {
  return {
    title: input.title,
    organization: input.organization,
    category: input.category,
    summary: input.summary,
    description: input.description,
    eligibility: input.eligibility,
    rules: input.rules,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    registrationOpensAt: input.registrationOpensAt ? new Date(input.registrationOpensAt) : null,
    registrationDeadline: new Date(input.registrationDeadline),
    mode: input.mode,
    teamSize: input.mode === 'team' ? input.teamSize : { min: 1, max: 1 },
    capacity: input.capacity,
    fee: { amount: input.fee.amount, currency: input.fee.currency || inst.defaults.currency, basis: input.fee.basis },
    paymentInstructions: input.paymentInstructions,
    requiresApproval: input.requiresApproval,
    allowedDepartments: input.allowedDepartments,
    expectedAttendance: input.expectedAttendance,
    requiredFacilities: input.requiredFacilities,
    checkInOpensMinutesBefore: input.checkInOpensMinutesBefore,
    schedule: input.schedule.map((s) => ({
      startsAt: new Date(s.startsAt),
      endsAt: new Date(s.endsAt),
      title: s.title,
      location: s.location,
    })),
  };
}

/* ---------------------------------------------------------------- commands */

export async function createEvent(user: AuthUser, input: EventInputParsed): Promise<HydratedDocument<IEvent>> {
  if (user.role !== 'admin' && user.role !== 'organizer') throw forbidden('Only organizers can create events');
  const inst = await assertConfigured(input, user);
  const data = normalise(input, inst);
  const event = await Event.create({
    ...data,
    institution: inst._id,
    createdBy: user._id,
    slug: await uniqueSlug(input.title),
    codePrefix: await uniqueCodePrefix(input.title),
    status: 'draft',
  });
  await audit({
    actor: user._id,
    action: 'event.created',
    entityType: 'Event',
    entityId: event._id,
    event: event._id,
    summary: `Created draft “${event.title}”`,
  });
  return event;
}

export async function updateEvent(user: AuthUser, event: HydratedDocument<IEvent>, input: EventInputParsed) {
  const inst = await assertConfigured(input, user);
  const data = normalise(input, inst);
  const hasRegistrations = event.counters.registrationSeq > 0 && (await Registration.exists({ event: event._id }));

  if (hasRegistrations && data.mode !== event.mode) {
    throw conflict('Registration mode cannot change after registrations exist', {
      fields: { mode: 'Locked: registrations already exist' },
    });
  }
  if (data.capacity != null && data.capacity < event.counters.activeRegistrations) {
    throw conflict(`Capacity cannot be below the ${event.counters.activeRegistrations} active registrations`, {
      fields: { capacity: `At least ${event.counters.activeRegistrations}` },
    });
  }
  if (data.mode === 'team' && hasRegistrations) {
    const largest = await Team.findOne({ event: event._id, status: 'active' }).sort({ memberCount: -1 }).select('memberCount').lean();
    if (largest && largest.memberCount > data.teamSize.max) {
      throw conflict(`A team already has ${largest.memberCount} members; maximum cannot be lower`, {
        fields: { 'teamSize.max': `At least ${largest.memberCount}` },
      });
    }
  }
  if (hasRegistrations && data.fee.amount !== event.fee.amount) {
    // Changing a fee after people have paid would silently invalidate verified amounts.
    const decided = await PaymentRecord.exists({ event: event._id, status: { $in: ['verified', 'refunded'] } });
    if (decided) {
      throw conflict('The fee cannot change after payments have been verified', { fields: { 'fee.amount': 'Locked' } });
    }
  }

  const timeChanged =
    data.startsAt.getTime() !== event.startsAt.getTime() || data.endsAt.getTime() !== event.endsAt.getTime();
  if (timeChanged) {
    // Moves venue bookings with the event; throws 409 with details if the new window conflicts.
    await shiftEventAllocations(event, data.startsAt, data.endsAt, user._id);
  }

  const before = { title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, capacity: event.capacity, fee: event.fee.amount };
  if (data.title !== event.title) event.slug = await uniqueSlug(data.title, event._id);
  event.set({ ...data, organization: data.organization });
  await event.save();

  if (hasRegistrations) {
    // Fee/approval/team-size changes can alter eligibility; re-evaluate active registrations.
    await recomputeEventRegistrations(event._id);
  }

  await audit({
    actor: user._id,
    action: 'event.updated',
    entityType: 'Event',
    entityId: event._id,
    event: event._id,
    summary: `Updated “${event.title}”`,
    meta: { before, after: { title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, capacity: event.capacity, fee: event.fee.amount } },
  });
  return event;
}

const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['published', 'cancelled'],
  published: ['draft', 'cancelled', 'completed'],
  cancelled: [],
  completed: [],
};

export async function changeEventStatus(user: AuthUser, event: HydratedDocument<IEvent>, next: EventStatus) {
  if (event.status === next) return event;
  if (!TRANSITIONS[event.status].includes(next)) {
    throw conflict(`An event cannot move from ${event.status} to ${next}`);
  }
  const now = new Date();
  if (next === 'published') {
    if (event.endsAt <= now) throw badRequest('This event has already ended; update its dates before publishing');
  }
  if (next === 'draft' && event.counters.activeRegistrations > 0) {
    throw conflict('This event has active registrations. Cancel it instead of unpublishing so participants are not left without notice.');
  }
  if (next === 'completed') {
    throw badRequest('Use “Finalize report” to complete an event');
  }
  const prev = event.status;
  event.status = next;
  if (next === 'published') event.publishedAt = event.publishedAt ?? now;
  if (next === 'cancelled') event.cancelledAt = now;
  await event.save();
  if (next === 'cancelled') {
    // A cancelled event frees its rooms.
    await VenueAllocation.deleteMany({ event: event._id });
  }
  await audit({
    actor: user._id,
    action: `event.${next === 'draft' ? 'unpublished' : next}`,
    entityType: 'Event',
    entityId: event._id,
    event: event._id,
    summary: `Status ${prev} → ${next}`,
  });
  return event;
}

export async function setEventStaff(
  user: AuthUser,
  event: HydratedDocument<IEvent>,
  staff: { email: string; role: 'manager' | 'checkin' }[],
) {
  const emails = [...new Set(staff.map((s) => s.email))];
  const users = await User.find({ email: { $in: emails } }).select('_id email name').lean();
  const missing = emails.filter((e) => !users.some((u) => u.email === e));
  if (missing.length) {
    throw new AppError(400, 'validation_failed', 'Some people do not have accounts yet', {
      fields: { staff: `No account for: ${missing.join(', ')}. Ask them to sign up first.` },
    });
  }
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const existing = new Map(event.staff.map((s) => [String(s.user), s]));
  event.staff = staff.map((s) => {
    const u = byEmail.get(s.email)!;
    const prev = existing.get(String(u._id));
    return { user: u._id, role: s.role, addedBy: prev?.addedBy ?? user._id, addedAt: prev?.addedAt ?? new Date() };
  }) as typeof event.staff;
  await event.save();
  await audit({
    actor: user._id,
    action: 'event.staff_updated',
    entityType: 'Event',
    entityId: event._id,
    event: event._id,
    summary: `Staff list set to ${staff.length} ${staff.length === 1 ? 'person' : 'people'}`,
    meta: { staff },
  });
  return event;
}

export type { EventAccess };
