import type { Types } from 'mongoose';
import { ParticipantDocument, Registration, TeamMembership, User, type IEvent } from '../models';
import { storeFile } from '../modules/documents/storage';
import { syncParticipation } from '../modules/documents/service';
import { slotKey } from '../modules/documents/status';

/**
 * Demo documents for the seeded "Overnight Buildathon". Every file is a one-page PDF that says, on
 * its face, that it is a demonstration sample — no signature, no institutional wording.
 */

/** A minimal, valid one-page PDF showing the given lines (ASCII only). */
export function demoPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '-').replace(/([\\()])/g, '\\$1');
  const text = lines.map((l, i) => `${i === 0 ? '/F1 16 Tf' : '/F1 11 Tf'} (${esc(l)}) Tj 0 ${i === 0 ? -30 : -18} Td`).join('\n');
  const stream = `BT\n72 770 Td\n${text}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export type DemoOutcome = 'missing' | 'submitted' | 'approved' | 'changes_requested' | 'rejected';

const NOTES: Partial<Record<DemoOutcome, string>> = {
  changes_requested: 'The guardian’s signature is missing on page 1 — please upload the signed copy.',
  rejected: 'This is a fee receipt, not the permission letter. Please upload the letter from your HOD.',
};

/**
 * Give one registration's members documents in the given states.
 * `plan[i][j]` is the outcome for member i (leader first) and requirement j.
 */
export async function seedRegistrationDocuments(opts: {
  event: IEvent;
  registrationId: Types.ObjectId;
  reviewer: Types.ObjectId;
  plan: DemoOutcome[][];
  approveParticipation?: boolean;
  now: Date;
}) {
  const { event, registrationId, reviewer, plan, now } = opts;
  const reg = await Registration.findById(registrationId).lean();
  if (!reg?.team) return;
  const members = await TeamMembership.find({ team: reg.team }).sort({ role: 1, joinedAt: 1 }).lean();
  const people = await User.find({ _id: { $in: members.map((m) => m.user) } }).select('name').lean();
  const name = new Map(people.map((p) => [String(p._id), p.name]));
  const requirements = event.documentRequirements.filter((r) => r.active);
  const snapshot: { slot: string; version: number }[] = [];

  for (const [i, m] of members.entries()) {
    for (const [j, requirement] of requirements.entries()) {
      const outcome = plan[i]?.[j] ?? 'missing';
      if (outcome === 'missing') continue;
      const submittedAt = new Date(now.getTime() - (4 - j) * 24 * 3600_000 - i * 3 * 3600_000);
      const reviewedAt = new Date(submittedAt.getTime() + 20 * 3600_000);
      const file = await storeFile({
        folder: `events/${event._id}/registrations/${reg._id}`,
        buffer: demoPdf([
          'CAMPUSFLOW DEMO SAMPLE - NOT A REAL DOCUMENT',
          requirement.name,
          `Uploaded for: ${name.get(String(m.user)) ?? 'participant'} (fictional demo person)`,
          'Created by the demonstration seed. It carries no signature and no official wording.',
        ]),
        kind: 'pdf',
        originalName: `${requirement.name.replace(/\s*\/\s*/g, ' or ')} - ${name.get(String(m.user)) ?? 'participant'}.pdf`,
        uploadedBy: m.user,
      });
      file.uploadedAt = submittedAt;
      const reviewed = outcome !== 'submitted';
      const slot = slotKey(requirement.key, String(m.user));
      await ParticipantDocument.create({
        event: event._id,
        registration: reg._id,
        requirementKey: requirement.key,
        subject: m.user,
        slot,
        status: outcome,
        version: 1,
        file,
        previous: [],
        review: reviewed ? { by: reviewer, at: reviewedAt, note: NOTES[outcome] ?? null } : null,
        history: [
          { action: 'submitted', by: m.user, at: submittedAt, version: 1, note: null },
          ...(reviewed ? [{ action: outcome, by: reviewer, at: reviewedAt, version: 1, note: NOTES[outcome] ?? null }] : []),
        ],
        isDemo: true,
      });
      snapshot.push({ slot, version: 1 });
    }
  }

  if (opts.approveParticipation) {
    await Registration.updateOne(
      { _id: reg._id },
      {
        $set: { 'participation.decision': { value: 'approved', by: reviewer, at: new Date(now.getTime() - 12 * 3600_000), note: null, snapshot } },
        $inc: { 'participation.rev': 1 },
      },
    );
  } else {
    await Registration.updateOne({ _id: reg._id }, { $inc: { 'participation.rev': 1 } });
  }
  await syncParticipation(reg._id);
}
