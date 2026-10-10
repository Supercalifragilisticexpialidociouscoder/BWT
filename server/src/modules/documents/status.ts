import type { DocumentScope, DocumentStatus, ParticipationStatus, RegistrationMode } from '@campusflow/shared';

/**
 * Pure rules for document slots and participation approval (unit-tested in test/unit/participation.test.ts).
 *
 * A *slot* is one document a registration owes: a requirement × the person (or team) it is about.
 * Participation status is derived from the slots, the documents in them, and the organizer's decision.
 */

export interface RequirementRule {
  key: string;
  required: boolean;
  reviewRequired: boolean;
  appliesTo: DocumentScope;
  active: boolean;
}

export interface ExpectedSlot {
  slot: string;
  requirementKey: string;
  /** User id the document is about; null for a team-level document. */
  subject: string | null;
  required: boolean;
  reviewRequired: boolean;
}

export const slotKey = (requirementKey: string, subject: string | null) => `${requirementKey}:${subject ?? 'team'}`;

/**
 * The slots a registration owes under the event's active requirements and its current people.
 * Individual registrations have one person, so every scope resolves to them.
 */
export function expectedSlots(
  requirements: RequirementRule[],
  reg: { kind: RegistrationMode; registrant: string; members: string[] },
): ExpectedSlot[] {
  const out: ExpectedSlot[] = [];
  for (const r of requirements) {
    if (!r.active) continue;
    const subjects: (string | null)[] =
      reg.kind === 'individual'
        ? [reg.registrant]
        : r.appliesTo === 'each_member'
          ? reg.members
          : r.appliesTo === 'team'
            ? [null]
            : [reg.registrant];
    for (const subject of subjects) {
      out.push({ slot: slotKey(r.key, subject), requirementKey: r.key, subject, required: r.required, reviewRequired: r.reviewRequired });
    }
  }
  return out;
}

export interface SlotDocument {
  slot: string;
  status: DocumentStatus;
  version: number;
}

export interface ParticipationDecisionState {
  value: 'approved' | 'rejected';
  /** The document versions an approval covered. */
  snapshot: { slot: string; version: number }[];
}

export interface ParticipationResult {
  status: ParticipationStatus;
  counts: { required: number; missing: number; awaitingReview: number; changesRequested: number; approved: number };
  /** Documents are complete and settled; the organizer's participation decision is outstanding. */
  readyForDecision: boolean;
  /** The stored decision still applies to the current documents. */
  decisionCurrent: boolean;
}

export function computeParticipation(input: {
  approvalRequired: boolean;
  slots: ExpectedSlot[];
  documents: SlotDocument[];
  decision: ParticipationDecisionState | null;
}): ParticipationResult {
  const bySlot = new Map(input.documents.map((d) => [d.slot, d]));
  const current = input.slots.map((s) => ({ s, d: bySlot.get(s.slot) ?? null }));

  const required = current.filter((x) => x.s.required);
  const missing = required.filter((x) => !x.d).length;
  const changesRequested = current.filter((x) => x.d && (x.d.status === 'changes_requested' || x.d.status === 'rejected')).length;
  const awaitingReview = current.filter((x) => x.d && x.d.status === 'submitted' && x.s.reviewRequired).length;
  const approved = current.filter((x) => x.d?.status === 'approved').length;
  const counts = { required: required.length, missing, awaitingReview, changesRequested, approved };

  // Optional documents alone don't make participation conditional (they're still reviewed and counted).
  if (!input.approvalRequired && required.length === 0) {
    return { status: 'not_required', counts, readyForDecision: false, decisionCurrent: false };
  }

  const settled = missing === 0 && changesRequested === 0 && awaitingReview === 0;
  // An approval covers exact versions: any replaced or newly added document makes it stale.
  const approvalCovers =
    input.decision?.value === 'approved' &&
    current.every((x) => !x.d || input.decision!.snapshot.some((p) => p.slot === x.s.slot && p.version === x.d!.version));
  const rejected = input.approvalRequired && input.decision?.value === 'rejected';
  const decisionCurrent = rejected || (input.approvalRequired && settled && approvalCovers);
  const result = (status: ParticipationStatus): ParticipationResult => ({
    status,
    counts,
    readyForDecision: input.approvalRequired && settled && !decisionCurrent,
    decisionCurrent,
  });

  if (rejected) return result('rejected');
  if (changesRequested > 0) return result('changes_requested');
  if (missing > 0) return result('not_submitted');
  if (awaitingReview > 0) return result(approved > 0 ? 'under_review' : 'submitted');
  if (input.approvalRequired) return result(decisionCurrent ? 'approved' : 'under_review');
  // No separate decision: "approved" means a reviewer approved every required document that needs
  // review. If none needs review the documents are merely complete — uploads alone never approve.
  return result(required.some((x) => x.s.reviewRequired) ? 'approved' : 'submitted');
}

/** What a scanner volunteer is told when participation approval blocks entry (no document details). */
export function participationBlockMessage(p: Pick<ParticipationResult, 'status' | 'counts' | 'readyForDecision'>): string {
  switch (p.status) {
    case 'rejected':
      return 'Participation was not approved by the organizers. Send them to the organizers’ desk.';
    case 'changes_requested':
      return 'Participation not approved yet: the organizers asked for corrected documents. Send them to the organizers’ desk.';
    case 'not_submitted':
      return `Participation not approved yet: ${p.counts.missing} required document${p.counts.missing === 1 ? ' is' : 's are'} missing. Send them to the organizers’ desk.`;
    case 'submitted':
    case 'under_review':
      return p.readyForDecision
        ? 'Participation not approved yet: waiting for the organizers’ decision. Send them to the organizers’ desk.'
        : 'Participation not approved yet: documents are awaiting organizer review. Send them to the organizers’ desk.';
    default:
      return 'Participation is not approved for this event. Send them to the organizers’ desk.';
  }
}
