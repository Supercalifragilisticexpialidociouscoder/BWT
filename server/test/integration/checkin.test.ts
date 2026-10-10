import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { H, iso, login, publishedEvent, seedWorld, setupDb, teardownDb, type Agent, type World } from '../helpers';
import { initRealtime } from '../../src/realtime/socket';
import { attachIo } from '../../src/realtime/bus';
import { CheckIn, Event, Ticket } from '../../src/models';
import { signTicket } from '../../src/lib/crypto';

let w: World;
let orgA: Agent;
let vol: Agent;
let eventId: string;
let otherEventId: string;
const tokens: Record<string, { token: string; ticketId: string }> = {};

async function ticketFor(email: string, evId: string) {
  const a = await login(w.app, email);
  const reg = await a.post(`/api/events/${evId}/register`).set(H).send({});
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  const ticketId = reg.body.participants[0].ticket.id as string;
  const t = await a.get(`/api/tickets/${ticketId}`);
  return { token: t.body.qrPayload as string, ticketId, regId: reg.body.id as string, agent: a };
}

beforeAll(async () => {
  await setupDb();
  w = await seedWorld();
  orgA = await login(w.app, 'orga@test.dev');
  const individual = { mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' } };
  // In progress: started 30 minutes ago so check-in is open.
  eventId = await publishedEvent(orgA, w.orgA, { ...individual, title: 'Live Event', registrationDeadline: iso(30), startsAt: iso(45), endsAt: iso(300) });
  otherEventId = await publishedEvent(orgA, w.orgA, { ...individual, title: 'Other Event', startsAt: iso(60 * 24), endsAt: iso(60 * 28), registrationDeadline: iso(60 * 20) });
  await orgA.put(`/api/events/${eventId}/staff`).set(H).send({ staff: [{ email: 'volunteer@test.dev', role: 'checkin' }] });
  for (const p of ['p1', 'p2', 'p3', 'p4']) tokens[p] = await ticketFor(`${p}@test.dev`, eventId);
  tokens.other = await ticketFor('p5@test.dev', otherEventId);
  await Event.updateOne({ _id: eventId }, { $set: { startsAt: new Date(Date.now() - 30 * 60_000) } });
  vol = await login(w.app, 'volunteer@test.dev');
});
afterAll(async () => {
  attachIo(null);
  await teardownDb();
});

describe('ticket validation', () => {
  it('admits a valid ticket and records who scanned it', async () => {
    const res = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: tokens.p1!.token });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('valid');
    expect(res.body.checkedInBy.name).toBe('volunteer');
    const ticket = await Ticket.findById(tokens.p1!.ticketId).lean();
    expect(ticket!.status).toBe('checked_in');
  });

  it('reports a repeat scan as already checked in, with the original time', async () => {
    const res = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: tokens.p1!.token });
    expect(res.status).toBe(409);
    expect(res.body.outcome).toBe('already_checked_in');
    expect(res.body.checkedInAt).toBeDefined();
  });

  it('records exactly one check-in when 25 volunteers scan the same ticket at once', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: tokens.p2!.token })));
    expect(results.filter((r) => r.body.outcome === 'valid')).toHaveLength(1);
    expect(results.filter((r) => r.body.outcome === 'already_checked_in')).toHaveLength(24);
    expect(await CheckIn.countDocuments({ ticket: tokens.p2!.ticketId, active: true })).toBe(1);
    expect(await CheckIn.countDocuments({ ticket: tokens.p2!.ticketId })).toBe(1);
  });

  it('distinguishes forged, unknown and wrong-event tickets', async () => {
    const forged = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: `${tokens.p3!.token.slice(0, -2)}xx` });
    expect(forged.status).toBe(404);
    expect(forged.body.outcome).toBe('invalid');
    const unknown = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: signTicket('6ac94119f6033a81b51f9249') });
    expect(unknown.body.outcome).toBe('invalid');
    const wrong = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: tokens.other!.token });
    expect(wrong.status).toBe(422);
    expect(wrong.body.outcome).toBe('wrong_event');
    expect(wrong.body.message).toMatch(/Other Event/);
  });

  it('refuses tickets of cancelled registrations as not eligible', async () => {
    const p4 = await login(w.app, 'p4@test.dev');
    await p4.post(`/api/registrations/${(tokens.p4 as unknown as { regId: string }).regId}/cancel`).set(H).send({});
    const res = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: tokens.p4!.token });
    expect(res.status).toBe(422);
    expect(res.body.outcome).toBe('not_eligible');
    expect(res.body.reason).toBe('ticket_void');
  });

  it('refuses scans before the check-in window opens', async () => {
    const res = await orgA.post(`/api/events/${otherEventId}/checkins`).set(H).send({ token: tokens.other!.token });
    expect(res.body.outcome).toBe('not_eligible');
    expect(res.body.reason).toBe('window_not_open');
  });

  it('supports manual check-in by ticket id from a lookup', async () => {
    const lookup = await vol.get(`/api/events/${eventId}/lookup`).query({ q: 'p3' });
    expect(lookup.status).toBe(200);
    const hit = lookup.body.find((r: { ticketId: string }) => r.ticketId === tokens.p3!.ticketId);
    expect(hit).toBeDefined();
    const res = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ ticketId: hit.ticketId });
    expect(res.body.outcome).toBe('valid');
    expect(res.body.method).toBe('manual');
  });

  it('lets only managers correct a check-in, keeps the record, and allows a fresh scan afterwards', async () => {
    const record = await CheckIn.findOne({ ticket: tokens.p1!.ticketId, active: true }).lean();
    expect((await vol.post(`/api/checkins/${record!._id}/void`).set(H).send({ reason: 'Wrong person scanned' })).status).toBe(404);
    expect((await orgA.post(`/api/checkins/${record!._id}/void`).set(H).send({ reason: 'no' })).status).toBe(400);
    const ok = await orgA.post(`/api/checkins/${record!._id}/void`).set(H).send({ reason: 'Wrong person scanned' });
    expect(ok.status).toBe(200);
    expect(ok.body.active).toBe(false);
    expect(ok.body.voidReason).toBe('Wrong person scanned');
    const again = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: tokens.p1!.token });
    expect(again.body.outcome).toBe('valid');
    expect(await CheckIn.countDocuments({ ticket: tokens.p1!.ticketId })).toBe(2);
  });

  it('reports live totals from the records', async () => {
    const live = await vol.get(`/api/events/${eventId}/live`);
    expect(live.body.expectedParticipants).toBe(3); // p4 cancelled
    expect(live.body.checkedIn).toBe(3);
    expect(live.body.attendanceRate).toBe(1);
    expect(live.body.window.state).toBe('open');
  });
});

describe('real-time channel', () => {
  let server: http.Server;
  let url: string;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    server = http.createServer(w.app);
    initRealtime(server);
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await new Promise((r) => server.close(r));
  });
  const open = (cookie?: string) => {
    const s = connect(url, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, reconnection: false, forceNew: true });
    sockets.push(s);
    return s;
  };
  const subscribe = (s: Socket, id: string) => new Promise<{ ok: boolean; error?: string }>((resolve) => s.emit('subscribe', { eventId: id }, resolve));

  it('refuses connections without a session', async () => {
    const s = open();
    const err = await new Promise<Error>((resolve) => s.on('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
  });

  it('refuses event subscriptions the user is not staff for', async () => {
    const participant = await login(w.app, 'p6@test.dev');
    const s = open(participant.cookie);
    await new Promise<void>((r) => s.on('connect', () => r()));
    expect(await subscribe(s, eventId)).toEqual({ ok: false, error: 'forbidden' });
  });

  it('delivers updates to authorised staff only after the write is stored', async () => {
    const s = open(vol.cookie);
    await new Promise<void>((r) => s.on('connect', () => r()));
    expect(await subscribe(s, eventId)).toEqual({ ok: true });
    const fresh = await ticketFor('p7@test.dev', eventId);
    const received = new Promise<Record<string, unknown>>((resolve) => s.on('event:update', (m) => m.type === 'checkin.created' && resolve(m)));
    const res = await vol.post(`/api/events/${eventId}/checkins`).set(H).send({ token: fresh.token });
    expect(res.body.outcome).toBe('valid');
    const msg = await received;
    expect(msg.eventId).toBe(eventId);
    expect(msg.checkInId).toBe(res.body.checkInId);
    // The message is a hint; the authoritative record exists in the database.
    expect(await CheckIn.exists({ _id: msg.checkInId as string, active: true })).toBeTruthy();
  });
});
