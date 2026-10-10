import { Types, type HydratedDocument, type PipelineStage } from 'mongoose';
import type {
  Page,
  ParticipantDTO,
  RegistrationDTO,
  RegistrationRowDTO,
  TeamDTO,
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
  type IEvent,
  type IInstitution,
  type IRegistration,
  type ITeam,
} from '../../models';
import { audit } from '../../lib/audit';
import { randomCode } from '../../lib/crypto';
import { AppError, conflict, forbidden, isDuplicateKeyError, notFound, unprocessable } from '../../lib/errors';
import { escapeRegex, iso } from '../../lib/http';
import { eventAccess } from '../../lib/access';
import type { AuthUser } from '../../middleware/auth';
import { publish } from '../../realtime/bus';
import { getInstitution } from '../institution/service';
import { coverUrl, registrationState } from '../events/service';
import { amountDue, computeRegistrationStatus } from './status';

const ACTIVE = { $nin: ['cancelled', 'rejected'] };

/* =================================================================== tickets */

function ticketShortCode() {
  return randomCode(6);
}

/**
 * Issue one live ticket per participant of a confirmed registration. Idempotent: the
 * partial unique index {event, user | live:true} makes concurrent calls safe.
 */
export async function issueTickets(reg: Pick<IRegistration, '_id' | 'event' | 'kind' | 'user' | 'team'>): Promise<number> {
  const participantIds =
    reg.kind === 'team' && reg.team
      ? (await TeamMembership.find({ team: reg.team }).select('user').lean()).map((m) => m.user)
      : [reg.user];
  const existing = await Ticket.find({ event: reg.event, user: { $in: participantIds }, live: true }).select('user').lean();
  const have = new Set(existing.map((t) => String(t.user)));
  let issued = 0;
  for (const userId of participantIds) {
    if (have.has(String(userId))) continue;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await Ticket.create({
          event: reg.event,
          registration: reg._id,
          user: userId,
          team: reg.team ?? null,
          shortCode: ticketShortCode(),
          status: 'active',
          live: true,
        });
        issued++;
        break;
      } catch (err) {
        if (isDuplicateKeyError(err) && err.keyPattern && 'shortCode' in err.keyPattern) continue; // code collision: retry
        if (isDuplicateKeyError(err)) break; // another request issued it concurrently
        throw err;
      }
    }
  }
  return issued;
}

/** Void unused tickets of a registration. Tickets already used for entry are left intact. */
export async function voidTickets(filter: { registration?: Types.ObjectId; event?: Types.ObjectId; user?: Types.ObjectId }, reason: string) {
  await Ticket.updateMany(
    { ...filter, status: 'active' },
    { $set: { status: 'void', live: false, voidedAt: new Date(), voidReason: reason } },
  );
}

/* =================================================================== status */

export async function recomputeRegistration(regId: Types.ObjectId): Promise<IRegistration | null> {
  const reg = await Registration.findById(regId).lean();
  if (!reg) return null;
  if (reg.status === 'cancelled' || reg.status === 'rejected') return reg;
  const [event, payment, team] = await Promise.all([
    Event.findById(reg.event).lean(),
    PaymentRecord.findOne({ registration: reg._id }).lean(),
    reg.team ? Team.findById(reg.team).lean() : Promise.resolve(null),
  ]);
  if (!event || !payment) return reg;

  const { status, reason } = computeRegistrationStatus({
    kind: reg.kind,
    memberCount: team?.memberCount ?? 1,
    teamMin: event.teamSize.min,
    paymentRequired: payment.required,
    paymentStatus: payment.status,
    hasReference: Boolean(payment.reference),
    requiresApproval: event.requiresApproval,
    approved: reg.approval?.approved ?? null,
  });

  let current: IRegistration | null = reg;
  if (status !== reg.status || reason !== reg.statusReason) {
    current = await Registration.findOneAndUpdate(
      { _id: reg._id, status: ACTIVE },
      { $set: { status, statusReason: reason } },
      { new: true },
    ).lean();
    if (!current) return Registration.findById(reg._id).lean(); // cancelled concurrently
    publish(String(reg.event), { type: 'registration.changed', registrationId: String(reg._id), status });
  }
  if (current.status === 'confirmed') await issueTickets(current);
  else await voidTickets({ registration: current._id }, reason || 'Registration no longer confirmed');
  return current;
}

export async function recomputeEventRegistrations(eventId: Types.ObjectId) {
  const event = await Event.findById(eventId).lean();
  const regs = await Registration.find({ event: eventId, status: ACTIVE }).select('_id kind team').lean();
  if (event) {
    // Keep amounts due in line with the configured fee for payments not yet decided.
    for (const r of regs) {
      const team = r.team ? await Team.findById(r.team).select('memberCount').lean() : null;
      await PaymentRecord.updateOne(
        { registration: r._id, status: { $in: ['pending', 'not_required'] } },
        {
          $set: {
            required: event.fee.amount > 0,
            amountDue: amountDue(event.fee, team?.memberCount ?? 1),
            currency: event.fee.currency,
          },
        },
      );
      await PaymentRecord.updateOne(
        { registration: r._id, status: 'not_required', required: true },
        { $set: { status: 'pending' } },
      );
      await PaymentRecord.updateOne(
        { registration: r._id, status: 'pending', required: false },
        { $set: { status: 'not_required' } },
      );
    }
  }
  for (const r of regs) await recomputeRegistration(r._id);
}

/* =================================================================== guards */

async function applyProfile(
  user: AuthUser,
  profile: { department?: string; rollNumber?: string; phone?: string },
  inst: IInstitution,
): Promise<AuthUser> {
  const updates: Record<string, string> = {};
  if (profile.department) {
    if (!inst.departments.some((d) => d.code === profile.department)) {
      throw new AppError(400, 'validation_failed', 'Unknown department', { fields: { 'profile.department': 'Choose a department from the list' } });
    }
    updates.department = profile.department;
  }
  if (profile.rollNumber) updates.rollNumber = profile.rollNumber;
  if (profile.phone) updates.phone = profile.phone;
  let current = user;
  if (Object.keys(updates).length) {
    current = (await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true }).lean<AuthUser>()) ?? user;
  }
  const missing: Record<string, string> = {};
  if (inst.requirements.rollNumber && !current.rollNumber) missing['profile.rollNumber'] = 'Roll number is required';
  if (inst.requirements.department && !current.department) missing['profile.department'] = 'Department is required';
  if (inst.requirements.phone && !current.phone) missing['profile.phone'] = 'Phone number is required';
  if (Object.keys(missing).length) throw new AppError(400, 'validation_failed', 'Complete your profile to register', { fields: missing });
  return current;
}

function assertEligible(event: IEvent, user: AuthUser) {
  if (event.allowedDepartments.length && (!user.department || !event.allowedDepartments.includes(user.department))) {
    throw unprocessable(
      `This event is open to ${event.allowedDepartments.join(', ')} only`,
      { allowedDepartments: event.allowedDepartments },
      'not_eligible',
    );
  }
}

function assertWindow(event: IEvent, allowFull = false) {
  const state = registrationState(event);
  if (state === 'open' || (allowFull && state === 'full')) return;
  const messages: Record<string, string> = {
    draft: 'This event is not published',
    cancelled: 'This event has been cancelled',
    ended: 'This event has ended',
    not_yet_open: 'Registration has not opened yet',
    closed: 'Registration has closed',
    full: 'This event is full',
  };
  throw new AppError(409, `registration_${state}`, messages[state] ?? 'Registration is not open');
}

/** Atomically reserve a capacity slot and a registration sequence number. */
async function reserveSlot(eventId: Types.ObjectId): Promise<IEvent> {
  const updated = await Event.findOneAndUpdate(
    {
      _id: eventId,
      status: 'published',
      $expr: { $or: [{ $eq: ['$capacity', null] }, { $lt: ['$counters.activeRegistrations', '$capacity'] }] },
    },
    { $inc: { 'counters.activeRegistrations': 1, 'counters.registrationSeq': 1 } },
    { new: true },
  ).lean();
  if (!updated) throw new AppError(409, 'registration_full', 'This event is full');
  return updated;
}

async function releaseSlot(eventId: Types.ObjectId) {
  await Event.updateOne({ _id: eventId, 'counters.activeRegistrations': { $gt: 0 } }, { $inc: { 'counters.activeRegistrations': -1 } });
}

function registrationCode(event: IEvent) {
  return `${event.codePrefix}-${String(event.counters.registrationSeq).padStart(4, '0')}`;
}

async function createPayment(reg: IRegistration, event: IEvent, memberCount: number) {
  const required = event.fee.amount > 0;
  await PaymentRecord.create({
    registration: reg._id,
    event: event._id,
    required,
    status: required ? 'pending' : 'not_required',
    amountDue: required ? amountDue(event.fee, memberCount) : 0,
    currency: event.fee.currency,
    history: [{ status: required ? 'pending' : 'not_required', at: new Date(), by: null, note: 'Registration created' }],
  });
}

/* =================================================================== participant flows */

export async function registerIndividual(user: AuthUser, event: IEvent, profile: Parameters<typeof applyProfile>[1]) {
  if (event.mode !== 'individual') throw conflict('This is a team event — create or join a team instead');
  assertWindow(event);
  const inst = await getInstitution();
  const participant = await applyProfile(user, profile, inst);
  assertEligible(event, participant);
  const activeKey = `${event._id}:${user._id}`;
  const existing = await Registration.findOne({ activeKey }).select('_id').lean();
  if (existing) throw conflict('You are already registered for this event', { registrationId: String(existing._id) }, 'already_registered');

  const reserved = await reserveSlot(event._id);
  let reg: IRegistration;
  try {
    reg = (
      await Registration.create({
        event: event._id,
        code: registrationCode(reserved),
        kind: 'individual',
        status: 'pending',
        user: user._id,
        team: null,
        activeKey,
        source: 'web',
      })
    ).toObject();
  } catch (err) {
    await releaseSlot(event._id);
    if (isDuplicateKeyError(err)) throw conflict('You are already registered for this event', undefined, 'already_registered');
    throw err;
  }
  await createPayment(reg, event, 1);
  const final = await recomputeRegistration(reg._id);
  await audit({
    actor: user._id,
    action: 'registration.created',
    entityType: 'Registration',
    entityId: reg._id,
    event: event._id,
    summary: `${user.name} registered (${reg.code})`,
  });
  return final!;
}

async function generateTeamCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(8);
    if (!(await Team.exists({ code }))) return code;
  }
  throw new AppError(500, 'internal', 'Could not allocate a team code');
}

export async function createTeam(user: AuthUser, event: IEvent, name: string, profile: Parameters<typeof applyProfile>[1]) {
  if (event.mode !== 'team') throw conflict('This is an individual event — register directly');
  assertWindow(event);
  const inst = await getInstitution();
  const participant = await applyProfile(user, profile, inst);
  assertEligible(event, participant);
  if (await TeamMembership.exists({ event: event._id, user: user._id })) {
    throw conflict('You are already in a team for this event', undefined, 'already_in_team');
  }

  const reserved = await reserveSlot(event._id);
  let team: HydratedDocument<ITeam> | null = null;
  try {
    team = await Team.create({
      event: event._id,
      name,
      nameKey: name.trim().toLowerCase(),
      code: await generateTeamCode(),
      codeExpiresAt: event.registrationDeadline,
      leader: user._id,
      memberCount: 1,
    });
  } catch (err) {
    await releaseSlot(event._id);
    if (isDuplicateKeyError(err)) {
      throw new AppError(409, 'team_name_taken', 'Another team already uses that name', { fields: { name: 'Choose a different team name' } });
    }
    throw err;
  }
  try {
    await TeamMembership.create({ team: team._id, event: event._id, user: user._id, role: 'leader' });
  } catch (err) {
    await Team.deleteOne({ _id: team._id });
    await releaseSlot(event._id);
    if (isDuplicateKeyError(err)) throw conflict('You are already in a team for this event', undefined, 'already_in_team');
    throw err;
  }
  const reg = (
    await Registration.create({
      event: event._id,
      code: registrationCode(reserved),
      kind: 'team',
      status: 'incomplete',
      user: user._id,
      team: team._id,
      source: 'web',
    })
  ).toObject();
  team.registration = reg._id;
  await team.save();
  await createPayment(reg, event, 1);
  const final = await recomputeRegistration(reg._id);
  await audit({
    actor: user._id,
    action: 'team.created',
    entityType: 'Team',
    entityId: team._id,
    event: event._id,
    summary: `${user.name} created team “${team.name}” (${reg.code})`,
  });
  return final!;
}

export async function previewTeam(code: string) {
  const team = await Team.findOne({ code, status: 'active' }).lean();
  if (!team) throw notFound('Team');
  const event = await Event.findById(team.event).lean();
  if (!event) throw notFound('Team');
  const state = registrationState(event);
  const expired = team.codeExpiresAt < new Date();
  let joinable = true;
  let reason = '';
  if (expired) [joinable, reason] = [false, 'This team code has expired. Ask the team leader for a new one.'];
  else if (!(state === 'open' || state === 'full')) [joinable, reason] = [false, 'Registration for this event is closed.'];
  else if (team.memberCount >= event.teamSize.max) [joinable, reason] = [false, `This team is full (${event.teamSize.max} members).`];
  return {
    team: { id: String(team._id), name: team.name, memberCount: team.memberCount },
    event: { id: String(event._id), slug: event.slug, title: event.title, teamSize: event.teamSize, startsAt: event.startsAt.toISOString() },
    joinable,
    reason,
  };
}

export async function joinTeam(user: AuthUser, code: string, profile: Parameters<typeof applyProfile>[1]) {
  const team = await Team.findOne({ code, status: 'active' }).lean();
  if (!team) throw new AppError(404, 'team_not_found', 'No active team uses that code');
  if (team.codeExpiresAt < new Date()) throw new AppError(410, 'code_expired', 'This team code has expired. Ask the team leader for a new one.');
  const event = await Event.findById(team.event).lean();
  if (!event) throw notFound('Event');
  assertWindow(event, true);
  const inst = await getInstitution();
  const participant = await applyProfile(user, profile, inst);
  assertEligible(event, participant);

  const existing = await TeamMembership.findOne({ event: event._id, user: user._id }).lean();
  if (existing) {
    throw conflict(
      String(existing.team) === String(team._id) ? 'You are already in this team' : 'You are already in another team for this event',
      undefined,
      'already_in_team',
    );
  }
  // Atomic slot: only succeeds while the team is below its maximum size.
  const slot = await Team.findOneAndUpdate(
    { _id: team._id, status: 'active', memberCount: { $lt: event.teamSize.max } },
    { $inc: { memberCount: 1 } },
    { new: true },
  ).lean();
  if (!slot) throw new AppError(409, 'team_full', `This team is full (${event.teamSize.max} members)`);
  try {
    await TeamMembership.create({ team: team._id, event: event._id, user: user._id, role: 'member' });
  } catch (err) {
    await Team.updateOne({ _id: team._id }, { $inc: { memberCount: -1 } });
    if (isDuplicateKeyError(err)) throw conflict('You are already in a team for this event', undefined, 'already_in_team');
    throw err;
  }
  await PaymentRecord.updateOne(
    { registration: team.registration, status: { $in: ['pending', 'rejected'] } },
    { $set: { amountDue: amountDue(event.fee, slot.memberCount) } },
  );
  const reg = await recomputeRegistration(team.registration!);
  await audit({
    actor: user._id,
    action: 'team.joined',
    entityType: 'Team',
    entityId: team._id,
    event: event._id,
    summary: `${user.name} joined “${team.name}” (${slot.memberCount}/${event.teamSize.max})`,
  });
  return reg!;
}

async function loadTeamContext(teamId: Types.ObjectId) {
  const team = await Team.findById(teamId);
  if (!team || team.status !== 'active') throw notFound('Team');
  const event = await Event.findById(team.event).lean();
  if (!event) throw notFound('Event');
  return { team, event };
}

export async function removeMember(actor: AuthUser, teamId: Types.ObjectId, targetId: Types.ObjectId) {
  const { team, event } = await loadTeamContext(teamId);
  const manager = eventAccess(actor, event).canManage;
  const isSelf = String(actor._id) === String(targetId);
  const isLeader = String(team.leader) === String(actor._id);
  if (!manager && !isSelf && !isLeader) throw forbidden('Only the team leader can remove members');
  if (String(team.leader) === String(targetId)) {
    throw conflict('The team leader cannot leave. Transfer leadership first, or cancel the registration.');
  }
  if (!manager && new Date() > event.registrationDeadline) throw conflict('Team changes are closed after the registration deadline');
  const used = await Ticket.exists({ event: event._id, user: targetId, status: 'checked_in' });
  if (used) throw conflict('This member has already checked in and cannot be removed');

  const removed = await TeamMembership.findOneAndDelete({ team: team._id, user: targetId });
  if (!removed) throw notFound('Team member');
  const updated = await Team.findOneAndUpdate({ _id: team._id }, { $inc: { memberCount: -1 } }, { new: true }).lean();
  await voidTickets({ event: event._id, user: targetId }, 'Left the team');
  await PaymentRecord.updateOne(
    { registration: team.registration, status: { $in: ['pending', 'rejected'] } },
    { $set: { amountDue: amountDue(event.fee, updated?.memberCount ?? 1) } },
  );
  const reg = await recomputeRegistration(team.registration!);
  const target = await User.findById(targetId).select('name').lean();
  await audit({
    actor: actor._id,
    action: isSelf ? 'team.left' : 'team.member_removed',
    entityType: 'Team',
    entityId: team._id,
    event: event._id,
    summary: isSelf ? `${actor.name} left “${team.name}”` : `${actor.name} removed ${target?.name ?? 'a member'} from “${team.name}”`,
  });
  return reg!;
}

export async function transferLeader(actor: AuthUser, teamId: Types.ObjectId, newLeaderId: Types.ObjectId) {
  const { team, event } = await loadTeamContext(teamId);
  const manager = eventAccess(actor, event).canManage;
  if (!manager && String(team.leader) !== String(actor._id)) throw forbidden('Only the team leader can transfer leadership');
  const membership = await TeamMembership.findOne({ team: team._id, user: newLeaderId });
  if (!membership) throw notFound('Team member');
  await TeamMembership.updateOne({ team: team._id, user: team.leader }, { $set: { role: 'member' } });
  membership.role = 'leader';
  await membership.save();
  const prev = team.leader;
  team.leader = newLeaderId;
  await team.save();
  await Registration.updateOne({ _id: team.registration }, { $set: { user: newLeaderId } });
  await audit({
    actor: actor._id,
    action: 'team.leader_changed',
    entityType: 'Team',
    entityId: team._id,
    event: event._id,
    summary: `Leadership of “${team.name}” transferred`,
    meta: { from: String(prev), to: String(newLeaderId) },
  });
  return recomputeRegistration(team.registration!);
}

export async function updateTeam(actor: AuthUser, teamId: Types.ObjectId, changes: { name?: string; rotateCode?: boolean }) {
  const { team, event } = await loadTeamContext(teamId);
  const manager = eventAccess(actor, event).canManage;
  if (!manager && String(team.leader) !== String(actor._id)) throw forbidden('Only the team leader can change the team');
  if (changes.name) {
    team.name = changes.name;
    team.nameKey = changes.name.trim().toLowerCase();
  }
  if (changes.rotateCode) {
    team.code = await generateTeamCode();
    team.codeExpiresAt = event.registrationDeadline;
  }
  try {
    await team.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new AppError(409, 'team_name_taken', 'Another team already uses that name', { fields: { name: 'Choose a different name' } });
    throw err;
  }
  await audit({
    actor: actor._id,
    action: changes.rotateCode ? 'team.code_rotated' : 'team.renamed',
    entityType: 'Team',
    entityId: team._id,
    event: event._id,
    summary: changes.rotateCode ? `Join code for “${team.name}” replaced` : `Team renamed to “${team.name}”`,
  });
  return team;
}

/* =================================================================== cancellation & review */

async function terminate(
  actor: AuthUser,
  reg: IRegistration,
  status: 'cancelled' | 'rejected',
  reason: string,
): Promise<IRegistration> {
  const used = await Ticket.exists({ registration: reg._id, status: 'checked_in' });
  if (used) throw conflict('Someone on this registration has already checked in; correct the attendance record first.');
  const updated = await Registration.findOneAndUpdate(
    { _id: reg._id, status: ACTIVE },
    {
      $set: { status, statusReason: reason, cancelledAt: new Date(), cancelledBy: actor._id, cancelReason: reason || null },
      $unset: { activeKey: 1 },
    },
    { new: true },
  ).lean();
  if (!updated) throw conflict('This registration is already closed');
  await releaseSlot(reg.event);
  await voidTickets({ registration: reg._id }, status === 'cancelled' ? 'Registration cancelled' : 'Registration rejected');
  if (reg.team) {
    const members = await TeamMembership.find({ team: reg.team }).select('user').lean();
    await TeamMembership.deleteMany({ team: reg.team });
    await Team.updateOne({ _id: reg.team }, { $set: { status: 'disbanded', memberCount: 0 } });
    await audit({
      actor: actor._id,
      action: 'team.disbanded',
      entityType: 'Team',
      entityId: reg.team,
      event: reg.event,
      summary: `Team disbanded with registration ${reg.code}`,
      meta: { formerMembers: members.map((m) => String(m.user)) },
    });
  }
  publish(String(reg.event), { type: 'registration.changed', registrationId: String(reg._id), status });
  return updated;
}

export async function cancelRegistration(actor: AuthUser, regId: Types.ObjectId, reason: string) {
  const reg = await Registration.findById(regId).lean();
  if (!reg) throw notFound('Registration');
  const event = await Event.findById(reg.event).lean();
  if (!event) throw notFound('Event');
  const manager = eventAccess(actor, event).canManage;
  const owner = String(reg.user) === String(actor._id);
  if (!manager && !owner) throw forbidden(reg.kind === 'team' ? 'Only the team leader can cancel the registration' : undefined);
  const result = await terminate(actor, reg, 'cancelled', reason);
  await audit({
    actor: actor._id,
    action: 'registration.cancelled',
    entityType: 'Registration',
    entityId: reg._id,
    event: reg.event,
    summary: `${reg.code} cancelled by ${manager && !owner ? 'an organizer' : 'the participant'}`,
    meta: { reason },
  });
  return result;
}

export async function reviewRegistration(actor: AuthUser, reg: IRegistration, decision: 'approve' | 'reject', note: string) {
  if (reg.status === 'cancelled' || reg.status === 'rejected') throw conflict('This registration is already closed');
  if (decision === 'reject') {
    const out = await terminate(actor, reg, 'rejected', note);
    await Registration.updateOne(
      { _id: reg._id },
      { $set: { approval: { decidedAt: new Date(), decidedBy: actor._id, approved: false, note } } },
    );
    await audit({ actor: actor._id, action: 'registration.rejected', entityType: 'Registration', entityId: reg._id, event: reg.event, summary: `${reg.code} rejected`, meta: { note } });
    return out;
  }
  await Registration.updateOne(
    { _id: reg._id, status: ACTIVE },
    { $set: { approval: { decidedAt: new Date(), decidedBy: actor._id, approved: true, note: note || null } } },
  );
  await audit({ actor: actor._id, action: 'registration.approved', entityType: 'Registration', entityId: reg._id, event: reg.event, summary: `${reg.code} approved` });
  return (await recomputeRegistration(reg._id))!;
}

/* =================================================================== payments */

export async function submitPayment(actor: AuthUser, reg: IRegistration, input: { reference: string; payerName: string; note: string }) {
  if (reg.status === 'cancelled' || reg.status === 'rejected') throw conflict('This registration is closed');
  if (String(reg.user) !== String(actor._id)) {
    throw forbidden(reg.kind === 'team' ? 'Only the team leader submits the payment reference' : undefined);
  }
  const referenceKey = input.reference.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const updated = await PaymentRecord.findOneAndUpdate(
    { registration: reg._id, required: true, status: { $in: ['pending', 'rejected'] } },
    {
      $set: {
        status: 'pending',
        reference: input.reference,
        referenceKey,
        payerName: input.payerName || null,
        participantNote: input.note || null,
        submittedAt: new Date(),
        decidedAt: null,
        decidedBy: null,
        decisionNote: null,
      },
      $push: { history: { status: 'pending', at: new Date(), by: actor._id, note: `Reference ${input.reference} submitted` } },
    },
    { new: true },
  ).lean();
  if (!updated) throw conflict('No payment is awaiting a reference for this registration');
  await audit({ actor: actor._id, action: 'payment.submitted', entityType: 'PaymentRecord', entityId: updated._id, event: reg.event, summary: `Reference submitted for ${reg.code}` });
  publish(String(reg.event), { type: 'payment.changed', registrationId: String(reg._id), status: 'pending' });
  return recomputeRegistration(reg._id);
}

export async function decidePayment(actor: AuthUser, reg: IRegistration, decision: 'verified' | 'rejected', note: string) {
  if (reg.status === 'cancelled' || reg.status === 'rejected') throw conflict('This registration is closed');
  // Conditional transition: two organizers acting at once cannot both decide.
  const updated = await PaymentRecord.findOneAndUpdate(
    { registration: reg._id, required: true, status: 'pending' },
    {
      $set: { status: decision, decidedAt: new Date(), decidedBy: actor._id, decisionNote: note || null },
      $push: { history: { status: decision, at: new Date(), by: actor._id, note } },
    },
    { new: true },
  ).lean();
  if (!updated) throw conflict('This payment is not awaiting verification (it may already have been decided)');
  await audit({
    actor: actor._id,
    action: decision === 'verified' ? 'payment.verified' : 'payment.rejected',
    entityType: 'PaymentRecord',
    entityId: updated._id,
    event: reg.event,
    summary: `Payment for ${reg.code} ${decision}${updated.reference ? ` (ref ${updated.reference})` : ''}`,
    meta: { note },
  });
  publish(String(reg.event), { type: 'payment.changed', registrationId: String(reg._id), status: decision });
  return recomputeRegistration(reg._id);
}

export async function refundPayment(actor: AuthUser, reg: IRegistration, note: string) {
  if (reg.status !== 'cancelled' && reg.status !== 'rejected') {
    throw conflict('Cancel or reject the registration before recording a refund');
  }
  const updated = await PaymentRecord.findOneAndUpdate(
    { registration: reg._id, status: 'verified' },
    {
      $set: { status: 'refunded', decidedAt: new Date(), decidedBy: actor._id, decisionNote: note },
      $push: { history: { status: 'refunded', at: new Date(), by: actor._id, note } },
    },
    { new: true },
  ).lean();
  if (!updated) throw conflict('Only verified payments can be marked refunded');
  await audit({ actor: actor._id, action: 'payment.refunded', entityType: 'PaymentRecord', entityId: updated._id, event: reg.event, summary: `Refund recorded for ${reg.code}`, meta: { note } });
  return reg;
}

/* =================================================================== read models */

export async function loadRegistrationFor(user: AuthUser, regId: Types.ObjectId, need: 'view' | 'manage') {
  const reg = await Registration.findById(regId).lean();
  if (!reg) throw notFound('Registration');
  const event = await Event.findById(reg.event).lean();
  if (!event) throw notFound('Registration');
  const access = eventAccess(user, event);
  if (need === 'manage') {
    if (!access.canManage) throw notFound('Registration');
    return { reg, event, access };
  }
  if (access.canManage) return { reg, event, access };
  const isPrimary = String(reg.user) === String(user._id);
  const isMember = reg.team ? Boolean(await TeamMembership.exists({ team: reg.team, user: user._id })) : false;
  if (!isPrimary && !isMember) throw notFound('Registration');
  return { reg, event, access };
}

export async function registrationDTO(regId: Types.ObjectId, viewer: AuthUser): Promise<RegistrationDTO> {
  const reg = await Registration.findById(regId).lean();
  if (!reg) throw notFound('Registration');
  const event = await Event.findById(reg.event).lean();
  if (!event) throw notFound('Registration');
  const canManage = eventAccess(viewer, event).canManage;
  const [team, memberships, payment] = await Promise.all([
    reg.team ? Team.findById(reg.team).lean() : Promise.resolve(null),
    reg.team ? TeamMembership.find({ team: reg.team }).sort({ role: 1, joinedAt: 1 }).lean() : Promise.resolve([]),
    PaymentRecord.findOne({ registration: reg._id }).lean(),
  ]);
  const participantIds = reg.team ? memberships.map((m) => m.user) : [reg.user];
  const peopleIds = [...participantIds, reg.user, payment?.decidedBy, reg.approval?.decidedBy].filter(Boolean) as Types.ObjectId[];
  const [users, tickets] = await Promise.all([
    User.find({ _id: { $in: peopleIds } }).lean(),
    Ticket.find({ registration: reg._id }).sort({ issuedAt: -1 }).lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const isMember = participantIds.some((id) => String(id) === String(viewer._id)) || String(reg.user) === String(viewer._id);
  const isLeader = String(reg.user) === String(viewer._id);

  const participants: ParticipantDTO[] = participantIds.map((id) => {
    const u = userById.get(String(id));
    const t = tickets.find((x) => String(x.user) === String(id) && x.live) ?? tickets.find((x) => String(x.user) === String(id));
    const self = String(id) === String(viewer._id);
    const privileged = canManage || self;
    return {
      id: String(id),
      name: u?.name ?? 'Unknown',
      email: privileged ? (u?.email ?? null) : null,
      rollNumber: u?.rollNumber ?? null,
      department: u?.department ?? null,
      phone: privileged ? (u?.phone ?? null) : null,
      isLeader: String(id) === String(reg.user),
      claimed: u?.claimed ?? true,
      ticket: t && (privileged || isMember)
        ? { id: String(t._id), shortCode: t.shortCode, status: t.status, checkedInAt: iso(t.checkedInAt) }
        : null,
    };
  });

  let duplicateReferenceOf: string[] = [];
  if (payment?.referenceKey && canManage) {
    const dups = await PaymentRecord.find({ event: reg.event, referenceKey: payment.referenceKey, registration: { $ne: reg._id } })
      .select('registration')
      .lean();
    const codes = await Registration.find({ _id: { $in: dups.map((d) => d.registration) } }).select('code').lean();
    duplicateReferenceOf = codes.map((c) => c.code);
  }

  const teamDTO: TeamDTO | null = team
    ? {
        id: String(team._id),
        name: team.name,
        code: (isMember || canManage) && team.status === 'active' ? team.code : null,
        codeExpiresAt: (isMember || canManage) && team.status === 'active' ? team.codeExpiresAt.toISOString() : null,
        leaderId: String(team.leader),
        memberCount: team.memberCount,
        status: team.status,
      }
    : null;

  const decider = payment?.decidedBy ? userById.get(String(payment.decidedBy)) : null;
  const approver = reg.approval?.decidedBy ? userById.get(String(reg.approval.decidedBy)) : null;
  const primary = userById.get(String(reg.user));

  return {
    id: String(reg._id),
    code: reg.code,
    event: {
      id: String(event._id),
      title: event.title,
      slug: event.slug,
      category: event.category,
      coverUrl: coverUrl(event),
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      mode: event.mode,
      teamSize: event.teamSize,
      fee: event.fee,
      paymentInstructions: event.paymentInstructions,
      requiresApproval: event.requiresApproval,
      registrationDeadline: event.registrationDeadline.toISOString(),
      status: event.status,
    },
    kind: reg.kind,
    status: reg.status,
    statusReason: reg.statusReason,
    source: reg.source,
    externalId: canManage ? reg.externalId : null,
    primary: { id: String(reg.user), name: primary?.name ?? 'Unknown', email: canManage || isLeader ? (primary?.email ?? '') : '' },
    team: teamDTO,
    participants,
    payment: {
      status: payment?.status ?? 'not_required',
      required: payment?.required ?? false,
      amountDue: payment?.amountDue ?? 0,
      currency: payment?.currency ?? event.fee.currency,
      reference: payment?.reference ?? null,
      payerName: payment?.payerName ?? null,
      submittedAt: iso(payment?.submittedAt),
      decidedAt: iso(payment?.decidedAt),
      decidedBy: decider ? { id: String(decider._id), name: decider.name } : null,
      note: payment?.decisionNote ?? null,
      duplicateReferenceOf,
    },
    approval: {
      required: event.requiresApproval,
      decidedAt: iso(reg.approval?.decidedAt),
      decidedBy: approver ? { id: String(approver._id), name: approver.name } : null,
      note: reg.approval?.note ?? null,
    },
    createdAt: reg.createdAt.toISOString(),
    updatedAt: reg.updatedAt.toISOString(),
    cancelledAt: iso(reg.cancelledAt),
    cancelReason: reg.cancelReason,
    viewer: { isMember, isLeader, canManage },
  };
}

export async function myRegistrations(user: AuthUser): Promise<RegistrationDTO[]> {
  const memberships = await TeamMembership.find({ user: user._id }).select('team').lean();
  const regs = await Registration.find({
    $or: [{ user: user._id }, { team: { $in: memberships.map((m) => m.team) } }],
  })
    .sort({ createdAt: -1 })
    .select('_id')
    .limit(100)
    .lean();
  const out: RegistrationDTO[] = [];
  for (const r of regs) out.push(await registrationDTO(r._id, user));
  return out;
}

const SORTS: Record<string, Record<string, 1 | -1>> = {
  createdAt: { createdAt: 1 },
  '-createdAt': { createdAt: -1 },
  code: { code: 1 },
  '-code': { code: -1 },
  name: { sortName: 1, code: 1 },
  '-name': { sortName: -1, code: 1 },
  status: { status: 1, code: 1 },
  '-status': { status: -1, code: 1 },
};

export async function listRegistrations(
  eventId: Types.ObjectId,
  query: {
    q?: string;
    status?: string;
    payment?: string;
    paymentStage?: 'awaiting_reference' | 'awaiting_verification';
    sort: string;
    page: number;
    pageSize: number;
  },
): Promise<Page<RegistrationRowDTO>> {
  const match: Record<string, unknown> = { event: eventId };
  if (query.status) match.status = query.status;

  const pipeline: PipelineStage[] = [
    { $match: match },
    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'primaryUser', pipeline: [{ $project: { name: 1, email: 1, rollNumber: 1 } }] } },
    { $lookup: { from: 'teams', localField: 'team', foreignField: '_id', as: 'teamDoc', pipeline: [{ $project: { name: 1, memberCount: 1 } }] } },
    { $lookup: { from: 'paymentrecords', localField: '_id', foreignField: 'registration', as: 'payment', pipeline: [{ $project: { status: 1, reference: 1, amountDue: 1, submittedAt: 1 } }] } },
    { $unwind: { path: '$primaryUser', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$teamDoc', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$payment', preserveNullAndEmptyArrays: true } },
    { $addFields: { sortName: { $toLower: { $ifNull: ['$teamDoc.name', '$primaryUser.name'] } } } },
  ];

  if (query.payment) pipeline.push({ $match: { 'payment.status': query.payment } });
  if (query.paymentStage === 'awaiting_reference') pipeline.push({ $match: { 'payment.status': { $in: ['pending', 'rejected'] }, 'payment.reference': null, status: ACTIVE } });
  if (query.paymentStage === 'awaiting_verification') pipeline.push({ $match: { 'payment.status': 'pending', 'payment.reference': { $ne: null }, status: ACTIVE } });

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    // Members other than the leader are matched through their team membership.
    const users = await User.find({ $or: [{ name: rx }, { email: rx }, { rollNumber: rx }] }).select('_id').limit(500).lean();
    const memberTeams = await TeamMembership.find({ event: eventId, user: { $in: users.map((u) => u._id) } }).select('team').lean();
    pipeline.push({
      $match: {
        $or: [
          { code: rx },
          { externalId: rx },
          { 'teamDoc.name': rx },
          { 'payment.reference': rx },
          { user: { $in: users.map((u) => u._id) } },
          { team: { $in: memberTeams.map((m) => m.team) } },
        ],
      },
    });
  }

  pipeline.push({
    $facet: {
      total: [{ $count: 'n' }],
      items: [{ $sort: SORTS[query.sort] ?? { createdAt: -1 } }, { $skip: (query.page - 1) * query.pageSize }, { $limit: query.pageSize }],
    },
  });

  const [result] = await Registration.aggregate<{
    total: { n: number }[];
    items: (IRegistration & {
      primaryUser?: { name: string; email: string; rollNumber: string | null };
      teamDoc?: { name: string; memberCount: number };
      payment?: { status: RegistrationRowDTO['payment']['status']; reference: string | null; amountDue: number; submittedAt: Date | null };
    })[];
  }>(pipeline);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total: result?.total[0]?.n ?? 0,
    items: (result?.items ?? []).map((r) => ({
      id: String(r._id),
      code: r.code,
      kind: r.kind,
      status: r.status,
      name: r.teamDoc?.name ?? r.primaryUser?.name ?? 'Unknown',
      teamName: r.teamDoc?.name ?? null,
      memberCount: r.teamDoc?.memberCount ?? 1,
      primaryEmail: r.primaryUser?.email ?? '',
      primaryRollNumber: r.primaryUser?.rollNumber ?? null,
      payment: {
        status: r.payment?.status ?? 'not_required',
        reference: r.payment?.reference ?? null,
        amountDue: r.payment?.amountDue ?? 0,
        submittedAt: iso(r.payment?.submittedAt),
      },
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Flat participant-level rows for exports. */
export async function participantRows(eventId: Types.ObjectId) {
  const regs = await Registration.find({ event: eventId }).sort({ code: 1 }).lean();
  const teamIds = regs.map((r) => r.team).filter(Boolean) as Types.ObjectId[];
  const [teams, memberships, payments, tickets, checkins] = await Promise.all([
    Team.find({ _id: { $in: teamIds } }).lean(),
    TeamMembership.find({ team: { $in: teamIds } }).lean(),
    PaymentRecord.find({ event: eventId }).lean(),
    Ticket.find({ event: eventId }).lean(),
    CheckIn.find({ event: eventId, active: true }).lean(),
  ]);
  const userIds = new Set<string>(regs.map((r) => String(r.user)));
  memberships.forEach((m) => userIds.add(String(m.user)));
  const users = await User.find({ _id: { $in: [...userIds] } }).lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const teamById = new Map(teams.map((t) => [String(t._id), t]));
  const payByReg = new Map(payments.map((p) => [String(p.registration), p]));
  const checkinByTicket = new Map(checkins.map((c) => [String(c.ticket), c]));

  const rows: {
    reg: IRegistration;
    teamName: string | null;
    user: (typeof users)[number] | undefined;
    isLeader: boolean;
    payment: (typeof payments)[number] | undefined;
    ticket: (typeof tickets)[number] | undefined;
    checkedInAt: Date | null;
  }[] = [];
  for (const reg of regs) {
    const team = reg.team ? teamById.get(String(reg.team)) : undefined;
    const members = reg.team ? memberships.filter((m) => String(m.team) === String(reg.team)).map((m) => m.user) : [reg.user];
    // Disbanded teams have no memberships; still export the registrant.
    const list = members.length ? members : [reg.user];
    for (const uid of list) {
      const ticket =
        tickets.find((t) => String(t.registration) === String(reg._id) && String(t.user) === String(uid) && t.live) ??
        tickets.find((t) => String(t.registration) === String(reg._id) && String(t.user) === String(uid));
      rows.push({
        reg,
        teamName: team?.name ?? null,
        user: userById.get(String(uid)),
        isLeader: String(uid) === String(reg.user),
        payment: payByReg.get(String(reg._id)),
        ticket,
        checkedInAt: ticket ? (checkinByTicket.get(String(ticket._id))?.at ?? null) : null,
      });
    }
  }
  return rows;
}
