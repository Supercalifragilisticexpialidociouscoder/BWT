import { Router } from 'express';
import { LABELS, formatInZone, type ReportDTO } from '@campusflow/shared';
import { PaymentRecord, Registration, Team, User } from '../../models';
import { toCsv } from '../../lib/csv';
import { badRequest } from '../../lib/errors';
import { parse, requireUser } from '../../lib/http';
import { loadEventFor } from '../../lib/access';
import { requireAuth } from '../../middleware/auth';
import { getInstitution } from '../institution/service';
import { participantRows, listRegistrations } from '../registrations/service';
import { checkInRows } from '../checkin/service';
import { finalizeReport, getReport } from './service';
import { z } from 'zod';

export const reportsRouter = Router();

reportsRouter.get('/events/:id/report', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  res.json(await getReport(event.toObject()));
});

reportsRouter.post('/events/:id/report/finalize', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  res.json(await finalizeReport(user, event._id));
});

const ExportKind = z.enum(['registrations', 'participants', 'attendance', 'payments', 'summary']);

reportsRouter.get('/events/:id/exports/:kind.csv', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const kind = parse(ExportKind, req.params.kind);
  const inst = await getInstitution();
  const tz = inst.timezone;
  const local = (d: Date | string | null | undefined) => (d ? formatInZone(d, tz, 'yyyy-MM-dd HH:mm') : '');
  const stamp = formatInZone(new Date(), tz, 'yyyyMMdd-HHmm');
  let csv: string;

  if (kind === 'registrations') {
    const page = await listRegistrations(event._id, { sort: 'code', page: 1, pageSize: 100_000 });
    const regs = await Registration.find({ event: event._id }).select('externalId statusReason').lean();
    const extra = new Map(regs.map((r) => [String(r._id), r]));
    // Participation columns appear only for events that collect documents or approve participation.
    const docs = event.participation?.approvalRequired || event.documentRequirements?.some((d) => d.active);
    csv = toCsv(
      [
        'Registration code', 'External ID', 'Kind', 'Status', 'Status detail', 'Name / team', 'Members', 'Primary email', 'Roll number', 'Payment status', 'Payment reference', `Amount due (${event.fee.currency})`,
        ...(docs ? ['Participation', 'Documents missing', 'Documents awaiting review'] : []),
        'Source', `Registered at (${tz})`,
      ],
      page.items.map((r) => [
        r.code,
        extra.get(r.id)?.externalId ?? '',
        LABELS.mode[r.kind],
        LABELS.registrationStatus[r.status],
        extra.get(r.id)?.statusReason ?? '',
        r.name,
        r.memberCount,
        r.primaryEmail,
        r.primaryRollNumber ?? '',
        LABELS.paymentStatus[r.payment.status],
        r.payment.reference ?? '',
        (r.payment.amountDue / 100).toFixed(2),
        ...(docs ? [LABELS.participationStatus[r.participation.status], r.participation.missing, r.participation.awaitingReview] : []),
        r.source,
        local(r.createdAt),
      ]),
    );
  } else if (kind === 'participants') {
    const rows = await participantRows(event._id);
    csv = toCsv(
      ['Registration code', 'Registration status', 'Team', 'Leader', 'Name', 'Email', 'Roll number', 'Department', 'Phone', 'Ticket', 'Ticket status', `Checked in at (${tz})`],
      rows.map((r) => [
        r.reg.code,
        LABELS.registrationStatus[r.reg.status],
        r.teamName ?? '',
        r.isLeader ? 'yes' : '',
        r.user?.name ?? '',
        r.user?.email ?? '',
        r.user?.rollNumber ?? '',
        r.user?.department ?? '',
        r.user?.phone ?? '',
        r.ticket?.shortCode ?? '',
        r.ticket ? LABELS.ticketStatus[r.ticket.status] : '',
        local(r.checkedInAt),
      ]),
    );
  } else if (kind === 'attendance') {
    const rows = await checkInRows({ event: event._id }, 100_000);
    csv = toCsv(
      [`Checked in at (${tz})`, 'Participant', 'Roll number', 'Team', 'Registration', 'Ticket', 'Method', 'Recorded by', 'Active', `Corrected at (${tz})`, 'Corrected by', 'Correction reason'],
      rows
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((r) => [
          local(r.at),
          r.participant.name,
          r.participant.rollNumber ?? '',
          r.team?.name ?? '',
          r.registrationCode,
          r.ticketShortCode,
          r.method,
          r.staff?.name ?? '',
          r.active ? 'yes' : 'no (corrected)',
          local(r.voidedAt),
          r.voidedBy?.name ?? '',
          r.voidReason ?? '',
        ]),
    );
  } else if (kind === 'payments') {
    const payments = await PaymentRecord.find({ event: event._id, required: true }).lean();
    const regs = await Registration.find({ _id: { $in: payments.map((p) => p.registration) } }).select('code status team user').lean();
    const teams = await Team.find({ _id: { $in: regs.map((r) => r.team).filter(Boolean) } }).select('name').lean();
    const users = await User.find({ _id: { $in: [...regs.map((r) => r.user), ...payments.map((p) => p.decidedBy).filter(Boolean)] } }).select('name').lean();
    const rm = new Map(regs.map((r) => [String(r._id), r]));
    const tm = new Map(teams.map((t) => [String(t._id), t.name]));
    const um = new Map(users.map((u) => [String(u._id), u.name]));
    csv = toCsv(
      ['Registration code', 'Registration status', 'Name / team', 'Payment status', 'Reference', 'Payer name', `Amount due (${event.fee.currency})`, `Submitted at (${tz})`, `Decided at (${tz})`, 'Decided by', 'Note'],
      payments.map((p) => {
        const r = rm.get(String(p.registration));
        return [
          r?.code ?? '',
          r ? LABELS.registrationStatus[r.status] : '',
          r?.team ? (tm.get(String(r.team)) ?? '') : (um.get(String(r?.user)) ?? ''),
          LABELS.paymentStatus[p.status],
          p.reference ?? '',
          p.payerName ?? '',
          (p.amountDue / 100).toFixed(2),
          local(p.submittedAt),
          local(p.decidedAt),
          p.decidedBy ? (um.get(String(p.decidedBy)) ?? '') : '',
          p.decisionNote ?? '',
        ];
      }),
    );
  } else {
    const report: ReportDTO = await getReport(event.toObject());
    const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
    const rows: (string | number)[][] = [
      ['Report type', report.kind === 'finalized' ? `Finalized ${local(report.finalizedAt)}` : `Live snapshot ${local(report.generatedAt)}`],
      ['Event', event.title],
      ['Registrations (all)', report.registrations.total],
      ...Object.entries(report.registrations.byStatus).map(([k, v]) => [`Registrations — ${LABELS.registrationStatus[k as keyof typeof LABELS.registrationStatus]}`, v]),
      ...(report.teams ? [['Teams (active)', report.teams.total], ['Teams complete', report.teams.complete], ['Teams incomplete', report.teams.incomplete]] : []),
      ['Participants (active registrations)', report.participants.total],
      ['Participants with valid tickets', report.participants.confirmed],
      ...Object.entries(report.payments.byStatus)
        .filter(([, v]) => v.count > 0)
        .map(([k, v]) => [`Payments — ${LABELS.paymentStatus[k as keyof typeof LABELS.paymentStatus]}`, `${v.count} (${(v.amount / 100).toFixed(2)} ${report.payments.currency})`]),
      ['Checked in', report.attendance.checkedIn],
      ['Attendance rate', pct(report.attendance.rate)],
      ['No-shows', report.attendance.noShows ?? 'Available after the event ends'],
      ['Attendance corrections', report.attendance.corrections],
      ...(report.venue ? [['Venue', report.venue.name], ['Entries vs venue capacity', pct(report.venue.peakUtilization)]] : []),
    ];
    csv = toCsv(['Metric', 'Value'], rows);
  }

  if (!csv) throw badRequest('Nothing to export');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${event.slug}-${kind}-${stamp}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(`﻿${csv}`);
});

