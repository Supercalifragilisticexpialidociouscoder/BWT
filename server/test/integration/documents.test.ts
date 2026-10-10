import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { H, iso, login, publishedEvent, seedWorld, setupDb, teardownDb, type Agent, type World } from '../helpers';
import type { DocumentSlotDTO } from '@campusflow/shared';
import { AuditLog, Event, ParticipantDocument, Registration, Ticket } from '../../src/models';

/**
 * Event document requirements, private submissions, review, participation approval and the optional
 * check-in gate — exercised through the HTTP API against a real database and the private file store.
 */

const DOC_DIR = path.resolve('test/.documents');
const PDF = (label = 'test') => Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff', 'latin1');

let w: World;
let org: Agent; // organizer of club A (manages the events)
let otherOrg: Agent; // organizer of club B (no access)
let vol: Agent; // check-in volunteer on the event
let lead: Agent; // p1 — team leader
let member: Agent; // p2 — team member
let outsider: Agent; // p3 — not in the team
let eventId: string;
let regId: string;
let ids = { lead: '', member: '' };
let keys: { letter: string; undertaking: string; nomination: string };

async function userId(a: Agent) {
  return (await a.get('/api/auth/session')).body.user.id as string;
}
const docs = (a: Agent) => a.get(`/api/registrations/${regId}/documents`);
const upload = (a: Agent, slot: string, buf: Buffer, filename = 'letter.pdf', contentType = 'application/pdf') =>
  a.post(`/api/registrations/${regId}/documents/${slot}`).set(H).attach('file', buf, { filename, contentType });
type Slot = DocumentSlotDTO & { document: NonNullable<DocumentSlotDTO['document']> };
const slotOf = (body: { slots: DocumentSlotDTO[] }, key: string, subject: string | null) =>
  body.slots.find((s) => s.requirementKey === key && (s.subject?.id ?? null) === subject) as Slot;

beforeAll(async () => {
  await setupDb();
  await rm(DOC_DIR, { recursive: true, force: true }); // test scratch only
  w = await seedWorld();
  org = await login(w.app, 'orga@test.dev');
  otherOrg = await login(w.app, 'orgb@test.dev');
  eventId = await publishedEvent(org, w.orgA, {
    title: 'Outstation Hackathon',
    fee: { amount: 0, basis: 'per_registration' },
    teamSize: { min: 2, max: 3 },
    registrationDeadline: iso(60 * 24),
    startsAt: iso(60 * 48),
    endsAt: iso(60 * 56),
  });
  await org.put(`/api/events/${eventId}/staff`).set(H).send({ staff: [{ email: 'volunteer@test.dev', role: 'checkin' }] });
  vol = await login(w.app, 'volunteer@test.dev');
  lead = await login(w.app, 'p1@test.dev');
  member = await login(w.app, 'p2@test.dev');
  outsider = await login(w.app, 'p3@test.dev');
  ids = { lead: await userId(lead), member: await userId(member) };
});
afterAll(async () => {
  await chmod(DOC_DIR, 0o700).catch(() => undefined);
  await teardownDb();
});

describe('document requirements (organizer configuration)', () => {
  const config = (over: Record<string, unknown> = {}) => ({
    approvalRequired: true,
    checkInRequiresApproval: false,
    requirements: [
      { type: 'permission_letter', name: 'Participation permission letter', description: 'Signed by your HOD on department letterhead.', required: true, appliesTo: 'each_member', deadline: null, formats: ['pdf'], reviewRequired: true },
      { type: 'guardian_undertaking', name: 'Parent / guardian undertaking', description: 'Use the institution’s form.', required: true, appliesTo: 'each_member', deadline: null, formats: ['pdf', 'jpg', 'png'], reviewRequired: true },
      { type: 'other', name: 'Team nomination', description: '', required: false, appliesTo: 'team', deadline: null, formats: ['pdf'], reviewRequired: true },
    ],
    ...over,
  });

  it('only this event’s organizers can read or change document settings', async () => {
    for (const a of [lead, vol, otherOrg]) {
      expect([403, 404]).toContain((await a.get(`/api/events/${eventId}/documents/config`)).status);
      expect([403, 404]).toContain((await a.put(`/api/events/${eventId}/documents/config`).set(H).send(config())).status);
    }
    expect((await request(w.app).put(`/api/events/${eventId}/documents/config`).set(H).send(config())).status).toBe(401);
  });

  it('refuses a check-in gate without participation approval, with a field message', async () => {
    const res = await org.put(`/api/events/${eventId}/documents/config`).set(H).send(config({ approvalRequired: false, checkInRequiresApproval: true }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.checkInRequiresApproval).toMatch(/participation approval/);
  });

  it('refuses requirement keys the server didn’t issue', async () => {
    const c = config();
    (c.requirements[0] as Record<string, unknown>).key = 'zzzzzzzz';
    expect((await org.put(`/api/events/${eventId}/documents/config`).set(H).send(c)).status).toBe(400);
  });

  it('saves requirements with server-assigned keys and audits the change', async () => {
    const res = await org.put(`/api/events/${eventId}/documents/config`).set(H).send(config());
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(3);
    for (const r of res.body.requirements) expect(r.key).toMatch(/^[a-z0-9]{8}$/);
    expect(res.body.storageAvailable).toBe(true);
    keys = { letter: res.body.requirements[0].key, undertaking: res.body.requirements[1].key, nomination: res.body.requirements[2].key };
    expect(await AuditLog.exists({ action: 'documents.config_updated', event: eventId })).toBeTruthy();
  });

  it('shows prospective participants what they will need, with no invented wording', async () => {
    const res = await request(w.app).get(`/api/events/${eventId}`);
    expect(res.body.documents.approvalRequired).toBe(true);
    expect(res.body.documents.requirements.map((r: { name: string }) => r.name)).toEqual(['Participation permission letter', 'Parent / guardian undertaking', 'Team nomination']);
    expect(res.body.documents.requirements[1].template).toBeNull();
  });
});

describe('participant submission', () => {
  it('registering never approves participation, and documents don’t touch registration status', async () => {
    const team = await lead.post(`/api/events/${eventId}/teams`).set(H).send({ name: 'Paper Planes' });
    expect(team.status).toBe(201);
    regId = team.body.id;
    const joined = await member.post('/api/teams/join').set(H).send({ code: team.body.team.code });
    expect(joined.body.status).toBe('confirmed'); // free + complete: confirmed, tickets issued as before
    expect(joined.body.participation).toMatchObject({ status: 'not_submitted', approvalRequired: true, counts: { required: 4, missing: 4 } });
    expect(await Ticket.countDocuments({ registration: regId, live: true })).toBe(2);

    const res = await docs(lead);
    expect(res.status).toBe(200);
    // Two people × two personal documents + one optional team document.
    expect(res.body.slots).toHaveLength(5);
    expect(res.body.participation.status).toBe('not_submitted');
  });

  it('only the person a document is about can upload it; team documents only by the leader', async () => {
    const own = slotOf((await docs(member)).body, keys.letter, ids.lead);
    expect(own.canUpload).toBe(false);
    expect((await upload(member, own.slot, PDF())).status).toBe(403);
    expect((await upload(member, `${keys.nomination}:team`, PDF())).status).toBe(403);
    expect((await upload(outsider, `${keys.letter}:${ids.lead}`, PDF())).status).toBe(404);
    expect((await upload(lead, `${keys.letter}:aaaaaaaaaaaaaaaaaaaaaaaa`, PDF())).status).toBe(404);
  });

  it('identifies files by content: executables and wrong formats are refused and nothing is kept', async () => {
    const before = await ParticipantDocument.countDocuments();
    const exe = await upload(lead, `${keys.letter}:${ids.lead}`, EXE, 'letter.pdf', 'application/pdf');
    expect(exe.status).toBe(415);
    expect(exe.body.error.code).toBe('unsupported_file');
    // A real PNG where only PDF is accepted.
    expect((await upload(lead, `${keys.letter}:${ids.lead}`, PNG, 'letter.png', 'image/png')).status).toBe(415);
    expect((await upload(lead, `${keys.letter}:${ids.lead}`, Buffer.alloc(0))).status).toBe(415);
    expect(await ParticipantDocument.countDocuments()).toBe(before);
  });

  it('refuses files over the size limit', async () => {
    const big = Buffer.concat([PDF(), Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(lead, `${keys.letter}:${ids.lead}`, big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('file_too_large');
  });

  it('stores an accepted file privately under a random name, with server-side identity and time', async () => {
    const t0 = Date.now();
    const res = await upload(lead, `${keys.letter}:${ids.lead}`, PDF('lead letter'), '../../My Letter.PDF');
    expect(res.status).toBe(201);
    const slot = slotOf(res.body, keys.letter, ids.lead);
    expect(slot.status).toBe('submitted');
    expect(slot.document.file.name).toBe('My Letter.pdf');
    expect(slot.document.history[0]).toMatchObject({ action: 'submitted', by: { id: ids.lead }, version: 1 });
    expect(new Date(slot.document.history[0]!.at).getTime()).toBeGreaterThanOrEqual(t0 - 1000);

    const stored = await ParticipantDocument.findById(slot.document.id).lean();
    expect(stored!.file.storedName).not.toContain('My Letter');
    expect(stored!.file.sha256).toHaveLength(64);
    const onDisk = path.join(DOC_DIR, stored!.file.storedName);
    expect((await stat(onDisk)).isFile()).toBe(true);
    // Nothing about it is reachable through the public uploads mount.
    expect((await request(w.app).get(`/uploads/${stored!.file.storedName}`)).status).toBe(404);
    expect((await request(w.app).get(`/uploads/../${path.basename(DOC_DIR)}/${stored!.file.storedName}`)).status).toBe(404);
  });

  it('serves a document only to its owner and this event’s organizers', async () => {
    const id = slotOf((await docs(lead)).body, keys.letter, ids.lead).document.id;
    const own = await lead.get(`/api/documents/${id}/file`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect(own.headers['content-disposition']).toMatch(/^attachment; filename="My Letter.pdf"/);
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect((await org.get(`/api/documents/${id}/file`)).status).toBe(200);
    // A teammate, an unrelated participant, a check-in volunteer and another club's organizer can't tell it exists.
    for (const a of [member, outsider, vol, otherOrg]) expect((await a.get(`/api/documents/${id}/file`)).status).toBe(404);
    expect((await request(w.app).get(`/api/documents/${id}/file`)).status).toBe(401);
    // The teammate sees that the document is in, but not the document.
    const seen = slotOf((await docs(member)).body, keys.letter, ids.lead);
    expect(seen).toMatchObject({ status: 'submitted', canView: false, document: null });
  });

  it('team documents are uploaded by the leader and visible to the whole team', async () => {
    const res = await upload(lead, `${keys.nomination}:team`, PDF('nomination'));
    expect(res.status).toBe(201);
    const id = slotOf(res.body, keys.nomination, null).document.id;
    expect((await member.get(`/api/documents/${id}/file`)).status).toBe(200);
    expect((await outsider.get(`/api/documents/${id}/file`)).status).toBe(404);
  });

  it('volunteers can’t list a registration’s documents', async () => {
    expect([403, 404]).toContain((await docs(vol)).status);
    expect([403, 404]).toContain((await docs(outsider)).status);
  });
});

describe('organizer review', () => {
  const review = (a: Agent, id: string, body: Record<string, unknown>) => a.post(`/api/documents/${id}/review`).set(H).send(body);
  let letterId: string;

  it('requires a reason to ask for changes, and only organizers can review', async () => {
    letterId = slotOf((await docs(org)).body, keys.letter, ids.lead).document.id;
    expect((await review(org, letterId, { action: 'request_changes', note: '', version: 1, expectedStatus: 'submitted' })).status).toBe(400);
    for (const a of [vol, lead, otherOrg]) {
      expect((await review(a, letterId, { action: 'approve', version: 1, expectedStatus: 'submitted' })).status).toBe(404);
    }
  });

  it('records a change request with reviewer and comment; the participant sees it', async () => {
    const res = await review(org, letterId, { action: 'request_changes', note: 'The HOD signature is missing.', version: 1, expectedStatus: 'submitted' });
    expect(res.status).toBe(200);
    expect(res.body.participation.status).toBe('changes_requested');
    const mine = slotOf((await docs(lead)).body, keys.letter, ids.lead);
    expect(mine.status).toBe('changes_requested');
    expect(mine.document.review).toMatchObject({ by: { name: 'orga' }, note: 'The HOD signature is missing.' });
    expect(mine.canUpload).toBe(true);
  });

  it('refuses a decision on a version the reviewer didn’t open', async () => {
    const replaced = await upload(lead, `${keys.letter}:${ids.lead}`, PDF('signed letter'));
    expect(slotOf(replaced.body, keys.letter, ids.lead)).toMatchObject({ status: 'submitted', document: { version: 2 } });
    const stale = await review(org, letterId, { action: 'approve', version: 1, expectedStatus: 'changes_requested' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('document_replaced');
  });

  it('lets only one of two simultaneous reviewers decide', async () => {
    const admin = await login(w.app, 'admin@test.dev');
    const results = await Promise.all([
      review(org, letterId, { action: 'approve', version: 2, expectedStatus: 'submitted' }),
      review(admin, letterId, { action: 'reject', note: 'Wrong form', version: 2, expectedStatus: 'submitted' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('already_reviewed');
    // Put it in a known state for what follows.
    const now = await ParticipantDocument.findById(letterId).lean();
    if (now!.status !== 'approved') {
      await review(org, letterId, { action: 'request_changes', note: 'Please re-send', version: 2, expectedStatus: now!.status });
      await upload(lead, `${keys.letter}:${ids.lead}`, PDF('v3'));
      expect((await review(org, letterId, { action: 'approve', version: 3, expectedStatus: 'submitted' })).status).toBe(200);
    }
  });

  it('comments are kept in the history without changing status', async () => {
    const doc = await ParticipantDocument.findById(letterId).lean();
    const res = await review(org, letterId, { action: 'comment', note: 'Keep the original for the trip.', version: doc!.version, expectedStatus: doc!.status });
    expect(res.status).toBe(200);
    const after = await ParticipantDocument.findById(letterId).lean();
    expect(after!.status).toBe('approved');
    expect(after!.history.at(-1)).toMatchObject({ action: 'commented', note: 'Keep the original for the trip.' });
  });

  it('lists registrations by participation state', async () => {
    const list = (f: string) => org.get(`/api/events/${eventId}/registrations?participation=${f}`).then((r) => r.body.items.map((i: { id: string }) => i.id));
    expect(await list('docs_missing')).toEqual([regId]);
    expect(await list('awaiting_review')).toEqual([regId]); // the team nomination
    expect(await list('approved')).toEqual([]);
    const row = (await org.get(`/api/events/${eventId}/registrations`)).body.items[0];
    expect(row.participation).toMatchObject({ status: 'not_submitted', missing: 3, awaitingReview: 1 });
  });
});

describe('participation approval', () => {
  const decide = (a: Agent, body: Record<string, unknown>) => a.post(`/api/registrations/${regId}/participation`).set(H).send(body);
  const rev = async () => (await docs(org)).body.participation.rev as number;
  const approveAll = async () => {
    const body = (await docs(org)).body;
    for (const s of body.slots) {
      if (s.document && s.status === 'submitted') {
        await org.post(`/api/documents/${s.document.id}/review`).set(H).send({ action: 'approve', version: s.document.version, expectedStatus: 'submitted' });
      }
    }
  };

  it('can’t be approved while documents are missing or unreviewed', async () => {
    const res = await decide(org, { action: 'approve', rev: await rev() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_ready');
    expect(res.body.error.message).toMatch(/3 required documents are still missing/);
  });

  it('is approved explicitly once documents are complete, by organizers only', async () => {
    await upload(lead, `${keys.undertaking}:${ids.lead}`, PNG, 'undertaking.png', 'image/png');
    await upload(member, `${keys.letter}:${ids.member}`, PDF('member letter'));
    await upload(member, `${keys.undertaking}:${ids.member}`, PDF('member undertaking'));
    await approveAll();
    const state = (await docs(org)).body.participation;
    expect(state).toMatchObject({ status: 'under_review', readyForDecision: true });

    expect([403, 404]).toContain((await decide(lead, { action: 'approve', rev: state.rev })).status);
    expect([403, 404]).toContain((await decide(vol, { action: 'approve', rev: state.rev })).status);
    const stale = await decide(org, { action: 'approve', rev: state.rev - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale');

    const ok = await decide(org, { action: 'approve', note: 'All clear', rev: state.rev });
    expect(ok.status).toBe(200);
    expect(ok.body.participation).toMatchObject({ status: 'approved', decision: { value: 'approved', by: { name: 'orga' }, current: true } });
    const reg = await Registration.findById(regId).lean();
    expect(reg!.status).toBe('confirmed');
    expect(reg!.participation.status).toBe('approved');
    expect((await lead.get(`/api/registrations/${regId}`)).body.participation.status).toBe('approved');
  });

  it('replacing an approved document sends it back to review and suspends the approval', async () => {
    const res = await upload(member, `${keys.letter}:${ids.member}`, PDF('member letter, corrected'));
    const slot = slotOf(res.body, keys.letter, ids.member);
    expect(slot.status).toBe('submitted');
    expect(slot.document.history.at(-1)).toMatchObject({ action: 'replaced', note: 'Replaced an approved version — back to review' });
    expect(res.body.participation).toMatchObject({ status: 'under_review', decision: { value: 'approved', current: false } });
    const stored = await ParticipantDocument.findById(slot.document.id).lean();
    expect(stored!.previous).toHaveLength(1);
    expect(stored!.previous[0]).toMatchObject({ version: 1, statusWhenReplaced: 'approved' });
    // Organizers can still open the earlier version; the participant can't.
    expect((await org.get(`/api/documents/${slot.document.id}/file?version=1`)).status).toBe(200);
    expect((await member.get(`/api/documents/${slot.document.id}/file?version=1`)).status).toBe(404);

    // Approving the new file alone does not restore participation approval.
    await approveAll();
    expect((await docs(org)).body.participation).toMatchObject({ status: 'under_review', readyForDecision: true });
    expect((await decide(org, { action: 'approve', rev: await rev() })).status).toBe(200);
  });

  it('declining needs a reason, blocks further uploads, and can be reopened', async () => {
    expect((await decide(org, { action: 'reject', note: '', rev: await rev() })).status).toBe(400);
    const res = await decide(org, { action: 'reject', note: 'Not eligible for outstation travel this term', rev: await rev() });
    expect(res.status).toBe(200);
    expect(res.body.participation.status).toBe('rejected');
    const blocked = await upload(member, `${keys.letter}:${ids.member}`, PDF('again'));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('participation_rejected');
    expect((await Registration.findById(regId).lean())!.status).toBe('confirmed'); // seats and tickets untouched
    const reopened = await decide(org, { action: 'reopen', rev: await rev() });
    expect(reopened.body.participation).toMatchObject({ status: 'under_review', readyForDecision: true, decision: null });
    expect((await decide(org, { action: 'approve', rev: await rev() })).status).toBe(200);
  });

  it('keeps an audit trail of every step', async () => {
    const actions = (await AuditLog.find({ event: eventId }).lean()).map((a) => a.action);
    for (const a of ['document.submitted', 'document.replaced', 'document.changes_requested', 'document.approved', 'document.commented', 'participation.approved', 'participation.rejected', 'participation.reopened']) {
      expect(actions).toContain(a);
    }
  });
});

describe('deadlines, concurrency, templates and storage', () => {
  it('closes uploads after a requirement’s deadline unless organizers asked for a correction', async () => {
    const cfg = (await org.get(`/api/events/${eventId}/documents/config`)).body;
    const requirements = cfg.requirements.map((r: Record<string, unknown>) => ({ ...r, deadline: r.key === keys.nomination ? iso(-60) : r.deadline }));
    expect((await org.put(`/api/events/${eventId}/documents/config`).set(H).send({ ...cfg, requirements })).status).toBe(200);
    const late = await upload(lead, `${keys.nomination}:team`, PDF('late'));
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('deadline_passed');
    const doc = await ParticipantDocument.findOne({ registration: regId, slot: `${keys.nomination}:team` }).lean();
    await org.post(`/api/documents/${doc!._id}/review`).set(H).send({ action: 'request_changes', note: 'Needs the principal’s stamp', version: doc!.version, expectedStatus: doc!.status });
    expect((await upload(lead, `${keys.nomination}:team`, PDF('late but requested'))).status).toBe(201);
  });

  it('handles two simultaneous first uploads to one slot without creating two records', async () => {
    // A third member joins: their personal documents become due.
    const p4 = await login(w.app, 'p4@test.dev');
    const team = (await docs(lead)).body;
    const code = (await lead.get(`/api/registrations/${regId}`)).body.team.code;
    expect((await p4.post('/api/teams/join').set(H).send({ code })).status).toBe(201);
    const p4id = await userId(p4);
    expect((await docs(org)).body.participation.status).toBe('not_submitted');
    expect(team.slots.length).toBeLessThan((await docs(org)).body.slots.length);

    const slot = `${keys.letter}:${p4id}`;
    const results = await Promise.all([upload(p4, slot, PDF('a')), upload(p4, slot, PDF('b'))]);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const records = await ParticipantDocument.find({ registration: regId, slot }).lean();
    expect(records).toHaveLength(1);
    expect(records[0]!.version).toBe(results.filter((r) => r.status === 201).length);
  });

  it('accepts organizer templates (PDF or Word) and lets anyone who can see the event download them', async () => {
    const tpl = (buf: Buffer, name: string) => org.post(`/api/events/${eventId}/documents/requirements/${keys.undertaking}/template`).set(H).attach('file', buf, name);
    expect((await tpl(EXE, 'form.docx')).status).toBe(415);
    const res = await tpl(PDF('institution form'), 'Undertaking form.pdf');
    expect(res.status).toBe(200);
    expect(res.body.requirements.find((r: { key: string }) => r.key === keys.undertaking).template.name).toBe('Undertaking form.pdf');
    const dl = await request(w.app).get(`/api/events/${eventId}/documents/requirements/${keys.undertaking}/template`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect((await lead.post(`/api/events/${eventId}/documents/requirements/${keys.undertaking}/template`).set(H).attach('file', PDF(), 'x.pdf')).status).toBe(403);
  });

  it('keeps a requirement that has submissions when organizers remove it — deactivated, documents intact', async () => {
    const cfg = (await org.get(`/api/events/${eventId}/documents/config`)).body;
    const res = await org.put(`/api/events/${eventId}/documents/config`).set(H).send({ ...cfg, requirements: cfg.requirements.filter((r: { key: string }) => r.key !== keys.nomination) });
    expect(res.status).toBe(200);
    expect(res.body.requirements.find((r: { key: string }) => r.key === keys.nomination)).toMatchObject({ active: false });
    expect(await ParticipantDocument.countDocuments({ registration: regId, requirementKey: keys.nomination })).toBe(1);
    // Participants no longer see it; organizers still can.
    expect((await docs(lead)).body.slots.some((s: { requirementKey: string }) => s.requirementKey === keys.nomination)).toBe(false);
    expect((await docs(org)).body.slots.some((s: { requirementKey: string }) => s.requirementKey === keys.nomination)).toBe(true);
  });

  it('reports unavailable storage instead of pretending the upload worked', async () => {
    const p4 = await login(w.app, 'p4@test.dev');
    const slot = `${keys.undertaking}:${await userId(p4)}`;
    const before = await ParticipantDocument.countDocuments();
    // Make the folder this registration's files go into read-only (a full disk or bad mount behaves alike).
    const folder = path.join(DOC_DIR, 'events', eventId, 'registrations', regId);
    await mkdir(folder, { recursive: true });
    await chmod(folder, 0o500);
    try {
      const res = await upload(p4, slot, PDF());
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('storage_unavailable');
    } finally {
      await chmod(folder, 0o700);
    }
    expect(await ParticipantDocument.countDocuments()).toBe(before);
    expect((await upload(p4, slot, PDF())).status).toBe(201);
  });

  it('writes nothing into the public uploads directory', async () => {
    const pub = await readdir(path.resolve('test/.uploads')).catch(() => [] as string[]);
    expect(pub.filter((f) => f !== 'covers')).toEqual([]);
  });
});

describe('check-in gate (only when the event asks for it)', () => {
  let gated: string;
  let open: string;
  const ticket = async (a: Agent, evId: string) => {
    const reg = await a.post(`/api/events/${evId}/register`).set(H).send({});
    if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
    const t = await a.get(`/api/tickets/${reg.body.participants[0].ticket.id}`);
    return { token: t.body.qrPayload as string, regId: reg.body.id as string, slot: '' };
  };
  const scan = (evId: string, token: string) => vol.post(`/api/events/${evId}/checkins`).set(H).send({ token });

  beforeAll(async () => {
    const individual = { mode: 'individual', teamSize: { min: 1, max: 1 }, fee: { amount: 0, basis: 'per_registration' }, registrationDeadline: iso(30), startsAt: iso(45), endsAt: iso(300) };
    gated = await publishedEvent(org, w.orgA, { ...individual, title: 'Gated Night Event' });
    open = await publishedEvent(org, w.orgA, { ...individual, title: 'Open Night Event' });
    for (const id of [gated, open]) {
      await org.put(`/api/events/${id}/staff`).set(H).send({ staff: [{ email: 'volunteer@test.dev', role: 'checkin' }] });
      await org.put(`/api/events/${id}/documents/config`).set(H).send({
        approvalRequired: true,
        checkInRequiresApproval: id === gated,
        requirements: [{ type: 'guardian_undertaking', name: 'Parent / guardian undertaking', required: true, appliesTo: 'each_member', formats: ['pdf'], reviewRequired: true }],
      });
    }
  });

  it('refuses entry with a reason (and no document details) until participation is approved', async () => {
    const p5 = await login(w.app, 'p5@test.dev');
    const t = await ticket(p5, gated);
    await Event.updateOne({ _id: gated }, { $set: { startsAt: new Date(Date.now() - 30 * 60_000) } });
    const refused = await scan(gated, t.token);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ outcome: 'not_eligible', reason: 'participation_not_approved' });
    expect(refused.body.message).toMatch(/1 required document is missing/);
    expect(refused.body.message).not.toMatch(/undertaking/i);
    expect(await Ticket.findOne({ registration: t.regId }).lean()).toMatchObject({ status: 'active' });

    // Submit, review, approve — then the same QR code admits them, exactly once.
    const own = (await p5.get(`/api/registrations/${t.regId}/documents`)).body.slots[0];
    await p5.post(`/api/registrations/${t.regId}/documents/${own.slot}`).set(H).attach('file', PDF('undertaking'), 'u.pdf');
    const d = (await org.get(`/api/registrations/${t.regId}/documents`)).body.slots[0].document;
    await org.post(`/api/documents/${d.id}/review`).set(H).send({ action: 'approve', version: d.version, expectedStatus: 'submitted' });
    const r = (await org.get(`/api/registrations/${t.regId}/documents`)).body.participation.rev;
    expect((await org.post(`/api/registrations/${t.regId}/participation`).set(H).send({ action: 'approve', rev: r })).status).toBe(200);

    const admitted = await scan(gated, t.token);
    expect(admitted.status).toBe(200);
    expect(admitted.body.outcome).toBe('valid');
    const again = await scan(gated, t.token);
    expect(again.status).toBe(409);
    expect(again.body.outcome).toBe('already_checked_in');
  });

  it('doesn’t affect events that don’t ask for it, even with documents outstanding', async () => {
    const p6 = await login(w.app, 'p6@test.dev');
    const t = await ticket(p6, open);
    await Event.updateOne({ _id: open }, { $set: { startsAt: new Date(Date.now() - 30 * 60_000) } });
    expect((await p6.get(`/api/registrations/${t.regId}`)).body.participation.status).toBe('not_submitted');
    const res = await scan(open, t.token);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('valid');
  });

  it('still reports a repeat scan as a duplicate when the gate is switched on later', async () => {
    // p6 was admitted at the open event; organizers now turn the gate on.
    const cfg = (await org.get(`/api/events/${open}/documents/config`)).body;
    await org.put(`/api/events/${open}/documents/config`).set(H).send({ ...cfg, checkInRequiresApproval: true });
    const reg = await Registration.findOne({ event: open }).lean();
    const t = await Ticket.findOne({ registration: reg!._id }).lean();
    const { signTicket } = await import('../../src/lib/crypto');
    const res = await scan(open, signTicket(String(t!._id)));
    expect(res.status).toBe(409);
    expect(res.body.outcome).toBe('already_checked_in');
  });
});
