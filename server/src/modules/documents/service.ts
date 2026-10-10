import { randomBytes } from 'node:crypto';
import type { HydratedDocument, Types } from 'mongoose';
import {
  LABELS,
  MAX_DOCUMENT_BYTES,
  type DocumentConfigDTO,
  type DocumentConfigInput,
  type DocumentReviewInput,
  type DocumentSlotDTO,
  type DocumentStatus,
  type ParticipationSummaryDTO,
  type PersonRefDTO,
  type RegistrationDocumentsDTO,
} from '@campusflow/shared';
import {
  Event,
  ParticipantDocument,
  Registration,
  TeamMembership,
  User,
  type IDocumentRequirement,
  type IEvent,
  type IParticipantDocument,
  type IParticipation,
  type IRegistration,
  type IStoredFile,
} from '../../models';
import { audit } from '../../lib/audit';
import { eventAccess } from '../../lib/access';
import { AppError, badRequest, conflict, isDuplicateKeyError, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthUser } from '../../middleware/auth';
import { publish } from '../../realtime/bus';
import { requirementDTO } from './dto';
import { computeParticipation, expectedSlots, type ExpectedSlot, type ParticipationResult } from './status';
import { discardUnrecorded, sniffFile, storageAvailable, storeFile } from './storage';

/**
 * Document requirements, participant submissions, review and participation approval.
 *
 * Trust boundaries: who uploads, who reviews, what state a document is in and every timestamp come
 * from the session and the database — never from the request. Requests carry only what the person
 * chose (a file, a decision, a comment) plus the version they were looking at, which is used solely
 * as a precondition so stale decisions are refused instead of silently applied.
 */

type RegLike = Pick<IRegistration, '_id' | 'event' | 'kind' | 'user' | 'team' | 'status'> & { participation?: IParticipation };
type EventLike = Pick<IEvent, '_id' | 'status' | 'documentRequirements' | 'participation' | 'createdBy' | 'organization' | 'staff'>;
type LeanDoc = IParticipantDocument;

const isActiveRegistration = (r: Pick<IRegistration, 'status'>) => r.status !== 'cancelled' && r.status !== 'rejected';
const ZERO_COUNTS = { required: 0, missing: 0, awaitingReview: 0, changesRequested: 0, approved: 0 };

function newRequirementKey(taken: Set<string>): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (;;) {
    const key = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
    if (!taken.has(key)) return key;
  }
}

/* =================================================================== evaluation */

async function participantIds(reg: RegLike): Promise<string[]> {
  if (reg.kind !== 'team' || !reg.team) return [String(reg.user)];
  const members = await TeamMembership.find({ team: reg.team }).sort({ role: 1, joinedAt: 1 }).select('user').lean();
  return members.map((m) => String(m.user));
}

async function evaluate(reg: RegLike, event: Pick<EventLike, 'documentRequirements' | 'participation'>) {
  const members = await participantIds(reg);
  const slots = expectedSlots(event.documentRequirements ?? [], { kind: reg.kind, registrant: String(reg.user), members });
  const docs = await ParticipantDocument.find({ registration: reg._id }).lean<LeanDoc[]>();
  const decision = reg.participation?.decision ?? null;
  const result = computeParticipation({
    approvalRequired: event.participation?.approvalRequired ?? false,
    slots,
    documents: docs.map((d) => ({ slot: d.slot, status: d.status, version: d.version })),
    decision: decision ? { value: decision.value, snapshot: decision.snapshot ?? [] } : null,
  });
  return { members, slots, docs, result };
}

/** Participation computed from the database right now (used by check-in, never trusting stored copies). */
export async function liveParticipation(reg: RegLike, event: Pick<EventLike, 'documentRequirements' | 'participation'>): Promise<ParticipationResult> {
  return (await evaluate(reg, event)).result;
}

function revFilter(p: IParticipation | undefined) {
  return p?.rev === undefined ? { 'participation.rev': { $exists: false } } : { 'participation.rev': p.rev };
}

/**
 * Store the derived participation fields. Every write that can change them bumps `participation.rev`
 * first; this write only lands if `rev` is unchanged since the inputs were read, so an older
 * computation can never overwrite a newer one. On a lost race it simply recomputes.
 */
export async function syncParticipation(regId: Types.ObjectId): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const reg = await Registration.findById(regId).select('event kind user team status participation').lean<RegLike>();
    if (!reg) return;
    const event = await Event.findById(reg.event).select('documentRequirements participation').lean<EventLike>();
    if (!event) return;
    const { result } = await evaluate(reg, event);
    const stored = reg.participation;
    if (
      stored &&
      stored.status === result.status &&
      stored.readyForDecision === result.readyForDecision &&
      JSON.stringify({ ...ZERO_COUNTS, ...stored.counts }) === JSON.stringify(result.counts)
    ) {
      return;
    }
    const res = await Registration.updateOne(
      { _id: regId, ...revFilter(stored) },
      { $set: { 'participation.status': result.status, 'participation.counts': result.counts, 'participation.readyForDecision': result.readyForDecision } },
    );
    if (res.matchedCount) return;
  }
  logger.warn('participation sync kept losing to concurrent changes', { registration: String(regId) });
}

/** Mark the registration's participation inputs as changed, then recompute. */
export async function touchParticipation(regId: Types.ObjectId) {
  await Registration.updateOne({ _id: regId }, { $inc: { 'participation.rev': 1 } });
  await syncParticipation(regId);
}

/** After the event's requirements change: invalidate every registration's stored status, then recompute. */
export async function syncEventParticipation(eventId: Types.ObjectId) {
  await Registration.updateMany({ event: eventId }, { $inc: { 'participation.rev': 1 } });
  const regs = await Registration.find({ event: eventId }).select('_id').lean();
  for (let i = 0; i < regs.length; i += 8) {
    await Promise.all(regs.slice(i, i + 8).map((r) => syncParticipation(r._id)));
  }
}

export function participationSummary(
  reg: { participation?: IParticipation },
  event: Pick<IEvent, 'participation'>,
): ParticipationSummaryDTO {
  const p = reg.participation;
  return {
    status: p?.status ?? 'not_required',
    approvalRequired: event.participation?.approvalRequired ?? false,
    checkInRequiresApproval: event.participation?.checkInRequiresApproval ?? false,
    counts: { ...ZERO_COUNTS, ...(p?.counts ?? {}) },
    readyForDecision: p?.readyForDecision ?? false,
  };
}

/* =================================================================== configuration */

export async function documentConfigDTO(event: Pick<IEvent, '_id' | 'documentRequirements' | 'participation'>): Promise<DocumentConfigDTO> {
  const counts = await ParticipantDocument.aggregate<{ _id: string; n: number }>([
    { $match: { event: event._id } },
    { $group: { _id: '$requirementKey', n: { $sum: 1 } } },
  ]);
  const byKey = new Map(counts.map((c) => [c._id, c.n]));
  return {
    approvalRequired: event.participation?.approvalRequired ?? false,
    checkInRequiresApproval: event.participation?.checkInRequiresApproval ?? false,
    requirements: (event.documentRequirements ?? []).map((r) => ({ ...requirementDTO(r), submissions: byKey.get(r.key) ?? 0 })),
    maxBytes: MAX_DOCUMENT_BYTES,
    storageAvailable: await storageAvailable(),
  };
}

export async function saveDocumentConfig(actor: AuthUser, event: HydratedDocument<IEvent>, input: DocumentConfigInput) {
  const existing = new Map(event.documentRequirements.map((r) => [r.key, r]));
  const unknown = input.requirements.find((r) => r.key && !existing.has(r.key));
  if (unknown) throw new AppError(400, 'validation_failed', 'Unknown document requirement', { fields: { requirements: 'Reload the page — a requirement no longer exists' } });

  const taken = new Set(existing.keys());
  const plain = (r: IDocumentRequirement): IDocumentRequirement =>
    (typeof (r as unknown as { toObject?: () => IDocumentRequirement }).toObject === 'function'
      ? (r as unknown as { toObject: () => IDocumentRequirement }).toObject()
      : r);
  const next: IDocumentRequirement[] = input.requirements.map((r) => {
    const prev = r.key ? plain(existing.get(r.key)!) : undefined;
    const key = r.key ?? newRequirementKey(taken);
    taken.add(key);
    return {
      key,
      type: r.type,
      name: r.name,
      description: r.description,
      required: r.required,
      appliesTo: r.appliesTo,
      deadline: r.deadline ? new Date(r.deadline) : null,
      formats: r.formats,
      reviewRequired: r.reviewRequired,
      active: r.active,
      template: prev?.template ?? null,
      createdAt: prev?.createdAt ?? new Date(),
    };
  });
  // A requirement that already has submissions (or a template) is never dropped: it is kept,
  // deactivated, so its documents stay on record.
  const withDocs = new Set((await ParticipantDocument.distinct('requirementKey', { event: event._id })) as string[]);
  for (const prev of event.documentRequirements) {
    if (!next.some((n) => n.key === prev.key) && (withDocs.has(prev.key) || prev.template)) next.push({ ...plain(prev), active: false });
  }

  const before = { approval: event.participation?.approvalRequired ?? false, gate: event.participation?.checkInRequiresApproval ?? false };
  event.set('documentRequirements', next);
  event.set('participation', { approvalRequired: input.approvalRequired, checkInRequiresApproval: input.checkInRequiresApproval });
  await event.save();

  const active = next.filter((r) => r.active);
  const changes = [
    `${active.length} active document requirement${active.length === 1 ? '' : 's'}`,
    before.approval !== input.approvalRequired ? `participation approval ${input.approvalRequired ? 'on' : 'off'}` : null,
    before.gate !== input.checkInRequiresApproval ? `check-in ${input.checkInRequiresApproval ? 'now requires' : 'no longer requires'} approval` : null,
  ].filter(Boolean);
  await audit({
    actor: actor._id,
    action: 'documents.config_updated',
    entityType: 'Event',
    entityId: event._id,
    event: event._id,
    summary: `Document settings updated: ${changes.join(' · ')}`,
    meta: { requirements: next.map((r) => ({ key: r.key, name: r.name, required: r.required, active: r.active, appliesTo: r.appliesTo })) },
  });
  await syncEventParticipation(event._id);
  return event;
}

export async function saveTemplate(actor: AuthUser, event: HydratedDocument<IEvent>, key: string, file: Express.Multer.File | undefined) {
  const requirement = event.documentRequirements.find((r) => r.key === key);
  if (!requirement) throw notFound('Document requirement');
  if (!file) throw badRequest('Attach the template as a PDF or Word (.docx) file up to 5 MB');
  const kind = sniffFile(file.buffer);
  if (kind !== 'pdf' && kind !== 'docx') throw new AppError(415, 'unsupported_file', 'Templates must be PDF or Word (.docx) files.');
  const stored = await storeFile({ folder: `events/${event._id}/templates`, buffer: file.buffer, kind, originalName: file.originalname, uploadedBy: actor._id });
  const res = await Event.updateOne({ _id: event._id, 'documentRequirements.key': key }, { $set: { 'documentRequirements.$.template': stored } });
  if (!res.matchedCount) {
    await discardUnrecorded(stored);
    throw notFound('Document requirement');
  }
  await audit({
    actor: actor._id,
    action: 'documents.template_uploaded',
    entityType: 'Event',
    entityId: event._id,
    event: event._id,
    summary: `Template “${stored.originalName}” attached to “${requirement.name}”`,
  });
}

/** Detach a template. The file itself is kept on disk for the record. */
export async function removeTemplate(actor: AuthUser, event: HydratedDocument<IEvent>, key: string) {
  const requirement = event.documentRequirements.find((r) => r.key === key);
  if (!requirement) throw notFound('Document requirement');
  await Event.updateOne({ _id: event._id, 'documentRequirements.key': key }, { $set: { 'documentRequirements.$.template': null } });
  await audit({
    actor: actor._id,
    action: 'documents.template_removed',
    entityType: 'Event',
    entityId: event._id,
    event: event._id,
    summary: `Template removed from “${requirement.name}”`,
  });
}

/* =================================================================== submission */

interface Block {
  status: number;
  code: string;
  message: string;
}

/** Why `actor` can't upload into `slot` right now, or null if they can. */
function uploadBlock(opts: {
  actorId: string;
  reg: RegLike;
  event: EventLike;
  slot: ExpectedSlot;
  requirement: IDocumentRequirement | undefined;
  existing: Pick<LeanDoc, 'status'> | null;
  now: Date;
}): Block | null {
  const { actorId, reg, event, slot, requirement, existing, now } = opts;
  const owner = slot.subject ? slot.subject === actorId : String(reg.user) === actorId;
  if (!owner) {
    return {
      status: 403,
      code: 'not_your_document',
      message: slot.subject ? 'Only the person this document is about can upload it.' : 'Only the team leader can upload team documents.',
    };
  }
  if (!requirement?.active) return { status: 409, code: 'requirement_inactive', message: 'The organizers no longer ask for this document.' };
  if (!isActiveRegistration(reg)) return { status: 409, code: 'registration_inactive', message: `This registration is ${reg.status}.` };
  if (event.status === 'cancelled' || event.status === 'completed') return { status: 409, code: 'event_closed', message: `This event is ${event.status}.` };
  if (event.participation?.approvalRequired && reg.participation?.decision?.value === 'rejected') {
    return { status: 409, code: 'participation_rejected', message: 'The organizers did not approve participation. Contact them if you think this is a mistake.' };
  }
  const correctionAsked = existing?.status === 'changes_requested' || existing?.status === 'rejected';
  if (requirement.deadline && now > requirement.deadline && !correctionAsked) {
    return { status: 409, code: 'deadline_passed', message: 'The deadline for this document has passed. Contact the organizers.' };
  }
  return null;
}

function formatList(formats: readonly string[]) {
  const names = formats.map((f) => LABELS.documentFormat[f as keyof typeof LABELS.documentFormat] ?? f);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0]!;
}

/**
 * Store a participant's file for one slot. The first upload creates the slot's record (a unique
 * index makes simultaneous first uploads safe); later uploads replace the file conditionally on the
 * version read, keep the previous file, and send the document back to review.
 */
export async function uploadDocument(actor: AuthUser, regId: Types.ObjectId, slotParam: string, file: Express.Multer.File | undefined) {
  const reg = await Registration.findById(regId).lean<RegLike & IRegistration>();
  if (!reg) throw notFound('Registration');
  const event = await Event.findById(reg.event).lean<EventLike & IEvent>();
  if (!event) throw notFound('Registration');
  const { slots, docs } = await evaluate(reg, event);
  const slot = slots.find((s) => s.slot === slotParam);
  if (!slot) throw notFound('Document requirement');
  const requirement = event.documentRequirements.find((r) => r.key === slot.requirementKey);
  const existing = docs.find((d) => d.slot === slot.slot) ?? null;
  const block = uploadBlock({ actorId: String(actor._id), reg, event, slot, requirement, existing, now: new Date() });
  if (block) throw new AppError(block.status, block.code, block.message);

  if (!file) throw badRequest(`Attach a ${formatList(requirement!.formats)} file up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
  const kind = sniffFile(file.buffer);
  if (!kind || kind === 'docx' || !requirement!.formats.includes(kind)) {
    throw new AppError(
      415,
      'unsupported_file',
      kind && kind !== 'docx'
        ? `This document must be a ${formatList(requirement!.formats)} file.`
        : `That file isn’t a valid ${formatList(requirement!.formats)}. Scan or export the document as ${formatList(requirement!.formats)} and try again.`,
    );
  }

  const stored = await storeFile({
    folder: `events/${event._id}/registrations/${reg._id}`,
    buffer: file.buffer,
    kind,
    originalName: file.originalname,
    uploadedBy: actor._id,
  });
  let saved: LeanDoc;
  try {
    saved = await recordUpload(reg, slot, existing, stored, actor);
  } catch (err) {
    await discardUnrecorded(stored);
    throw err;
  }
  await touchParticipation(reg._id);
  const replaced = saved.version > 1;
  const subject = slot.subject && slot.subject !== String(actor._id) ? await User.findById(slot.subject).select('name').lean() : null;
  await audit({
    actor: actor._id,
    action: replaced ? 'document.replaced' : 'document.submitted',
    entityType: 'ParticipantDocument',
    entityId: saved._id,
    event: event._id,
    summary: `${actor.name} ${replaced ? 'replaced' : 'submitted'} “${requirement!.name}”${subject ? ` for ${subject.name}` : ''} (${reg.code}, v${saved.version})`,
    meta: { registration: String(reg._id), slot: slot.slot, version: saved.version, sha256: stored.sha256 },
  });
  publish(String(event._id), { type: 'registration.changed', registrationId: String(reg._id), status: reg.status });
  return saved;
}

async function recordUpload(reg: RegLike, slot: ExpectedSlot, existing: LeanDoc | null, stored: IStoredFile, actor: AuthUser): Promise<LeanDoc> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = attempt === 0 ? existing : await ParticipantDocument.findOne({ registration: reg._id, slot: slot.slot }).lean<LeanDoc>();
    if (!current) {
      try {
        const created = await ParticipantDocument.create({
          event: reg.event,
          registration: reg._id,
          requirementKey: slot.requirementKey,
          subject: slot.subject,
          slot: slot.slot,
          status: 'submitted',
          version: 1,
          file: stored,
          previous: [],
          review: null,
          history: [{ action: 'submitted', by: actor._id, at: stored.uploadedAt, version: 1, note: null }],
        });
        return created.toObject() as LeanDoc;
      } catch (err) {
        if (isDuplicateKeyError(err)) continue; // someone else's first upload won; replace it instead
        throw err;
      }
    }
    const updated = await ParticipantDocument.findOneAndUpdate(
      { _id: current._id, version: current.version },
      {
        $set: { file: stored, status: 'submitted', review: null },
        $inc: { version: 1 },
        $push: {
          previous: { ...current.file, version: current.version, statusWhenReplaced: current.status },
          history: {
            action: 'replaced',
            by: actor._id,
            at: stored.uploadedAt,
            version: current.version + 1,
            note: current.status === 'approved' ? 'Replaced an approved version — back to review' : null,
          },
        },
      },
      { new: true },
    ).lean<LeanDoc>();
    if (updated) return updated;
  }
  throw conflict('Another upload for this document finished at the same moment. Refresh to see it, then try again if needed.', undefined, 'upload_race');
}

/* =================================================================== review */

const REVIEW_STATUS: Record<'approve' | 'request_changes' | 'reject', DocumentStatus> = {
  approve: 'approved',
  request_changes: 'changes_requested',
  reject: 'rejected',
};

export async function reviewDocument(actor: AuthUser, docId: Types.ObjectId, input: DocumentReviewInput) {
  const doc = await ParticipantDocument.findById(docId).lean<LeanDoc>();
  if (!doc) throw notFound('Document');
  const event = await Event.findById(doc.event).lean<IEvent>();
  // Check-in volunteers and other organizers can't tell this document exists.
  if (!event || !eventAccess(actor, event).canManage) throw notFound('Document');
  const reg = await Registration.findById(doc.registration).lean<IRegistration>();
  if (!reg) throw notFound('Document');
  if (!isActiveRegistration(reg)) throw conflict(`This registration is ${reg.status}; its documents can no longer be reviewed.`);

  const at = new Date();
  const note = input.note || null;
  let updated: LeanDoc | null;
  if (input.action === 'comment') {
    updated = await ParticipantDocument.findOneAndUpdate(
      { _id: doc._id, version: input.version },
      { $push: { history: { action: 'commented', by: actor._id, at, version: input.version, note } } },
      { new: true },
    ).lean<LeanDoc>();
  } else {
    const status = REVIEW_STATUS[input.action];
    // Conditional on what the reviewer saw: a newer upload or someone else's decision wins and this one is refused.
    updated = await ParticipantDocument.findOneAndUpdate(
      { _id: doc._id, version: input.version, status: input.expectedStatus },
      {
        $set: { status, review: { by: actor._id, at, note } },
        $push: { history: { action: status, by: actor._id, at, version: input.version, note } },
      },
      { new: true },
    ).lean<LeanDoc>();
  }
  if (!updated) {
    const now = await ParticipantDocument.findById(doc._id).lean<LeanDoc>();
    if (now && now.version !== input.version) {
      throw conflict('A newer version of this document was uploaded after you opened it. Review the new file.', undefined, 'document_replaced');
    }
    throw conflict(
      `Someone else already marked this document “${LABELS.documentStatus[now?.status ?? doc.status]}”. Reload to see the latest.`,
      undefined,
      'already_reviewed',
    );
  }
  await touchParticipation(reg._id);
  const requirement = event.documentRequirements.find((r) => r.key === doc.requirementKey);
  const verb = { approve: 'approved', request_changes: 'requested changes to', reject: 'rejected', comment: 'commented on' }[input.action];
  await audit({
    actor: actor._id,
    action: input.action === 'comment' ? 'document.commented' : `document.${REVIEW_STATUS[input.action]}`,
    entityType: 'ParticipantDocument',
    entityId: doc._id,
    event: event._id,
    summary: `${actor.name} ${verb} “${requirement?.name ?? 'document'}” (${reg.code}, v${input.version})${note ? ` — ${note}` : ''}`,
    meta: { registration: String(reg._id), slot: doc.slot, version: input.version },
  });
  publish(String(event._id), { type: 'registration.changed', registrationId: String(reg._id), status: reg.status });
  return reg._id;
}

/* =================================================================== participation decision */

function notReadyMessage(r: ParticipationResult) {
  if (r.counts.missing) return `${r.counts.missing} required document${r.counts.missing === 1 ? ' is' : 's are'} still missing.`;
  if (r.counts.changesRequested) return 'Some documents are waiting for corrections from the participant.';
  if (r.counts.awaitingReview) return `${r.counts.awaitingReview} document${r.counts.awaitingReview === 1 ? '' : 's'} still need${r.counts.awaitingReview === 1 ? 's' : ''} review.`;
  return 'Participation can’t be approved in its current state.';
}

export async function decideParticipation(
  actor: AuthUser,
  regId: Types.ObjectId,
  input: { action: 'approve' | 'reject' | 'reopen'; note: string; rev: number },
) {
  const reg = await Registration.findById(regId).lean<IRegistration>();
  if (!reg) throw notFound('Registration');
  const event = await Event.findById(reg.event).lean<IEvent>();
  if (!event || !eventAccess(actor, event).canManage) throw notFound('Registration');
  if (!isActiveRegistration(reg)) throw conflict(`This registration is ${reg.status}.`);
  if (!event.participation?.approvalRequired && input.action !== 'reopen') {
    throw conflict('This event doesn’t use participation approval. Turn it on in the event’s Documents settings first.', undefined, 'approval_not_enabled');
  }
  const rev = reg.participation?.rev ?? 0;
  const stale = () => conflict('This registration changed since you opened it. Reload, check the documents again, then decide.', undefined, 'stale');
  if (input.rev !== rev) throw stale();

  const { slots, docs, result } = await evaluate(reg, event);
  const at = new Date();
  const note = input.note || null;
  let decision: IParticipation['decision'];
  if (input.action === 'approve') {
    if (result.status === 'approved') throw conflict('Participation is already approved.', undefined, 'already_decided');
    if (!result.readyForDecision) throw conflict(notReadyMessage(result), undefined, 'not_ready');
    const covered = new Set(slots.map((s) => s.slot));
    decision = {
      value: 'approved',
      by: actor._id,
      at,
      note,
      snapshot: docs.filter((d) => covered.has(d.slot)).map((d) => ({ slot: d.slot, version: d.version })),
    };
  } else if (input.action === 'reject') {
    if (reg.participation?.decision?.value === 'rejected') throw conflict('Participation is already declined.', undefined, 'already_decided');
    decision = { value: 'rejected', by: actor._id, at, note, snapshot: [] };
  } else {
    if (!reg.participation?.decision) throw conflict('There is no decision to undo.', undefined, 'no_decision');
    decision = null;
  }

  const res = await Registration.updateOne(
    { _id: reg._id, ...revFilter(reg.participation) },
    { $set: { 'participation.decision': decision }, $inc: { 'participation.rev': 1 } },
  );
  if (!res.matchedCount) throw stale();
  await syncParticipation(reg._id);
  await audit({
    actor: actor._id,
    action: `participation.${input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'reopened'}`,
    entityType: 'Registration',
    entityId: reg._id,
    event: event._id,
    summary: `${actor.name} ${input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'declined' : 'reopened'} participation for ${reg.code}${note ? ` — ${note}` : ''}`,
    meta: decision?.snapshot.length ? { covered: decision.snapshot } : undefined,
  });
  publish(String(event._id), { type: 'registration.changed', registrationId: String(reg._id), status: reg.status });
}

/* =================================================================== read models */

export async function registrationDocumentsDTO(regId: Types.ObjectId, viewer: AuthUser): Promise<RegistrationDocumentsDTO> {
  const reg = await Registration.findById(regId).lean<IRegistration>();
  if (!reg) throw notFound('Registration');
  const event = await Event.findById(reg.event).lean<IEvent>();
  if (!event) throw notFound('Registration');
  const canManage = eventAccess(viewer, event).canManage;
  const { members, slots, docs, result } = await evaluate(reg, event);
  const viewerId = String(viewer._id);

  // Organizers also see documents filed under requirements that were later deactivated.
  const listed: ExpectedSlot[] = [...slots];
  if (canManage) {
    for (const d of docs) {
      if (listed.some((s) => s.slot === d.slot)) continue;
      const r = event.documentRequirements.find((x) => x.key === d.requirementKey);
      listed.push({
        slot: d.slot,
        requirementKey: d.requirementKey,
        subject: d.subject ? String(d.subject) : null,
        required: false,
        reviewRequired: r?.reviewRequired ?? true,
      });
    }
  }

  const ids = new Set<string>([...members, String(reg.user)]);
  for (const s of listed) if (s.subject) ids.add(s.subject);
  for (const d of docs) {
    if (d.file.uploadedBy) ids.add(String(d.file.uploadedBy));
    if (d.review?.by) ids.add(String(d.review.by));
    for (const h of d.history) if (h.by) ids.add(String(h.by));
  }
  if (reg.participation?.decision?.by) ids.add(String(reg.participation.decision.by));
  const users = await User.find({ _id: { $in: [...ids] } }).select('name').lean();
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  const person = (id: Types.ObjectId | string | null | undefined): PersonRefDTO | null =>
    id ? { id: String(id), name: names.get(String(id)) ?? 'Former participant' } : null;

  const now = new Date();
  const storageOk = await storageAvailable();
  const inTeam = members.includes(viewerId) || String(reg.user) === viewerId;

  const slotDTOs: DocumentSlotDTO[] = listed.map((s) => {
    const requirement = event.documentRequirements.find((r) => r.key === s.requirementKey);
    const doc = docs.find((d) => d.slot === s.slot) ?? null;
    const canView = canManage || (s.subject ? s.subject === viewerId : inTeam);
    const block = uploadBlock({ actorId: viewerId, reg, event, slot: s, requirement, existing: doc, now });
    const ownSlot = s.subject ? s.subject === viewerId : String(reg.user) === viewerId;
    return {
      slot: s.slot,
      requirementKey: s.requirementKey,
      subject: s.subject ? person(s.subject) : null,
      status: doc?.status ?? 'missing',
      canUpload: !block && storageOk,
      uploadBlockedReason: block ? (ownSlot ? block.message : null) : storageOk ? null : 'Document storage is unavailable right now.',
      canView,
      document:
        doc && canView
          ? {
              id: String(doc._id),
              version: doc.version,
              file: {
                name: doc.file.originalName,
                size: doc.file.size,
                mime: doc.file.mime,
                uploadedAt: doc.file.uploadedAt.toISOString(),
                uploadedBy: person(doc.file.uploadedBy),
              },
              review: doc.review ? { by: person(doc.review.by), at: doc.review.at.toISOString(), note: doc.review.note } : null,
              history: doc.history.map((h) => ({ action: h.action, at: h.at.toISOString(), by: person(h.by), version: h.version, note: h.note })),
              previousVersions: canManage
                ? doc.previous.map((p) => ({ version: p.version, name: p.originalName, size: p.size, uploadedAt: p.uploadedAt.toISOString(), statusWhenReplaced: p.statusWhenReplaced }))
                : [],
            }
          : null,
    };
  });

  const decision = reg.participation?.decision ?? null;
  return {
    registrationId: String(reg._id),
    participation: {
      status: result.status,
      approvalRequired: event.participation?.approvalRequired ?? false,
      checkInRequiresApproval: event.participation?.checkInRequiresApproval ?? false,
      counts: result.counts,
      readyForDecision: result.readyForDecision,
      decision: decision
        ? { value: decision.value, at: decision.at.toISOString(), by: person(decision.by), note: decision.note, current: result.decisionCurrent }
        : null,
      rev: reg.participation?.rev ?? 0,
    },
    requirements: event.documentRequirements
      .filter((r) => r.active || (canManage && docs.some((d) => d.requirementKey === r.key)))
      .map(requirementDTO),
    slots: slotDTOs,
    viewer: { canReview: canManage },
    maxBytes: MAX_DOCUMENT_BYTES,
    storageAvailable: storageOk,
  };
}

/**
 * Resolve a document file the viewer may read. Organizers who manage the event may read every
 * version; participants may read the current file of their own documents (and of team-level
 * documents of their team). Anyone else gets 404 — the document's existence isn't revealed.
 */
export async function readableDocumentFile(viewer: AuthUser, docId: Types.ObjectId, version: number | undefined): Promise<IStoredFile> {
  const doc = await ParticipantDocument.findById(docId).lean<LeanDoc>();
  if (!doc) throw notFound('Document');
  const event = await Event.findById(doc.event).select('createdBy organization staff').lean<IEvent>();
  const canManage = Boolean(event && eventAccess(viewer, event).canManage);
  if (!canManage) {
    const reg = await Registration.findById(doc.registration).select('user team').lean<IRegistration>();
    const viewerId = String(viewer._id);
    const allowed = doc.subject
      ? String(doc.subject) === viewerId
      : Boolean(reg && (String(reg.user) === viewerId || (reg.team && (await TeamMembership.exists({ team: reg.team, user: viewer._id })))));
    if (!allowed || (version !== undefined && version !== doc.version)) throw notFound('Document');
  }
  if (version === undefined || version === doc.version) return doc.file;
  const previous = doc.previous.find((p) => p.version === version);
  if (!previous) throw notFound('Document version');
  return previous;
}
