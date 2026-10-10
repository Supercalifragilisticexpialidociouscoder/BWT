import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { H, PASSWORD, eventInput, login, publishedEvent, seedWorld, setupDb, teardownDb, type World } from '../helpers';
import { Session, User } from '../../src/models';

let w: World;
beforeAll(async () => {
  await setupDb();
  w = await seedWorld();
});
afterAll(teardownDb);

describe('authentication', () => {
  it('rejects state-changing requests without the client header (CSRF guard)', async () => {
    const res = await request(w.app).post('/api/auth/login').send({ email: 'p1@test.dev', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_rejected');
  });

  it('validates signup input with field messages', async () => {
    const res = await request(w.app).post('/api/auth/signup').set(H).send({ name: 'A', email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fields)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('signs up, sets an httpOnly session cookie and never stores the plain password', async () => {
    const res = await request(w.app).post('/api/auth/signup').set(H).send({ name: 'New Person', email: 'New.Person@Test.dev', password: 'a-long-password', department: 'CSE', rollNumber: '24new001' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new.person@test.dev');
    expect(res.body.user.rollNumber).toBe('24NEW001');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/cf_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const stored = await User.findOne({ email: 'new.person@test.dev' }).select('+passwordHash').lean();
    expect(stored!.passwordHash).toMatch(/^scrypt\$/);
    expect(stored!.passwordHash).not.toContain('a-long-password');
    const session = await Session.findOne({ user: stored!._id }).lean();
    expect(session!.tokenHash).toHaveLength(64);
    expect(cookie).not.toContain(session!.tokenHash);
  });

  it('refuses a duplicate email and unknown departments', async () => {
    const dup = await request(w.app).post('/api/auth/signup').set(H).send({ name: 'Again', email: 'p1@test.dev', password: 'a-long-password' });
    expect(dup.status).toBe(409);
    const dept = await request(w.app).post('/api/auth/signup').set(H).send({ name: 'Dept', email: 'dept@test.dev', password: 'a-long-password', department: 'XYZ' });
    expect(dept.status).toBe(400);
    expect(dept.body.error.details.fields.department).toBeDefined();
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const a = await request(w.app).post('/api/auth/login').set(H).send({ email: 'p1@test.dev', password: 'wrong-password' });
    const b = await request(w.app).post('/api/auth/login').set(H).send({ email: 'ghost@test.dev', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('reports the session, then ends it on logout', async () => {
    const agent = await login(w.app, 'p1@test.dev');
    const s = await agent.get('/api/auth/session');
    expect(s.body.user.email).toBe('p1@test.dev');
    expect(s.body.access.canOrganize).toBe(false);
    await agent.post('/api/auth/logout').set(H).expect(204);
    const after = await agent.get('/api/auth/session');
    expect(after.body.user).toBeNull();
  });

  it('logout revokes the session on the server: a replayed cookie is refused, other sessions survive', async () => {
    const laptop = await login(w.app, 'p1@test.dev');
    const phone = await login(w.app, 'p1@test.dev');
    const before = await Session.countDocuments({ user: (await User.findOne({ email: 'p1@test.dev' }))!._id });

    const out = await laptop.post('/api/auth/logout').set(H);
    expect(out.status).toBe(204);
    // The browser is told to drop the cookie…
    const cleared = String(out.headers['set-cookie']);
    expect(cleared).toMatch(/cf_sid=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    // …and the token is dead even if something kept a copy.
    expect((await request(w.app).get('/api/me/registrations').set('Cookie', laptop.cookie)).status).toBe(401);
    expect((await request(w.app).get('/api/auth/session').set('Cookie', laptop.cookie)).body.user).toBeNull();
    expect(await Session.countDocuments({ user: (await User.findOne({ email: 'p1@test.dev' }))!._id })).toBe(before - 1);

    // Signing out on one device does not sign the person out everywhere.
    expect((await request(w.app).get('/api/me/registrations').set('Cookie', phone.cookie)).status).toBe(200);
  });

  it('logout is idempotent and still needs the client header', async () => {
    expect((await request(w.app).post('/api/auth/logout').set(H)).status).toBe(204);
    // Without the header a cross-site page could sign people out.
    const forced = await request(w.app).post('/api/auth/logout');
    expect(forced.status).toBe(403);
    expect(forced.body.error.code).toBe('csrf_rejected');
  });

  it('requires authentication for protected endpoints', async () => {
    await request(w.app).get('/api/me/registrations').expect(401);
    await request(w.app).get('/api/workspace/events').expect(401);
    await request(w.app).post('/api/events').set(H).send({}).expect(401);
  });
});

describe('authorization', () => {
  it('only organizers can create events, and only for their own organizations', async () => {
    const participant = await login(w.app, 'p2@test.dev');
    expect((await participant.post('/api/events').set(H).send(eventInput(w.orgA))).status).toBe(403);
    const orgB = await login(w.app, 'orgb@test.dev');
    const wrongOrg = await orgB.post('/api/events').set(H).send(eventInput(w.orgA));
    expect(wrongOrg.status).toBe(403);
  });

  it('prevents another organizer from reading or changing an event by id', async () => {
    const orgA = await login(w.app, 'orga@test.dev');
    const orgB = await login(w.app, 'orgb@test.dev');
    const draft = await orgA.post('/api/events').set(H).send(eventInput(w.orgA, { title: 'Private draft' }));
    expect(draft.status).toBe(201);
    // Drafts are invisible to others: 404, not 403, so existence is not revealed.
    expect((await orgB.get(`/api/events/${draft.body.id}`)).status).toBe(404);
    expect((await orgB.put(`/api/events/${draft.body.id}`).set(H).send(eventInput(w.orgB))).status).toBe(404);

    const eventId = await publishedEvent(orgA, w.orgA, { title: 'Public event' });
    expect((await orgB.get(`/api/events/${eventId}`)).status).toBe(200);
    expect((await orgB.put(`/api/events/${eventId}`).set(H).send(eventInput(w.orgA))).status).toBe(403);
    expect((await orgB.get(`/api/events/${eventId}/registrations`)).status).toBe(403);
    expect((await orgB.post(`/api/events/${eventId}/status`).set(H).send({ status: 'cancelled' })).status).toBe(403);
    expect((await orgB.get(`/api/events/${eventId}/exports/registrations.csv`)).status).toBe(403);
  });

  it('lets an admin manage any event and grants staff exactly the assigned rights', async () => {
    const orgA = await login(w.app, 'orga@test.dev');
    const eventId = await publishedEvent(orgA, w.orgA, { title: 'Staffed event' });
    await orgA.put(`/api/events/${eventId}/staff`).set(H).send({ staff: [{ email: 'volunteer@test.dev', role: 'checkin' }] }).expect(200);
    const vol = await login(w.app, 'volunteer@test.dev');
    expect((await vol.get(`/api/events/${eventId}/live`)).status).toBe(200);
    expect((await vol.get(`/api/events/${eventId}/registrations`)).status).toBe(403);
    expect((await vol.put(`/api/events/${eventId}/staff`).set(H).send({ staff: [] })).status).toBe(403);
    const admin = await login(w.app, 'admin@test.dev');
    expect((await admin.get(`/api/events/${eventId}/registrations`)).status).toBe(200);
  });

  it('rejects malformed ids and invalid query input safely', async () => {
    const orgA = await login(w.app, 'orga@test.dev');
    expect((await orgA.get('/api/events/not-an-id/registrations')).status).toBe(404);
    expect((await orgA.get('/api/registrations/%24where')).status).toBe(404);
    const bad = await request(w.app).get('/api/events').query({ pageSize: 5000 });
    expect(bad.status).toBe(400);
    const injection = await request(w.app).post('/api/auth/login').set(H).send({ email: { $ne: null }, password: { $ne: null } });
    expect(injection.status).toBe(400);
  });
});
