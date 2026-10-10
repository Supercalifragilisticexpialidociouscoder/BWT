import { Router } from 'express';
import type { Types } from 'mongoose';
import {
  CancelRegistrationSchema,
  CreateTeamSchema,
  JoinTeamSchema,
  PaymentDecisionSchema,
  PaymentRefundSchema,
  PaymentSubmitSchema,
  RegisterIndividualSchema,
  RegistrationListQuerySchema,
  RenameTeamSchema,
  ReviewDecisionSchema,
  TransferLeaderSchema,
  teamCodeField,
  type TicketDTO,
} from '@campusflow/shared';
import { CheckIn, Event, Registration, Team, TeamMembership, Ticket, User, Venue, VenueAllocation, type ITicket } from '../../models';
import { signTicket } from '../../lib/crypto';
import { notFound } from '../../lib/errors';
import { iso, oid, parse, requireUser } from '../../lib/http';
import { loadEventFor } from '../../lib/access';
import { requireAuth, type AuthUser } from '../../middleware/auth';
import {
  cancelRegistration,
  createTeam,
  decidePayment,
  joinTeam,
  listRegistrations,
  loadRegistrationFor,
  myRegistrations,
  previewTeam,
  refundPayment,
  registerIndividual,
  registrationDTO,
  removeMember,
  reviewRegistration,
  submitPayment,
  transferLeader,
  updateTeam,
} from './service';

export const registrationsRouter = Router();

/* ---------------------------------------------------------------- participant */

registrationsRouter.post('/events/:id/register', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'view');
  const { profile } = parse(RegisterIndividualSchema, req.body ?? {});
  const reg = await registerIndividual(user, event.toObject(), profile);
  res.status(201).json(await registrationDTO(reg._id, user));
});

registrationsRouter.post('/events/:id/teams', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'view');
  const { name, profile } = parse(CreateTeamSchema, req.body);
  const reg = await createTeam(user, event.toObject(), name, profile);
  res.status(201).json(await registrationDTO(reg._id, user));
});

registrationsRouter.get('/teams/preview', requireAuth, async (req, res) => {
  const code = parse(teamCodeField, req.query.code);
  res.json(await previewTeam(code));
});

registrationsRouter.post('/teams/join', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { code, profile } = parse(JoinTeamSchema, req.body);
  const reg = await joinTeam(user, code, profile);
  res.status(201).json(await registrationDTO(reg._id, user));
});

async function teamRegistration(teamId: Types.ObjectId) {
  const team = await Team.findById(teamId).select('registration').lean();
  if (!team?.registration) throw notFound('Team');
  return team.registration;
}

async function assertTeamVisible(user: AuthUser, teamId: Types.ObjectId) {
  const regId = await teamRegistration(teamId);
  await loadRegistrationFor(user, regId, 'view');
  return regId;
}

registrationsRouter.patch('/teams/:id', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const teamId = oid(req.params.id, 'Team');
  const regId = await assertTeamVisible(user, teamId);
  const { name } = parse(RenameTeamSchema, req.body);
  await updateTeam(user, teamId, { name });
  res.json(await registrationDTO(regId, user));
});

registrationsRouter.post('/teams/:id/rotate-code', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const teamId = oid(req.params.id, 'Team');
  const regId = await assertTeamVisible(user, teamId);
  await updateTeam(user, teamId, { rotateCode: true });
  res.json(await registrationDTO(regId, user));
});

registrationsRouter.post('/teams/:id/leader', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const teamId = oid(req.params.id, 'Team');
  const regId = await assertTeamVisible(user, teamId);
  const { userId } = parse(TransferLeaderSchema, req.body);
  await transferLeader(user, teamId, oid(userId, 'User'));
  res.json(await registrationDTO(regId, user));
});

registrationsRouter.delete('/teams/:id/members/:userId', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const teamId = oid(req.params.id, 'Team');
  const regId = await assertTeamVisible(user, teamId);
  await removeMember(user, teamId, oid(req.params.userId, 'User'));
  const stillVisible = await loadRegistrationFor(user, regId, 'view').then(() => true, () => false);
  if (stillVisible) res.json(await registrationDTO(regId, user));
  else res.status(204).end();
});

registrationsRouter.get('/me/registrations', requireAuth, async (req, res) => {
  res.json(await myRegistrations(requireUser(req)));
});

registrationsRouter.get('/registrations/:id', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'view');
  res.json(await registrationDTO(reg._id, user));
});

registrationsRouter.post('/registrations/:id/cancel', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'view');
  const { reason } = parse(CancelRegistrationSchema, req.body ?? {});
  await cancelRegistration(user, reg._id, reason);
  res.json(await registrationDTO(reg._id, user));
});

registrationsRouter.post('/registrations/:id/payment', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'view');
  const input = parse(PaymentSubmitSchema, req.body);
  await submitPayment(user, reg, input);
  res.json(await registrationDTO(reg._id, user));
});

/* ---------------------------------------------------------------- organizer */

registrationsRouter.post('/registrations/:id/payment/decision', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'manage');
  const { decision, note } = parse(PaymentDecisionSchema, req.body);
  await decidePayment(user, reg, decision, note);
  res.json(await registrationDTO(reg._id, user));
});

registrationsRouter.post('/registrations/:id/payment/refund', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'manage');
  const { note } = parse(PaymentRefundSchema, req.body);
  await refundPayment(user, reg, note);
  res.json(await registrationDTO(reg._id, user));
});

registrationsRouter.post('/registrations/:id/review', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'manage');
  const { decision, note } = parse(ReviewDecisionSchema, req.body);
  await reviewRegistration(user, reg, decision, note);
  res.json(await registrationDTO(reg._id, user));
});

registrationsRouter.get('/events/:id/registrations', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const query = parse(RegistrationListQuerySchema, req.query);
  res.json(await listRegistrations(event._id, query));
});

registrationsRouter.get('/events/:id/teams', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
  const teams = await Team.find({ event: event._id, status: 'active' }).sort({ name: 1 }).lean();
  const [memberships, regs, checkins] = await Promise.all([
    TeamMembership.find({ event: event._id }).lean(),
    Registration.find({ _id: { $in: teams.map((t) => t.registration) } }).select('code status statusReason').lean(),
    CheckIn.find({ event: event._id, active: true }).select('user').lean(),
  ]);
  const users = await User.find({ _id: { $in: memberships.map((m) => m.user) } }).select('name rollNumber department email').lean();
  const u = new Map(users.map((x) => [String(x._id), x]));
  const r = new Map(regs.map((x) => [String(x._id), x]));
  const arrived = new Set(checkins.map((c) => String(c.user)));
  const rows = teams
    .map((t) => ({
      id: String(t._id),
      name: t.name,
      code: t.code,
      codeExpiresAt: t.codeExpiresAt.toISOString(),
      memberCount: t.memberCount,
      complete: t.memberCount >= event.teamSize.min,
      registration: t.registration && r.get(String(t.registration))
        ? { id: String(t.registration), code: r.get(String(t.registration))!.code, status: r.get(String(t.registration))!.status, statusReason: r.get(String(t.registration))!.statusReason }
        : null,
      members: memberships
        .filter((m) => String(m.team) === String(t._id))
        .sort((a, b) => (a.role === 'leader' ? -1 : b.role === 'leader' ? 1 : a.joinedAt.getTime() - b.joinedAt.getTime()))
        .map((m) => ({
          id: String(m.user),
          name: u.get(String(m.user))?.name ?? 'Unknown',
          email: u.get(String(m.user))?.email ?? '',
          rollNumber: u.get(String(m.user))?.rollNumber ?? null,
          department: u.get(String(m.user))?.department ?? null,
          isLeader: m.role === 'leader',
          joinedAt: m.joinedAt.toISOString(),
          checkedIn: arrived.has(String(m.user)),
        })),
    }))
    .filter((t) => (filter === 'incomplete' ? !t.complete : filter === 'complete' ? t.complete : true));
  res.json({ teamSize: event.teamSize, teams: rows });
});

/* ---------------------------------------------------------------- tickets */

async function ticketDTO(t: ITicket): Promise<TicketDTO> {
  const [event, reg, team, user, alloc] = await Promise.all([
    Event.findById(t.event).lean(),
    Registration.findById(t.registration).select('code status').lean(),
    t.team ? Team.findById(t.team).select('name').lean() : Promise.resolve(null),
    User.findById(t.user).select('name').lean(),
    VenueAllocation.findOne({ event: t.event, status: 'confirmed' }).sort({ startsAt: 1 }).lean(),
  ]);
  const venue = alloc ? await Venue.findById(alloc.venue).lean() : null;
  return {
    id: String(t._id),
    shortCode: t.shortCode,
    status: t.status,
    qrPayload: signTicket(String(t._id)),
    checkedInAt: iso(t.checkedInAt),
    participant: { id: String(t.user), name: user?.name ?? '' },
    registration: { id: String(t.registration), code: reg?.code ?? '', status: reg?.status ?? 'cancelled' },
    team: team ? { id: String(team._id), name: team.name } : null,
    event: {
      id: String(event!._id),
      title: event!.title,
      slug: event!.slug,
      startsAt: event!.startsAt.toISOString(),
      endsAt: event!.endsAt.toISOString(),
      venue: venue ? { id: String(venue._id), name: venue.name, building: venue.building, roomCode: venue.roomCode } : null,
      checkInOpensMinutesBefore: event!.checkInOpensMinutesBefore,
    },
  };
}

registrationsRouter.get('/me/tickets', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const tickets = await Ticket.find({ user: user._id, status: { $ne: 'void' } }).sort({ issuedAt: -1 }).limit(50).lean();
  res.json(await Promise.all(tickets.map(ticketDTO)));
});

/** Only the ticket holder can obtain the signed QR payload. */
registrationsRouter.get('/tickets/:id', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const ticket = await Ticket.findById(oid(req.params.id, 'Ticket')).lean();
  if (!ticket || String(ticket.user) !== String(user._id)) throw notFound('Ticket');
  res.json(await ticketDTO(ticket));
});
