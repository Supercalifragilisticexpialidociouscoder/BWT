import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { H, iso, login, publishedEvent, seedWorld, setupDb, teardownDb, type Agent, type World } from '../helpers';
import { Event, Team, Ticket } from '../../src/models';

let w: World;
let orgA: Agent;
beforeAll(async () => {
  await setupDb();
  w = await seedWorld();
  orgA = await login(w.app, 'orga@test.dev');
});
afterAll(teardownDb);

describe('event validation', () => {
  it('rejects inconsistent dates and unknown categories with field paths', async () => {
    const res = await orgA.post('/api/events').set(H).send({
      title: 'Bad', organization: String(w.orgA), category: 'nope', summary: 'short summary text', startsAt: iso(120), endsAt: iso(60), registrationDeadline: iso(30), mode: 'team', teamSize: { min: 4, max: 2 }, capacity: 5, fee: { amount: 0 },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toHaveProperty('endsAt');
    expect(res.body.error.details.fields).toHaveProperty(['teamSize.min']);
  });
  it('keeps drafts out of the public directory until published', async () => {
    const draft = await orgA.post('/api/events').set(H).send({ ...(await import('../helpers')).eventInput(w.orgA, { title: 'Hidden Draft' }) });
    const list = await orgA.get('/api/events').query({ q: 'Hidden Draft' });
    expect(list.body.total).toBe(0);
    await orgA.post(`/api/events/${draft.body.id}/status`).set(H).send({ status: 'published' }).expect(200);
    expect((await orgA.get('/api/events').query({ q: 'Hidden Draft' })).body.total).toBe(1);
  });
});

describe('individual registration', () => {
  it('confirms a free registration immediately and issues one ticket', async () => {
    const eventId = await publishedEvent(orgA, w.orgA, { title: 'Free Workshop', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' }, capacity: 3 });
    const p1 = await login(w.app, 'p1@test.dev');
    const reg = await p1.post(`/api/events/${eventId}/register`).set(H).send({});
    expect(reg.status).toBe(201);
    expect(reg.body.status).toBe('confirmed');
    expect(reg.body.participants[0].ticket.status).toBe('active');
    const again = await p1.post(`/api/events/${eventId}/register`).set(H).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_registered');
  });

  it('never exceeds capacity under concurrent registrations', async () => {
    const eventId = await publishedEvent(orgA, w.orgA, { title: 'Tiny Room', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' }, capacity: 3 });
    const agents = await Promise.all([2, 3, 4, 5, 6, 7, 8].map((i) => login(w.app, `p${i}@test.dev`)));
    const results = await Promise.all(agents.map((a) => a.post(`/api/events/${eventId}/register`).set(H).send({})));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(3);
    expect(results.filter((r) => r.status === 409 && r.body.error.code === 'registration_full').length).toBe(4);
    const ev = await Event.findById(eventId).lean();
    expect(ev!.counters.activeRegistrations).toBe(3);
  });

  it('enforces department eligibility and required profile fields', async () => {
    const eventId = await publishedEvent(orgA, w.orgA, { title: 'CSE Only', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' }, allowedDepartments: ['CSE'] });
    const ece = await login(w.app, 'ece@test.dev');
    const r1 = await ece.post(`/api/events/${eventId}/register`).set(H).send({});
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('not_eligible');
    const noroll = await login(w.app, 'noroll@test.dev');
    const r2 = await noroll.post(`/api/events/${eventId}/register`).set(H).send({});
    expect(r2.status).toBe(400);
    expect(r2.body.error.details.fields['profile.rollNumber']).toBeDefined();
    const r3 = await noroll.post(`/api/events/${eventId}/register`).set(H).send({ profile: { rollNumber: '24FIX001' } });
    expect(r3.status).toBe(201);
  });

  it('refuses registration after the deadline', async () => {
    const eventId = await publishedEvent(orgA, w.orgA, { title: 'Closed', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' }, registrationDeadline: iso(30) });
    await Event.updateOne({ _id: eventId }, { $set: { registrationDeadline: new Date(Date.now() - 60_000) } });
    const p9 = await login(w.app, 'p9@test.dev');
    const r = await p9.post(`/api/events/${eventId}/register`).set(H).send({});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('registration_closed');
  });
});

describe('team registration, payments and tickets', () => {
  let eventId: string;
  let leader: Agent;
  let regId: string;
  let code: string;

  it('creates a team that is incomplete until it reaches the minimum size', async () => {
    eventId = await publishedEvent(orgA, w.orgA, { title: 'Team Hack', teamSize: { min: 2, max: 3 }, capacity: 5 });
    leader = await login(w.app, 'p1@test.dev');
    const res = await leader.post(`/api/events/${eventId}/teams`).set(H).send({ name: 'Null Pointers' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('incomplete');
    expect(res.body.team.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(res.body.payment).toMatchObject({ required: true, status: 'pending', amountDue: 40000 });
    regId = res.body.id;
    code = res.body.team.code;
  });

  it('rejects a duplicate team name in the same event', async () => {
    const other = await login(w.app, 'p10@test.dev');
    const res = await other.post(`/api/events/${eventId}/teams`).set(H).send({ name: 'null pointers' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('team_name_taken');
  });

  it('lets members join by code (formatted or not) up to the maximum, even under concurrency', async () => {
    const preview = await leader.get('/api/teams/preview').query({ code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}` });
    expect(preview.status).toBe(200);
    expect(preview.body.joinable).toBe(true);
    const joiners = await Promise.all([2, 3, 4, 5].map((i) => login(w.app, `p${i}@test.dev`)));
    const results = await Promise.all(joiners.map((a) => a.post('/api/teams/join').set(H).send({ code })));
    expect(results.filter((r) => r.status === 201).length).toBe(2); // max 3 incl. leader
    expect(results.filter((r) => r.status === 409 && r.body.error.code === 'team_full').length).toBe(2);
    const team = await Team.findOne({ code }).lean();
    expect(team!.memberCount).toBe(3);
  });

  it('prevents joining two teams in one event', async () => {
    const p2 = await login(w.app, 'p2@test.dev');
    const own = await p2.post(`/api/events/${eventId}/teams`).set(H).send({ name: 'Second Team' });
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('already_in_team');
  });

  it('refuses expired codes', async () => {
    const p11 = await login(w.app, 'p11@test.dev');
    const t = await p11.post(`/api/events/${eventId}/teams`).set(H).send({ name: 'Expiring' });
    await Team.updateOne({ _id: t.body.team.id }, { $set: { codeExpiresAt: new Date(Date.now() - 1000) } });
    const p12 = await login(w.app, 'p12@test.dev');
    const r = await p12.post('/api/teams/join').set(H).send({ code: t.body.team.code });
    expect(r.status).toBe(410);
  });

  it('moves through payment submission and verification to confirmed, issuing a ticket per member', async () => {
    const reg = await leader.get(`/api/registrations/${regId}`);
    expect(reg.body.status).toBe('pending');
    expect(reg.body.statusReason).toMatch(/not yet submitted/);
    const member = await login(w.app, reg.body.participants.find((p: { isLeader: boolean; email: string | null }) => !p.isLeader).id ? 'p2@test.dev' : 'p3@test.dev');
    // Only the leader submits the reference.
    expect((await member.post(`/api/registrations/${regId}/payment`).set(H).send({ reference: '412345678901' })).status).toBe(403);
    const sub = await leader.post(`/api/registrations/${regId}/payment`).set(H).send({ reference: '412345678901', payerName: 'P One' });
    expect(sub.status).toBe(200);
    expect(sub.body.statusReason).toMatch(/awaiting organizer verification/);
    // A participant cannot verify their own payment.
    expect((await leader.post(`/api/registrations/${regId}/payment/decision`).set(H).send({ decision: 'verified' })).status).toBe(404);
    // Two organizers verifying at once: exactly one decision is recorded.
    const admin = await login(w.app, 'admin@test.dev');
    const [a, b] = await Promise.all([
      orgA.post(`/api/registrations/${regId}/payment/decision`).set(H).send({ decision: 'verified' }),
      admin.post(`/api/registrations/${regId}/payment/decision`).set(H).send({ decision: 'verified' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const final = await orgA.get(`/api/registrations/${regId}`);
    expect(final.body.status).toBe('confirmed');
    expect(final.body.payment.decidedBy).toBeTruthy();
    expect(final.body.participants.every((p: { ticket: { status: string } | null }) => p.ticket?.status === 'active')).toBe(true);
    expect(await Ticket.countDocuments({ registration: regId, live: true })).toBe(3);
  });

  it('voids a member’s ticket when they leave and re-evaluates the team', async () => {
    const reg = await orgA.get(`/api/registrations/${regId}`);
    const member = reg.body.participants.find((p: { isLeader: boolean }) => !p.isLeader);
    const res = await leader.delete(`/api/teams/${reg.body.team.id}/members/${member.id}`).set(H);
    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(2);
    expect(await Ticket.countDocuments({ registration: regId, user: member.id, live: true })).toBe(0);
    expect(res.body.status).toBe('confirmed'); // still at the minimum of 2
  });

  it('flags a payment reference reused by another registration', async () => {
    const other = await login(w.app, 'p11@test.dev');
    const mine = (await other.get('/api/me/registrations')).body.find((r: { event: { id: string } }) => r.event.id === eventId);
    await other.post(`/api/registrations/${mine.id}/payment`).set(H).send({ reference: '412-345678901' });
    const detail = await orgA.get(`/api/registrations/${mine.id}`);
    expect(detail.body.payment.duplicateReferenceOf.length).toBe(1);
  });

  it('cancels, releasing capacity, disbanding the team and voiding tickets', async () => {
    const before = (await Event.findById(eventId).lean())!.counters.activeRegistrations;
    const res = await leader.post(`/api/registrations/${regId}/cancel`).set(H).send({ reason: 'Plans changed' });
    expect(res.body.status).toBe('cancelled');
    expect((await Event.findById(eventId).lean())!.counters.activeRegistrations).toBe(before - 1);
    expect(await Ticket.countDocuments({ registration: regId, live: true })).toBe(0);
    expect((await Team.findById(res.body.team.id).lean())!.status).toBe('disbanded');
    // The name is free again and former members may form a new team.
    const p1 = await login(w.app, 'p1@test.dev');
    expect((await p1.post(`/api/events/${eventId}/teams`).set(H).send({ name: 'Null Pointers' })).status).toBe(201);
  });
});

describe('approval workflow', () => {
  it('keeps registrations pending until an organizer approves', async () => {
    const eventId = await publishedEvent(orgA, w.orgA, { title: 'Expo', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' }, requiresApproval: true });
    const p7 = await login(w.app, 'p7@test.dev');
    const reg = await p7.post(`/api/events/${eventId}/register`).set(H).send({});
    expect(reg.body.status).toBe('pending');
    expect(reg.body.participants[0].ticket).toBeNull();
    const rejectNoReason = await orgA.post(`/api/registrations/${reg.body.id}/review`).set(H).send({ decision: 'reject' });
    expect(rejectNoReason.status).toBe(400);
    const ok = await orgA.post(`/api/registrations/${reg.body.id}/review`).set(H).send({ decision: 'approve' });
    expect(ok.body.status).toBe('confirmed');
    expect(ok.body.participants[0].ticket.status).toBe('active');
  });
});

describe('participant privacy', () => {
  it('hides other people’s registrations and tickets', async () => {
    const eventId = await publishedEvent(orgA, w.orgA, { title: 'Privacy', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' } });
    const p8 = await login(w.app, 'p8@test.dev');
    const reg = await p8.post(`/api/events/${eventId}/register`).set(H).send({});
    const ticketId = reg.body.participants[0].ticket.id;
    const p9 = await login(w.app, 'p9@test.dev');
    expect((await p9.get(`/api/registrations/${reg.body.id}`)).status).toBe(404);
    expect((await p9.get(`/api/tickets/${ticketId}`)).status).toBe(404);
    expect((await p9.post(`/api/registrations/${reg.body.id}/cancel`).set(H).send({})).status).toBe(404);
    const own = await p8.get(`/api/tickets/${ticketId}`);
    expect(own.body.qrPayload).toMatch(/^CF1\.[a-f0-9]{24}\./);
    expect(own.body.qrPayload).not.toContain('p8');
  });
});
