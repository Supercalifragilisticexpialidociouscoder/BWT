import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { H, iso, login, publishedEvent, seedWorld, setupDb, teardownDb, type Agent, type World } from '../helpers';
import { AuditLog, Event, Registration, Team, TeamMembership, User, VenueAllocation } from '../../src/models';

let w: World;
let orgA: Agent;
beforeAll(async () => {
  await setupDb();
  w = await seedWorld();
  orgA = await login(w.app, 'orga@test.dev');
});
afterAll(teardownDb);

// Fixed future weekday window inside the "Room" venue's opening hours (Mon–Fri 09:00–17:00 IST).
function nextMonday(hh: number, mm = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7);
  d.setUTCHours(hh - 5, mm - 30, 0, 0); // IST = UTC+05:30
  return d.toISOString();
}

describe('venue booking', () => {
  it('detects a clash including the turnover buffer, and explains it', async () => {
    const a = await publishedEvent(orgA, w.orgA, { title: 'Morning Talk', startsAt: nextMonday(10), endsAt: nextMonday(12), registrationDeadline: nextMonday(9) });
    const b = await publishedEvent(orgA, w.orgA, { title: 'Late Morning', startsAt: nextMonday(12, 15), endsAt: nextMonday(13, 30), registrationDeadline: nextMonday(9) });
    await orgA.post(`/api/events/${a}/allocations`).set(H).send({ venueId: String(w.venues.Hall) }).expect(201);
    const clash = await orgA.post(`/api/events/${b}/allocations`).set(H).send({ venueId: String(w.venues.Hall) });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('venue_conflict');
    expect(clash.body.error.message).toMatch(/Morning Talk/);
    expect(clash.body.error.message).toMatch(/30-minute turnover/);
  });

  it('allows only one of two simultaneous bookings for overlapping events', async () => {
    const ids = await Promise.all(
      [1, 2].map((i) => publishedEvent(orgA, w.orgA, { title: `Race ${i}`, startsAt: nextMonday(14), endsAt: nextMonday(16), registrationDeadline: nextMonday(9) })),
    );
    for (let round = 0; round < 5; round++) {
      await VenueAllocation.deleteMany({ event: { $in: ids } });
      const results = await Promise.all(ids.map((id) => orgA.post(`/api/events/${id}/allocations`).set(H).send({ venueId: String(w.venues.Lab) })));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await VenueAllocation.countDocuments({ event: { $in: ids }, venue: w.venues.Lab })).toBe(1);
    }
  });

  it('respects opening hours', async () => {
    const id = await publishedEvent(orgA, w.orgA, { title: 'Evening', startsAt: nextMonday(18), endsAt: nextMonday(20), registrationDeadline: nextMonday(9) });
    const res = await orgA.post(`/api/events/${id}/allocations`).set(H).send({ venueId: String(w.venues.Room) });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Outside opening hours/);
  });

  it('blocks moving a booked event onto a clashing time', async () => {
    const x = await publishedEvent(orgA, w.orgA, { title: 'Fixed', startsAt: nextMonday(9, 30), endsAt: nextMonday(11), registrationDeadline: nextMonday(9) });
    const y = await publishedEvent(orgA, w.orgA, { title: 'Movable', startsAt: nextMonday(14), endsAt: nextMonday(15), registrationDeadline: nextMonday(9) });
    await orgA.post(`/api/events/${x}/allocations`).set(H).send({ venueId: String(w.venues.Room) }).expect(201);
    await orgA.post(`/api/events/${y}/allocations`).set(H).send({ venueId: String(w.venues.Room) }).expect(201);
    const detail = await orgA.get(`/api/events/${y}`);
    const body = { ...detail.body, organization: detail.body.organization.id, startsAt: nextMonday(10), endsAt: nextMonday(11, 30), registrationDeadline: nextMonday(9) };
    const res = await orgA.put(`/api/events/${y}`).set(H).send(body);
    expect(res.status).toBe(409);
    expect((await Event.findById(y).lean())!.startsAt.toISOString()).toBe(nextMonday(14));
  });

  it('suggests the best-fitting free room with reasons', async () => {
    const id = await publishedEvent(orgA, w.orgA, { title: 'Needs computers', startsAt: nextMonday(10), endsAt: nextMonday(12), registrationDeadline: nextMonday(9), requiredFacilities: ['computers'], expectedAttendance: 50 });
    const res = await orgA.post(`/api/events/${id}/allocations/suggest`).set(H).send({});
    expect(res.status).toBe(200);
    expect(res.body.selected.venue.name).toBe('Lab');
    expect(res.body.candidates.find((c: { venue: { name: string } }) => c.venue.name === 'Room').blockers.join(' ')).toMatch(/Missing computers/);
  });
});

describe('CSV reconciliation', () => {
  let eventId: string;
  const file = readFileSync(path.resolve(__dirname, '../../../docs/samples/registration-export-sample.csv'));

  async function uploadAndAnalyze(decisions: Record<string, string> = {}) {
    const up = await orgA.post(`/api/events/${eventId}/imports`).set(H).attach('file', file, { filename: 'export.csv', contentType: 'text/csv' });
    expect(up.status).toBe(201);
    const body = { mapping: up.body.suggestedMapping, options: { layout: 'auto', treatPaidAsVerified: false }, decisions };
    const analysis = await orgA.post(`/api/events/${eventId}/imports/${up.body.batchId}/analyze`).set(H).send(body);
    return { up: up.body, analysis: analysis.body, body };
  }

  beforeAll(async () => {
    eventId = await publishedEvent(orgA, w.orgA, { title: 'Imported Hack', teamSize: { min: 2, max: 4 }, capacity: 50, startsAt: iso(60 * 48), endsAt: iso(60 * 56), registrationDeadline: iso(60 * 40) });
  });

  it('refuses to commit while review items are undecided', async () => {
    const { up, analysis, body } = await uploadAndAnalyze();
    expect(analysis.canCommit).toBe(false);
    expect(analysis.totals.reviews).toBeGreaterThan(0);
    const res = await orgA.post(`/api/events/${eventId}/imports/${up.batchId}/commit`).set(H).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('review_required');
  });

  it('commits after decisions, creating people, teams and registrations with an audit record', async () => {
    const first = await uploadAndAnalyze();
    const decisions = Object.fromEntries(first.analysis.issues.filter((i: { review?: unknown }) => i.review).map((i: { review: { id: string; default: string } }) => [i.review.id, i.review.default]));
    const { up, analysis, body } = await uploadAndAnalyze(decisions);
    expect(analysis.canCommit).toBe(true);
    const res = await orgA.post(`/api/events/${eventId}/imports/${up.batchId}/commit`).set(H).send(body);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(analysis.totals.create);
    expect(res.body.created).toBeGreaterThan(3);
    expect(await Registration.countDocuments({ event: eventId, source: 'import' })).toBe(res.body.created);
    const imported = await User.findOne({ email: 'arjun.mehta@example.edu' }).lean();
    expect(imported!.claimed).toBe(false);
    expect(await AuditLog.exists({ action: 'import.committed', event: eventId })).toBeTruthy();
    // Committing the same batch twice is refused.
    expect((await orgA.post(`/api/events/${eventId}/imports/${up.batchId}/commit`).set(H).send(body)).status).toBe(409);
  });

  it('is idempotent: re-importing the same file creates nothing new', async () => {
    const before = await Registration.countDocuments({ event: eventId });
    const teamsBefore = await Team.countDocuments({ event: eventId });
    const membersBefore = await TeamMembership.countDocuments({ event: eventId });
    const first = await uploadAndAnalyze();
    expect(first.up.previousImportOfSameFile).not.toBeNull();
    const decisions = Object.fromEntries(first.analysis.issues.filter((i: { review?: unknown }) => i.review).map((i: { review: { id: string; default: string } }) => [i.review.id, i.review.default]));
    const { analysis } = await uploadAndAnalyze(decisions);
    expect(analysis.totals.create).toBe(0);
    expect(analysis.totals.unchanged).toBeGreaterThan(0);
    expect(await Registration.countDocuments({ event: eventId })).toBe(before);
    expect(await Team.countDocuments({ event: eventId })).toBe(teamsBefore);
    expect(await TeamMembership.countDocuments({ event: eventId })).toBe(membersBefore);
  });

  it('lets an imported participant claim their account by signing up', async () => {
    const { default: request } = await import('supertest');
    const res = await request(w.app).post('/api/auth/signup').set(H).send({ name: 'Arjun Mehta', email: 'arjun.mehta@example.edu', password: 'a-long-password' });
    expect(res.status).toBe(201);
    const regs = await request.agent(w.app).get('/api/me/registrations').set('Cookie', String(res.headers['set-cookie']).split(';')[0]!);
    expect(regs.body.some((r: { event: { id: string } }) => r.event.id === eventId)).toBe(true);
  });
});

describe('organizer overview signals', () => {
  it('flags events near capacity and registrations closing soon, from real counts', async () => {
    const id = await publishedEvent(orgA, w.orgA, { title: 'Almost Full', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' }, capacity: 3, registrationDeadline: iso(60 * 20), startsAt: iso(60 * 30), endsAt: iso(60 * 34) });
    for (const p of ['p5', 'p6', 'p7']) await (await login(w.app, `${p}@test.dev`)).post(`/api/events/${id}/register`).set(H).send({});
    const ov = await orgA.get('/api/workspace/overview').query({ event: id });
    const kinds = ov.body.attention.filter((a: { eventId: string }) => a.eventId === id).map((a: { kind: string; message: string }) => `${a.kind}: ${a.message}`);
    expect(kinds).toContain('near_capacity: Full — all 3 places taken');
    expect(kinds.some((k: string) => k.startsWith('deadline_soon: Registration closes in'))).toBe(true);
    expect(ov.body.totals.registrations).toBe(3);
  });
});

describe('reports and exports', () => {
  it('derives figures from records and exports CSV', async () => {
    const id = await publishedEvent(orgA, w.orgA, { title: 'Reported', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' } });
    for (const p of ['p1', 'p2', 'p3']) await (await login(w.app, `${p}@test.dev`)).post(`/api/events/${id}/register`).set(H).send({});
    const report = await orgA.get(`/api/events/${id}/report`);
    expect(report.body.kind).toBe('live_snapshot');
    expect(report.body.registrations.byStatus.confirmed).toBe(3);
    expect(report.body.attendance).toMatchObject({ checkedIn: 0, expected: 3, noShows: null });
    const csv = await orgA.get(`/api/events/${id}/exports/participants.csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="reported-participants-/);
    expect(csv.text.trim().split('\r\n')).toHaveLength(4);
    const early = await orgA.post(`/api/events/${id}/report/finalize`).set(H);
    expect(early.status).toBe(409);
  });

  it('finalizes a finished event and freezes its report', async () => {
    const id = await publishedEvent(orgA, w.orgA, { title: 'Finished', mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' } });
    await (await login(w.app, 'p4@test.dev')).post(`/api/events/${id}/register`).set(H).send({});
    await Event.updateOne({ _id: id }, { $set: { startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000), registrationDeadline: new Date(Date.now() - 7300_000) } });
    const final = await orgA.post(`/api/events/${id}/report/finalize`).set(H);
    expect(final.status).toBe(200);
    expect(final.body.kind).toBe('finalized');
    expect(final.body.attendance.noShows).toBe(1);
    const again = await orgA.get(`/api/events/${id}/report`);
    expect(again.body.finalizedAt).toBe(final.body.finalizedAt);
    expect((await Event.findById(id).lean())!.status).toBe('completed');
  });
});
