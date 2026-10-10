import { describe, expect, it } from 'vitest';
import { computeParticipation, expectedSlots, participationBlockMessage, slotKey, type ExpectedSlot } from '../../src/modules/documents/status';
import { safeFileName, sniffFile } from '../../src/modules/documents/storage';

const rule = (over: Partial<Parameters<typeof expectedSlots>[0][number]> = {}) => ({
  key: 'letter01',
  required: true,
  reviewRequired: true,
  appliesTo: 'each_member' as const,
  active: true,
  ...over,
});

describe('expected document slots', () => {
  const team = { kind: 'team' as const, registrant: 'lead', members: ['lead', 'm2', 'm3'] };

  it('asks every member for an each-member document', () => {
    expect(expectedSlots([rule()], team).map((s) => s.slot)).toEqual(['letter01:lead', 'letter01:m2', 'letter01:m3']);
  });

  it('asks the team once for a team document, and the registrant for a registrant document', () => {
    expect(expectedSlots([rule({ appliesTo: 'team' })], team).map((s) => s.slot)).toEqual(['letter01:team']);
    expect(expectedSlots([rule({ appliesTo: 'registrant' })], team).map((s) => s.slot)).toEqual(['letter01:lead']);
  });

  it('resolves every scope to the participant for individual registrations', () => {
    const solo = { kind: 'individual' as const, registrant: 'me', members: ['me'] };
    for (const appliesTo of ['team', 'registrant', 'each_member'] as const) {
      expect(expectedSlots([rule({ appliesTo })], solo).map((s) => s.slot)).toEqual(['letter01:me']);
    }
  });

  it('ignores inactive requirements', () => {
    expect(expectedSlots([rule({ active: false })], team)).toEqual([]);
  });
});

describe('participation status', () => {
  const slots = (...defs: Partial<ExpectedSlot>[]): ExpectedSlot[] =>
    defs.map((d, i) => ({ slot: `k${i}:u`, requirementKey: `k${i}`, subject: 'u', required: true, reviewRequired: true, ...d }));
  const doc = (slot: string, status: 'submitted' | 'approved' | 'changes_requested' | 'rejected', version = 1) => ({ slot, status, version });

  it('is not required when the event asks for nothing', () => {
    expect(computeParticipation({ approvalRequired: false, slots: [], documents: [], decision: null }).status).toBe('not_required');
  });

  it('is never approved by registering: with approval on and no documents it waits for the organizer', () => {
    const r = computeParticipation({ approvalRequired: true, slots: [], documents: [], decision: null });
    expect(r.status).toBe('under_review');
    expect(r.readyForDecision).toBe(true);
  });

  it('walks missing → submitted → under review → awaiting decision → approved', () => {
    const s = slots({}, {});
    const step = (documents: ReturnType<typeof doc>[], decision: Parameters<typeof computeParticipation>[0]['decision'] = null) =>
      computeParticipation({ approvalRequired: true, slots: s, documents, decision });
    expect(step([]).status).toBe('not_submitted');
    expect(step([doc('k0:u', 'submitted')]).status).toBe('not_submitted');
    expect(step([doc('k0:u', 'submitted'), doc('k1:u', 'submitted')]).status).toBe('submitted');
    expect(step([doc('k0:u', 'approved'), doc('k1:u', 'submitted')]).status).toBe('under_review');
    const settled = [doc('k0:u', 'approved'), doc('k1:u', 'approved')];
    expect(step(settled)).toMatchObject({ status: 'under_review', readyForDecision: true });
    const decision = { value: 'approved' as const, snapshot: [{ slot: 'k0:u', version: 1 }, { slot: 'k1:u', version: 1 }] };
    expect(step(settled, decision)).toMatchObject({ status: 'approved', readyForDecision: false, decisionCurrent: true });
  });

  it('reports corrections before missing documents', () => {
    const r = computeParticipation({ approvalRequired: true, slots: slots({}, {}), documents: [doc('k0:u', 'changes_requested')], decision: null });
    expect(r.status).toBe('changes_requested');
    expect(r.counts).toMatchObject({ missing: 1, changesRequested: 1 });
  });

  it('a rejected document needs a new file, like a change request', () => {
    expect(computeParticipation({ approvalRequired: false, slots: slots({}), documents: [doc('k0:u', 'rejected')], decision: null }).status).toBe('changes_requested');
  });

  it('an approval stops counting when an approved document is replaced', () => {
    const decision = { value: 'approved' as const, snapshot: [{ slot: 'k0:u', version: 1 }] };
    // Version 2 was uploaded after the approval: it is back to "submitted" and the approval doesn't cover it.
    const r = computeParticipation({ approvalRequired: true, slots: slots({}), documents: [doc('k0:u', 'submitted', 2)], decision });
    expect(r).toMatchObject({ status: 'submitted', decisionCurrent: false });
    // Even once the new version is approved, the participation decision must be made again.
    const again = computeParticipation({ approvalRequired: true, slots: slots({}), documents: [doc('k0:u', 'approved', 2)], decision });
    expect(again).toMatchObject({ status: 'under_review', readyForDecision: true, decisionCurrent: false });
  });

  it('an approval does not cover a document that became due later (e.g. a new team member)', () => {
    const decision = { value: 'approved' as const, snapshot: [{ slot: 'k0:u', version: 1 }] };
    const s = [...slots({}), { slot: 'k0:new', requirementKey: 'k0', subject: 'new', required: true, reviewRequired: true }];
    expect(computeParticipation({ approvalRequired: true, slots: s, documents: [doc('k0:u', 'approved')], decision }).status).toBe('not_submitted');
    expect(
      computeParticipation({ approvalRequired: true, slots: s, documents: [doc('k0:u', 'approved'), doc('k0:new', 'approved')], decision }).status,
    ).toBe('under_review');
  });

  it('a rejection holds regardless of documents', () => {
    const r = computeParticipation({ approvalRequired: true, slots: slots({}), documents: [doc('k0:u', 'approved')], decision: { value: 'rejected', snapshot: [] } });
    expect(r).toMatchObject({ status: 'rejected', readyForDecision: false });
  });

  it('without a separate decision, approval needs a reviewer to approve — uploads alone never approve', () => {
    const noReview = slots({ reviewRequired: false });
    expect(computeParticipation({ approvalRequired: false, slots: noReview, documents: [doc('k0:u', 'submitted')], decision: null }).status).toBe('submitted');
    expect(computeParticipation({ approvalRequired: false, slots: slots({}), documents: [doc('k0:u', 'approved')], decision: null }).status).toBe('approved');
  });

  it('optional documents never make participation conditional, but are still counted for review', () => {
    const s = slots({ required: false });
    expect(computeParticipation({ approvalRequired: false, slots: s, documents: [], decision: null }).status).toBe('not_required');
    const r = computeParticipation({ approvalRequired: false, slots: s, documents: [doc('k0:u', 'submitted')], decision: null });
    expect(r.status).toBe('not_required');
    expect(r.counts.awaitingReview).toBe(1);
    // With a required document alongside, an unreviewed optional one holds the review open.
    const mixed = [...slots({ reviewRequired: false }), { ...s[0]!, slot: 'opt:u' }];
    expect(computeParticipation({ approvalRequired: false, slots: mixed, documents: [doc('k0:u', 'submitted'), doc('opt:u', 'submitted')], decision: null }).status).toBe('submitted');
  });

  it('tells scanners why entry is refused without revealing documents', () => {
    const missing = computeParticipation({ approvalRequired: true, slots: slots({}, {}), documents: [], decision: null });
    expect(participationBlockMessage(missing)).toMatch(/2 required documents are missing/);
    expect(participationBlockMessage({ status: 'rejected', counts: missing.counts, readyForDecision: false })).toMatch(/not approved by the organizers/);
  });

  it('slot keys mark team documents explicitly', () => {
    expect(slotKey('abc', null)).toBe('abc:team');
    expect(slotKey('abc', 'u1')).toBe('abc:u1');
  });
});

describe('document files', () => {
  it('identifies files by content, not by name', () => {
    expect(sniffFile(Buffer.from('%PDF-1.7\n...'))).toBe('pdf');
    expect(sniffFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpg');
    expect(sniffFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('png');
    // A Windows executable, a shell script and HTML renamed to .pdf are all refused.
    expect(sniffFile(Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'))).toBeNull();
    expect(sniffFile(Buffer.from('#!/bin/sh\nrm -rf /\n'))).toBeNull();
    expect(sniffFile(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    // A ZIP is only accepted as a template if it is a Word document.
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);
    expect(sniffFile(zip)).toBeNull();
    expect(sniffFile(Buffer.concat([zip, Buffer.from('[Content_Types].xml word/document.xml')]))).toBe('docx');
  });

  it('keeps download names safe and consistent with the content', () => {
    expect(safeFileName('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
    expect(safeFileName('C:\\Users\\me\\Permission Letter.PDF', 'pdf')).toBe('Permission Letter.pdf');
    expect(safeFileName('undertaking.pdf.exe', 'pdf')).toBe('undertaking.pdf.pdf');
    expect(safeFileName('scan<script>.png', 'jpg')).toBe('scan-script.jpg');
    expect(safeFileName('\u0000\u0007', 'png')).toBe('document.png');
    expect(safeFileName(undefined, 'pdf')).toBe('document.pdf');
  });
});
