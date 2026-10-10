import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { Types } from 'mongoose';
import type {
  ImportAnalysisDTO,
  ImportBatchDTO,
  ImportMappingInput,
  ImportResultDTO,
  ImportUploadDTO,
} from '@campusflow/shared';
import {
  Event,
  ImportBatch,
  PaymentRecord,
  Registration,
  Team,
  TeamMembership,
  Ticket,
  User,
  type IEvent,
  type IImportBatch,
} from '../../models';
import { audit } from '../../lib/audit';
import { randomCode } from '../../lib/crypto';
import { AppError, badRequest, conflict, isDuplicateKeyError, notFound } from '../../lib/errors';
import { iso } from '../../lib/http';
import type { AuthUser } from '../../middleware/auth';
import { getInstitution } from '../institution/service';
import { recomputeRegistration } from '../registrations/service';
import { amountDue } from '../registrations/status';
import { analyzeImport, suggestMapping, type AnalyzeContext, type ImportGroup, type Mapping } from './analyze';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

/**
 * Format adapters. CSV is implemented; further formats (e.g. XLSX) can be added by
 * registering a parser that returns a header row plus string rows.
 */
const parsers: Record<string, (buf: Buffer) => { headers: string[]; rows: string[][] }> = {
  csv: (buf) => {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    if (parsed.errors.length && !parsed.data.length) throw badRequest('Could not read this CSV file');
    const [headerRow, ...rows] = parsed.data;
    if (!headerRow?.length) throw badRequest('The file has no header row');
    const headers = headerRow.map((h, i) => (h ?? '').trim() || `Column ${i + 1}`);
    const seen = new Map<string, number>();
    const unique = headers.map((h) => {
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      return n > 1 ? `${h} (${n})` : h;
    });
    return { headers: unique, rows: rows.map((r) => unique.map((_, i) => (r[i] ?? '').toString())) };
  },
};

export function parserFor(filename: string, mimetype: string) {
  if (/\.csv$/i.test(filename) || /csv|comma-separated/.test(mimetype)) return parsers.csv!;
  throw badRequest('Only CSV files are supported at the moment. Export your form responses as CSV.');
}

export async function uploadImport(user: AuthUser, event: IEvent, file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<ImportUploadDTO> {
  const { headers, rows } = parserFor(file.originalname, file.mimetype)(file.buffer);
  if (!rows.length) throw badRequest('The file has a header row but no data rows');
  if (rows.length > MAX_ROWS) throw badRequest(`Files are limited to ${MAX_ROWS} rows`);
  const fileHash = createHash('sha256').update(file.buffer).digest('hex');
  const previous = await ImportBatch.findOne({ event: event._id, fileHash, status: 'committed' }).sort({ committedAt: -1 }).lean();
  const batch = await ImportBatch.create({
    event: event._id,
    uploadedBy: user._id,
    filename: file.originalname.slice(0, 200),
    fileHash,
    headers,
    rows,
    rowCount: rows.length,
  });
  const suggestion = suggestMapping(headers);
  return {
    batchId: String(batch._id),
    filename: batch.filename,
    headers,
    rowCount: rows.length,
    sample: rows.slice(0, 5).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
    suggestedMapping: suggestion.mapping,
    detectedLayout: suggestion.layout,
    memberColumnGroups: suggestion.memberGroups,
    previousImportOfSameFile: previous ? { batchId: String(previous._id), committedAt: iso(previous.committedAt) } : null,
  };
}

async function loadContext(event: IEvent): Promise<AnalyzeContext> {
  const inst = await getInstitution();
  const regs = await Registration.find({ event: event._id, status: { $nin: ['cancelled', 'rejected'] } }).lean();
  const teamIds = regs.map((r) => r.team).filter(Boolean) as Types.ObjectId[];
  const [teams, memberships, payments] = await Promise.all([
    Team.find({ _id: { $in: teamIds } }).select('name').lean(),
    TeamMembership.find({ event: event._id }).lean(),
    PaymentRecord.find({ event: event._id }).lean(),
  ]);
  const userIds = new Set<string>(regs.map((r) => String(r.user)));
  memberships.forEach((m) => userIds.add(String(m.user)));
  const people = await User.find({ _id: { $in: [...userIds] } }).select('email').lean();
  const emailById = new Map(people.map((u) => [String(u._id), u.email]));
  const teamName = new Map(teams.map((t) => [String(t._id), t.name]));
  const payByReg = new Map(payments.map((p) => [String(p.registration), p]));

  const existingReferences = new Map<string, string[]>();
  const codeByReg = new Map(regs.map((r) => [String(r._id), r.code]));
  for (const p of payments) {
    if (!p.referenceKey) continue;
    const code = codeByReg.get(String(p.registration));
    if (code) existingReferences.set(p.referenceKey, [...(existingReferences.get(p.referenceKey) ?? []), code]);
  }
  return {
    mode: event.mode,
    teamSize: event.teamSize,
    feeAmount: event.fee.amount,
    capacity: event.capacity,
    activeRegistrations: event.counters.activeRegistrations,
    departments: inst.departments,
    existingRegistrations: regs.map((r) => ({
      id: String(r._id),
      code: r.code,
      externalId: r.externalId,
      teamName: r.team ? (teamName.get(String(r.team)) ?? null) : null,
      participantEmails: r.team
        ? memberships.filter((m) => String(m.team) === String(r.team)).map((m) => emailById.get(String(m.user)) ?? '')
        : [emailById.get(String(r.user)) ?? ''],
      paymentStatus: payByReg.get(String(r._id))?.status ?? 'not_required',
      paymentReference: payByReg.get(String(r._id))?.reference ?? null,
    })),
    existingUsers: new Map(), // filled lazily below for roll-number checks
    existingReferences,
  };
}

async function runAnalysis(batch: IImportBatch, event: IEvent, input: ImportMappingInput) {
  const mapping = (input.mapping ?? {}) as Mapping;
  for (const [field, header] of Object.entries(mapping)) {
    if (header && !batch.headers.includes(header)) {
      throw new AppError(400, 'validation_failed', 'Mapping refers to a column that is not in the file', { fields: { [`mapping.${field}`]: `No column “${header}”` } });
    }
  }
  if (!mapping.email || !mapping.name) {
    const memberGroups = suggestMapping(batch.headers).memberGroups;
    if (!memberGroups) {
      throw new AppError(400, 'validation_failed', 'Map at least the name and email columns', {
        fields: { ...(!mapping.name ? { 'mapping.name': 'Required' } : {}), ...(!mapping.email ? { 'mapping.email': 'Required' } : {}) },
      });
    }
  }
  const ctx = await loadContext(event);
  // Users whose roll numbers appear in the file, to detect one person under two emails.
  const rollIdx = mapping.rollNumber ? batch.headers.indexOf(mapping.rollNumber) : -1;
  const rolls = rollIdx >= 0 ? [...new Set(batch.rows.map((r) => (r[rollIdx] ?? '').trim().toUpperCase()).filter(Boolean))] : [];
  if (rolls.length) {
    const users = await User.find({ rollNumber: { $in: rolls } }).select('email rollNumber name').lean();
    ctx.existingUsers = new Map(users.map((u) => [u.email, { rollNumber: u.rollNumber, name: u.name }]));
  }
  const options = {
    layout: input.options?.layout ?? 'auto',
    treatPaidAsVerified: input.options?.treatPaidAsVerified ?? false,
    decisions: input.decisions ?? {},
  } as const;
  return { analysis: analyzeImport(batch.headers, batch.rows, mapping, ctx, options), mapping, options };
}

async function loadBatch(batchId: Types.ObjectId, eventId: Types.ObjectId) {
  const batch = await ImportBatch.findOne({ _id: batchId, event: eventId }).lean();
  if (!batch) throw notFound('Import');
  return batch;
}

export async function analyzeBatch(event: IEvent, batchId: Types.ObjectId, input: ImportMappingInput): Promise<ImportAnalysisDTO> {
  const batch = await loadBatch(batchId, event._id);
  const { analysis } = await runAnalysis(batch, event, input);
  const previous = await ImportBatch.findOne({ event: event._id, fileHash: batch.fileHash, status: 'committed' }).sort({ committedAt: -1 }).lean();
  const errorsByKey = new Map<string, number>();
  analysis.issues.forEach((i) => i.registrationKey && errorsByKey.set(i.registrationKey, (errorsByKey.get(i.registrationKey) ?? 0) + 1));
  const existingEmails = new Set((await User.find({ email: { $in: analysis.groups.flatMap((g) => g.participants.map((p) => p.email)) } }).select('email').lean()).map((u) => u.email));
  const count = (a: ImportGroup['action']) => analysis.groups.filter((g) => g.action === a).length;
  return {
    batchId: String(batch._id),
    filename: batch.filename,
    alreadyCommittedAt: iso(previous?.committedAt),
    layout: analysis.layout,
    totals: {
      rows: batch.rowCount,
      registrations: analysis.groups.length,
      participants: analysis.groups.reduce((n, g) => n + g.participants.length, 0),
      create: count('create'),
      update: count('update'),
      unchanged: count('unchanged'),
      skip: count('skip'),
      errors: analysis.issues.filter((i) => i.severity === 'error').length,
      warnings: analysis.issues.filter((i) => i.severity === 'warning').length,
      reviews: analysis.issues.filter((i) => i.severity === 'review').length,
    },
    issues: analysis.issues,
    registrations: analysis.groups.map((g) => ({
      key: g.key,
      externalId: g.externalId,
      teamName: g.teamName,
      action: g.action,
      participants: g.participants.map((p) => ({
        row: p.row,
        name: p.name,
        email: p.email,
        rollNumber: p.rollNumber,
        department: p.department,
        isLeader: p.isLeader,
        match: existingEmails.has(p.email) ? 'existing_user' : 'new_user',
      })),
      payment: { status: g.paymentStatus, reference: g.paymentReference, amount: g.amountPaid },
      issues: errorsByKey.get(g.key) ?? 0,
    })),
    canCommit: batch.status === 'uploaded' && analysis.unresolvedReviews.length === 0 && analysis.groups.some((g) => g.action === 'create' || g.action === 'update'),
  };
}

/* ---------------------------------------------------------------- commit */

async function upsertPerson(p: ImportGroup['participants'][number], counters: { usersCreated: number }) {
  const existing = await User.findOne({ email: p.email });
  if (existing) {
    // Fill gaps only; never overwrite what a participant entered themselves.
    let changed = false;
    if (!existing.rollNumber && p.rollNumber) [existing.rollNumber, changed] = [p.rollNumber, true];
    if (!existing.department && p.department) [existing.department, changed] = [p.department, true];
    if (!existing.phone && p.phone) [existing.phone, changed] = [p.phone, true];
    if (changed) await existing.save();
    return existing._id;
  }
  try {
    const created = await User.create({
      name: p.name,
      email: p.email,
      rollNumber: p.rollNumber,
      department: p.department,
      phone: p.phone,
      role: 'participant',
      claimed: false,
      passwordHash: null,
    });
    counters.usersCreated++;
    return created._id;
  } catch (err) {
    if (isDuplicateKeyError(err)) return (await User.findOne({ email: p.email }).select('_id').lean())!._id;
    throw err;
  }
}

async function nextCode(eventId: Types.ObjectId, increment: boolean) {
  const ev = await Event.findOneAndUpdate(
    { _id: eventId },
    { $inc: { 'counters.registrationSeq': 1, ...(increment ? { 'counters.activeRegistrations': 1 } : {}) } },
    { new: true },
  ).lean();
  return `${ev!.codePrefix}-${String(ev!.counters.registrationSeq).padStart(4, '0')}`;
}

async function applyPayment(regId: Types.ObjectId, event: IEvent, group: ImportGroup, memberCount: number, actor: AuthUser, filename: string) {
  const required = event.fee.amount > 0;
  const ref = group.paymentReference;
  const refKey = ref ? ref.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
  const existing = await PaymentRecord.findOne({ registration: regId });
  if (!existing) {
    await PaymentRecord.create({
      registration: regId,
      event: event._id,
      required,
      status: required ? group.paymentStatus : 'not_required',
      amountDue: required ? amountDue(event.fee, memberCount) : 0,
      currency: event.fee.currency,
      reference: required ? ref : null,
      referenceKey: required ? refKey : null,
      submittedAt: required && ref ? new Date() : null,
      decidedAt: group.paymentStatus === 'verified' ? new Date() : null,
      decidedBy: group.paymentStatus === 'verified' ? actor._id : null,
      decisionNote: group.paymentStatus === 'verified' ? `Marked paid in import file ${filename}` : null,
      history: [{ status: required ? group.paymentStatus : 'not_required', at: new Date(), by: actor._id, note: `Imported from ${filename}` }],
    });
    return;
  }
  if (!required || existing.status === 'verified' || existing.status === 'refunded') return; // never downgrade
  if (ref && !existing.reference) {
    existing.reference = ref;
    existing.referenceKey = refKey;
    existing.submittedAt = new Date();
  }
  if (group.paymentStatus === 'verified' && existing.status === 'pending') {
    existing.status = 'verified';
    existing.decidedAt = new Date();
    existing.decidedBy = actor._id;
    existing.decisionNote = `Marked paid in import file ${filename}`;
    existing.history.push({ status: 'verified', at: new Date(), by: actor._id, note: `Imported from ${filename}` });
  }
  await existing.save();
}

export async function commitBatch(user: AuthUser, event: IEvent, batchId: Types.ObjectId, input: ImportMappingInput): Promise<ImportResultDTO> {
  const batch = await loadBatch(batchId, event._id);
  if (batch.status !== 'uploaded') throw conflict('This import has already been committed');
  // Re-run the analysis server-side; the client's preview is never trusted for writes.
  const { analysis, mapping, options } = await runAnalysis(batch, event, input);
  if (analysis.unresolvedReviews.length) {
    throw new AppError(409, 'review_required', 'Some items need a decision before importing', { unresolved: analysis.unresolvedReviews });
  }
  const claimed = await ImportBatch.findOneAndUpdate({ _id: batch._id, status: 'uploaded' }, { $set: { status: 'committing' } });
  if (!claimed) throw conflict('This import is already being committed');

  const result: ImportResultDTO = {
    batchId: String(batch._id),
    committedAt: '',
    created: 0,
    updated: 0,
    unchanged: analysis.groups.filter((g) => g.action === 'unchanged').length,
    skipped: analysis.groups.filter((g) => g.action === 'skip').length,
    usersCreated: 0,
    ticketsIssued: 0,
  };
  try {
    for (const group of analysis.groups) {
      if (group.action !== 'create' && group.action !== 'update') continue;
      const ids: Types.ObjectId[] = [];
      for (const p of group.participants) ids.push(await upsertPerson(p, result));
      const leaderIdx = Math.max(0, group.participants.findIndex((p) => p.isLeader));
      const leaderId = ids[leaderIdx]!;
      let regId: Types.ObjectId;

      if (group.action === 'create') {
        if (event.mode === 'individual') {
          const code = await nextCode(event._id, true);
          try {
            const reg = await Registration.create({
              event: event._id,
              code,
              kind: 'individual',
              status: 'pending',
              user: leaderId,
              activeKey: `${event._id}:${leaderId}`,
              source: 'import',
              externalId: group.externalId,
              importBatch: batch._id,
            });
            regId = reg._id;
          } catch (err) {
            await Event.updateOne({ _id: event._id }, { $inc: { 'counters.activeRegistrations': -1 } });
            if (isDuplicateKeyError(err)) {
              result.skipped++;
              continue;
            }
            throw err;
          }
        } else {
          let name = group.teamName!;
          let team = null;
          for (let attempt = 0; attempt < 5 && !team; attempt++) {
            try {
              team = await Team.create({
                event: event._id,
                name,
                nameKey: name.toLowerCase(),
                code: randomCode(8),
                codeExpiresAt: event.registrationDeadline,
                leader: leaderId,
                memberCount: 0,
              });
            } catch (err) {
              if (!isDuplicateKeyError(err)) throw err;
              name = `${group.teamName} (${attempt + 2})`;
            }
          }
          if (!team) {
            result.skipped++;
            continue;
          }
          const code = await nextCode(event._id, true);
          const reg = await Registration.create({
            event: event._id,
            code,
            kind: 'team',
            status: 'incomplete',
            user: leaderId,
            team: team._id,
            source: 'import',
            externalId: group.externalId,
            importBatch: batch._id,
          });
          regId = reg._id;
          team.registration = reg._id;
          await team.save();
          for (const [i, uid] of ids.entries()) {
            try {
              await TeamMembership.create({ team: team._id, event: event._id, user: uid, role: i === leaderIdx ? 'leader' : 'member' });
              await Team.updateOne({ _id: team._id }, { $inc: { memberCount: 1 } });
            } catch (err) {
              if (!isDuplicateKeyError(err)) throw err; // already in another team: analysis flagged it
            }
          }
        }
        await applyPayment(regId, event, group, ids.length, user, batch.filename);
        result.created++;
      } else {
        const match = group.match!;
        regId = new Types.ObjectId(match.id);
        const reg = await Registration.findById(regId);
        if (!reg) continue;
        if (group.externalId && !reg.externalId) {
          reg.externalId = group.externalId;
          await reg.save();
        }
        if (reg.team) {
          const team = await Team.findById(reg.team);
          if (team && group.teamName && team.name !== group.teamName) {
            team.name = group.teamName;
            team.nameKey = group.teamName.toLowerCase();
            try {
              await team.save();
            } catch (err) {
              if (!isDuplicateKeyError(err)) throw err;
            }
          }
          for (const uid of ids) {
            const slot = await Team.findOneAndUpdate({ _id: reg.team, memberCount: { $lt: event.teamSize.max } }, { $inc: { memberCount: 1 } });
            if (!slot) break;
            try {
              await TeamMembership.create({ team: reg.team, event: event._id, user: uid, role: 'member' });
            } catch (err) {
              await Team.updateOne({ _id: reg.team }, { $inc: { memberCount: -1 } });
              if (!isDuplicateKeyError(err)) throw err;
            }
          }
        }
        const team = reg.team ? await Team.findById(reg.team).select('memberCount').lean() : null;
        await applyPayment(regId, event, group, team?.memberCount ?? 1, user, batch.filename);
        result.updated++;
      }
      const before = await Ticket.countDocuments({ registration: regId });
      await recomputeRegistration(regId);
      const after = await Ticket.countDocuments({ registration: regId });
      result.ticketsIssued += Math.max(0, after - before);
    }
  } catch (err) {
    await ImportBatch.updateOne({ _id: batch._id }, { $set: { status: 'uploaded' } });
    throw err;
  }

  const committedAt = new Date();
  result.committedAt = committedAt.toISOString();
  await ImportBatch.updateOne(
    { _id: batch._id },
    { $set: { status: 'committed', committedAt, mapping, options, result } },
  );
  await audit({
    actor: user._id,
    action: 'import.committed',
    entityType: 'ImportBatch',
    entityId: batch._id,
    event: event._id,
    summary: `Imported ${batch.filename}: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped`,
    meta: { ...result, fileHash: batch.fileHash, decisions: input.decisions ?? {} },
  });
  return result;
}

export async function listBatches(eventId: Types.ObjectId): Promise<ImportBatchDTO[]> {
  const batches = await ImportBatch.find({ event: eventId }).select('-rows').sort({ createdAt: -1 }).limit(50).lean();
  const users = await User.find({ _id: { $in: batches.map((b) => b.uploadedBy) } }).select('name').lean();
  const byId = new Map(users.map((u) => [String(u._id), u.name]));
  return batches.map((b) => ({
    id: String(b._id),
    filename: b.filename,
    status: b.status,
    rowCount: b.rowCount,
    createdAt: b.createdAt.toISOString(),
    committedAt: iso(b.committedAt),
    uploadedBy: byId.has(String(b.uploadedBy)) ? { id: String(b.uploadedBy), name: byId.get(String(b.uploadedBy))! } : null,
    result: (b.result as ImportResultDTO | null) ?? null,
  }));
}
