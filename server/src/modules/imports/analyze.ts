/**
 * Registration-export reconciliation — pure analysis, no database access.
 *
 * Two file layouts are understood:
 *   per_participant  – one row per person; rows sharing a registration ID (or team name)
 *                      form one registration
 *   per_registration – one row per registration with repeated member columns
 *                      ("Member 2 Name", "Member 2 Email", …)
 *
 * Matching keys, in order of reliability: the export's registration ID → team name
 * (unique per event) → participant email (individual events). With any of these present a
 * re-import of the same file resolves every registration to "unchanged".
 *
 * Nothing is merged or dropped on name similarity alone. Ambiguities become review items
 * that require an explicit decision before the import can be committed.
 */

import type { ImportField, ImportIssueDTO, PaymentStatus, RegistrationMode } from '@campusflow/shared';

export type Mapping = Partial<Record<ImportField, string | null>>;
export type Layout = 'per_participant' | 'per_registration';

export interface ExistingRegistration {
  id: string;
  code: string;
  externalId: string | null;
  teamName: string | null;
  participantEmails: string[];
  paymentStatus: PaymentStatus;
  paymentReference: string | null;
}

export interface AnalyzeContext {
  mode: RegistrationMode;
  teamSize: { min: number; max: number };
  feeAmount: number;
  capacity: number | null;
  activeRegistrations: number;
  departments: { code: string; name: string }[];
  existingRegistrations: ExistingRegistration[];
  /** Emails of existing users, with their roll numbers. */
  existingUsers: Map<string, { rollNumber: string | null; name: string }>;
  /** Payment reference key → registration codes already using it in this event. */
  existingReferences: Map<string, string[]>;
}

export interface AnalyzeOptions {
  layout: 'auto' | Layout;
  treatPaidAsVerified: boolean;
  decisions: Record<string, string>;
}

export interface ParsedParticipant {
  row: number;
  name: string;
  email: string;
  rollNumber: string | null;
  department: string | null;
  departmentRaw: string | null;
  phone: string | null;
  isLeader: boolean;
}

export type PaymentSignal = 'paid' | 'pending' | 'failed' | 'refunded' | 'not_required' | 'unknown';

export interface ImportGroup {
  key: string;
  externalId: string | null;
  teamName: string | null;
  rows: number[];
  participants: ParsedParticipant[];
  paymentSignal: PaymentSignal;
  paymentReference: string | null;
  amountPaid: number | null;
  match: ExistingRegistration | null;
  action: 'create' | 'update' | 'unchanged' | 'skip';
  /** Resulting payment status if committed. */
  paymentStatus: PaymentStatus;
}

export interface Analysis {
  layout: Layout;
  groups: ImportGroup[];
  issues: ImportIssueDTO[];
  unresolvedReviews: string[];
}

/* ------------------------------------------------------------------ header heuristics */

const MEMBER_HEADER = /(?:member|participant|teammate|student)\s*#?\s*(\d+)|(\d+)\s*(?:st|nd|rd|th)?\s*(?:member|participant)/i;

const FIELD_PATTERNS: Record<ImportField, RegExp> = {
  externalId: /^(?:(?:registration|reg|response|submission|entry|form|ticket|order)\s*(?:id|no\.?|number|#)|id|response id)$/i,
  teamName: /team\s*name|^team$/i,
  name: /^(?:full\s*name|name|participant\s*name|student\s*name|leader\s*name|team\s*leader(?:\s*name)?)$/i,
  email: /e-?mail/i,
  rollNumber: /roll|hall\s*ticket|ht\s*no|htno|student\s*id|usn|enrol+ment/i,
  department: /dep(?:ar)?t|branch|programme|program|course/i,
  phone: /phone|mobile|contact|whats\s*app/i,
  isLeader: /^(?:is\s*)?(?:team\s*)?(?:leader|captain)\s*\??$|^role$/i,
  paymentStatus: /payment\s*status|paid\??$|^payment$/i,
  paymentReference: /utr|transaction|txn|reference|ref\.?\s*(?:no|id)|upi\s*(?:id|ref)/i,
  amountPaid: /amount|fee/i,
};

export function detectMemberGroups(headers: string[]): Map<number, Partial<Record<'name' | 'email' | 'rollNumber' | 'department' | 'phone', number>>> {
  const groups = new Map<number, Partial<Record<'name' | 'email' | 'rollNumber' | 'department' | 'phone', number>>>();
  headers.forEach((h, idx) => {
    const m = MEMBER_HEADER.exec(h);
    if (!m) return;
    const n = Number(m[1] ?? m[2]);
    const g = groups.get(n) ?? {};
    if (/e-?mail/i.test(h)) g.email = idx;
    else if (FIELD_PATTERNS.rollNumber.test(h)) g.rollNumber = idx;
    else if (FIELD_PATTERNS.department.test(h)) g.department = idx;
    else if (FIELD_PATTERNS.phone.test(h)) g.phone = idx;
    else if (/name/i.test(h)) g.name = idx;
    else return;
    groups.set(n, g);
  });
  // A group must at least identify a person.
  for (const [n, g] of groups) if (g.name === undefined && g.email === undefined) groups.delete(n);
  return groups;
}

export function suggestMapping(headers: string[]): { mapping: Mapping; layout: Layout; memberGroups: number } {
  const memberGroups = detectMemberGroups(headers);
  const memberCols = new Set<number>();
  memberGroups.forEach((g) => Object.values(g).forEach((i) => memberCols.add(i!)));
  const mapping: Mapping = {};
  const used = new Set<number>();
  const order: ImportField[] = ['externalId', 'teamName', 'paymentReference', 'paymentStatus', 'amountPaid', 'email', 'rollNumber', 'department', 'phone', 'name', 'isLeader'];
  for (const field of order) {
    const idx = headers.findIndex((h, i) => !used.has(i) && !memberCols.has(i) && FIELD_PATTERNS[field].test(h.trim()));
    if (idx >= 0) {
      mapping[field] = headers[idx]!;
      used.add(idx);
    } else mapping[field] = null;
  }
  const layout: Layout = memberGroups.size >= 2 ? 'per_registration' : 'per_participant';
  return { mapping, layout, memberGroups: memberGroups.size };
}

/* ------------------------------------------------------------------ value normalisation */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normEmail(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

function clean(v: string | undefined): string | null {
  const s = (v ?? '').trim().replace(/\s+/g, ' ');
  return s.length ? s : null;
}

export function paymentSignal(v: string | null): PaymentSignal {
  if (!v) return 'unknown';
  const s = v.toLowerCase();
  if (/refund/.test(s)) return 'refunded';
  if (/fail|declin|reject|cancel/.test(s)) return 'failed';
  if (/not\s*required|waived|free|n\/?a|exempt/.test(s)) return 'not_required';
  if (/pending|processing|initiated|await|unpaid|^no$/.test(s)) return 'pending';
  if (/paid|success|complete|captured|verified|confirm|^yes$|^done$|^y$/.test(s)) return 'paid';
  return 'unknown';
}

export function resolveDepartment(raw: string | null, departments: { code: string; name: string }[]): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();
  const exact = departments.find((d) => d.code.toLowerCase() === s || d.name.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim() === s);
  if (exact) return exact.code;
  const compact = s.replace(/\s+/g, '');
  const byCompact = departments.find((d) => d.code.toLowerCase().replace(/[^a-z0-9]/g, '') === compact.replace(/[^a-z0-9]/g, ''));
  return byCompact?.code ?? null;
}

function truthy(v: string | null): boolean {
  return Boolean(v && /^(y|yes|true|1|leader|captain|team leader)$/i.test(v.trim()));
}

function parseAmount(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && v.match(/\d/) ? Math.round(n * 100) : null;
}

/* ------------------------------------------------------------------ analysis */

export function analyzeImport(headers: string[], rows: string[][], mapping: Mapping, ctx: AnalyzeContext, options: AnalyzeOptions): Analysis {
  const issues: ImportIssueDTO[] = [];
  const col = (field: ImportField) => {
    const h = mapping[field];
    return h ? headers.indexOf(h) : -1;
  };
  const get = (row: string[], field: ImportField) => {
    const i = col(field);
    return i >= 0 ? clean(row[i]) : null;
  };
  const memberGroups = detectMemberGroups(headers);
  const layout: Layout = options.layout === 'auto' ? (memberGroups.size >= 2 ? 'per_registration' : 'per_participant') : options.layout;
  const issue = (i: Omit<ImportIssueDTO, 'registrationKey'> & { registrationKey?: string | null }) =>
    issues.push({ registrationKey: null, ...i });

  // Row numbers are 1-based and count the header line, matching what a spreadsheet shows.
  const rowNo = (i: number) => i + 2;

  /* ---- 1. rows → participants with their registration attributes */
  type Raw = { participant: ParsedParticipant | null; externalId: string | null; teamName: string | null; payment: string | null; reference: string | null; amount: number | null; rowIdx: number };
  const raws: Raw[] = [];
  const seenRowSignatures = new Map<string, number>();

  const toParticipant = (
    row: number,
    values: { name: string | null; email: string | null; roll: string | null; dept: string | null; phone: string | null },
    isLeader: boolean,
  ): ParsedParticipant | null => {
    if (!values.name && !values.email && !values.roll) return null; // empty member slot
    if (!values.name || !values.email) {
      issue({ code: 'missing_required', severity: 'error', rows: [row], message: `Row ${row}: ${!values.name ? 'name' : 'email'} is missing for ${values.name ?? values.email ?? values.roll}` });
      return null;
    }
    const email = normEmail(values.email);
    if (!EMAIL.test(email)) {
      issue({ code: 'invalid_email', severity: 'error', rows: [row], message: `Row ${row}: “${values.email}” is not a valid email address` });
      return null;
    }
    const department = resolveDepartment(values.dept, ctx.departments);
    if (values.dept && !department) {
      issue({ code: 'unrecognized_department', severity: 'warning', rows: [row], message: `Row ${row}: department “${values.dept}” is not configured; it will be left blank` });
    }
    return {
      row,
      name: values.name,
      email,
      rollNumber: values.roll ? values.roll.toUpperCase() : null,
      department,
      departmentRaw: values.dept,
      phone: values.phone,
      isLeader,
    };
  };

  rows.forEach((row, i) => {
    const r = rowNo(i);
    if (row.every((c) => !c || !c.trim())) return;
    const signature = row.map((c) => (c ?? '').trim().toLowerCase()).join('\u0001');
    if (seenRowSignatures.has(signature)) {
      issue({ code: 'duplicate_row', severity: 'warning', rows: [seenRowSignatures.get(signature)!, r], message: `Row ${r} repeats row ${seenRowSignatures.get(signature)} exactly; it will be ignored` });
      return;
    }
    seenRowSignatures.set(signature, r);
    const common = {
      externalId: get(row, 'externalId'),
      teamName: get(row, 'teamName'),
      payment: get(row, 'paymentStatus'),
      reference: get(row, 'paymentReference'),
      amount: parseAmount(get(row, 'amountPaid')),
      rowIdx: r,
    };
    const lead = toParticipant(
      r,
      { name: get(row, 'name'), email: get(row, 'email'), roll: get(row, 'rollNumber'), dept: get(row, 'department'), phone: get(row, 'phone') },
      layout === 'per_registration' ? true : truthy(get(row, 'isLeader')),
    );
    if (layout === 'per_participant') {
      raws.push({ ...common, participant: lead });
      return;
    }
    // per_registration: the mapped person is the leader; member columns add the rest.
    const people: (ParsedParticipant | null)[] = [lead];
    const sorted = [...memberGroups.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, g] of sorted) {
      const v = (idx: number | undefined) => (idx === undefined ? null : clean(row[idx]));
      const p = toParticipant(r, { name: v(g.name), email: v(g.email), roll: v(g.rollNumber), dept: v(g.department), phone: v(g.phone) }, false);
      if (p && lead && p.email === lead.email) continue; // member 1 often repeats the leader
      people.push(p);
    }
    if (!lead && people.some(Boolean)) {
      const first = people.find(Boolean)!;
      first.isLeader = true;
    }
    for (const p of people) raws.push({ ...common, participant: p });
  });

  /* ---- 2. group into registrations */
  const groups = new Map<string, ImportGroup>();
  const groupOrder: string[] = [];
  const hasExternal = col('externalId') >= 0;
  for (const raw of raws) {
    let key: string | null;
    if (ctx.mode === 'individual') {
      key = raw.externalId ? `id:${raw.externalId}` : raw.participant ? `email:${raw.participant.email}` : null;
      if (raw.externalId && layout === 'per_registration') key = `id:${raw.externalId}:${raw.participant?.email ?? raw.rowIdx}`;
    } else {
      key = raw.externalId ? `id:${raw.externalId}` : raw.teamName ? `team:${raw.teamName.toLowerCase()}` : layout === 'per_registration' ? `row:${raw.rowIdx}` : null;
    }
    if (!key) {
      issue({
        code: 'missing_required',
        severity: 'error',
        rows: [raw.rowIdx],
        message: `Row ${raw.rowIdx}: cannot tell which registration this belongs to (no registration ID or team name)`,
      });
      continue;
    }
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        externalId: raw.externalId,
        teamName: ctx.mode === 'team' ? raw.teamName : null,
        rows: [],
        participants: [],
        paymentSignal: 'unknown',
        paymentReference: null,
        amountPaid: null,
        match: null,
        action: 'create',
        paymentStatus: 'pending',
      };
      groups.set(key, g);
      groupOrder.push(key);
    }
    if (!g.rows.includes(raw.rowIdx)) g.rows.push(raw.rowIdx);
    if (ctx.mode === 'team' && raw.teamName && g.teamName && raw.teamName.toLowerCase() !== g.teamName.toLowerCase()) {
      issue({
        code: 'inconsistent_team',
        severity: 'warning',
        rows: [raw.rowIdx],
        registrationKey: key,
        message: `Row ${raw.rowIdx}: team name “${raw.teamName}” differs from “${g.teamName}” used by the same registration; “${g.teamName}” will be used`,
      });
    }
    if (!g.teamName && raw.teamName && ctx.mode === 'team') g.teamName = raw.teamName;
    if (raw.participant) {
      if (g.participants.some((p) => p.email === raw.participant!.email)) {
        issue({ code: 'duplicate_row', severity: 'warning', rows: [raw.rowIdx], registrationKey: key, message: `Row ${raw.rowIdx}: ${raw.participant.email} is listed twice in the same registration` });
      } else g.participants.push(raw.participant);
    }
    // Payment details: first non-empty value wins; disagreements are reported.
    const signal = paymentSignal(raw.payment);
    if (signal !== 'unknown') {
      if (g.paymentSignal !== 'unknown' && g.paymentSignal !== signal) {
        issue({ code: 'inconsistent_payment', severity: 'warning', rows: g.rows, registrationKey: key, message: `Registration ${g.externalId ?? g.teamName ?? key}: payment status differs between rows (“${g.paymentSignal}” vs “${signal}”)` });
      } else g.paymentSignal = signal;
    }
    if (raw.reference) {
      if (g.paymentReference && g.paymentReference !== raw.reference) {
        issue({ code: 'inconsistent_payment', severity: 'warning', rows: g.rows, registrationKey: key, message: `Registration ${g.externalId ?? g.teamName ?? key}: two different payment references (${g.paymentReference}, ${raw.reference}); the first is kept` });
      } else g.paymentReference = raw.reference;
    }
    if (raw.amount !== null && g.amountPaid === null) g.amountPaid = raw.amount;
  }

  // Team events: the same team name under different registration IDs.
  if (ctx.mode === 'team' && hasExternal) {
    const byTeam = new Map<string, ImportGroup[]>();
    for (const key of groupOrder) {
      const g = groups.get(key)!;
      if (!g.teamName) continue;
      const k = g.teamName.toLowerCase();
      byTeam.set(k, [...(byTeam.get(k) ?? []), g]);
    }
    for (const [, list] of byTeam) {
      if (list.length < 2) continue;
      const id = `team:${list.map((g) => g.key).join('|')}`.slice(0, 80);
      const decision = options.decisions[id];
      issue({
        code: 'inconsistent_team',
        severity: 'review',
        rows: list.flatMap((g) => g.rows),
        registrationKey: list[0]!.key,
        message: `Team name “${list[0]!.teamName}” appears under registration IDs ${list.map((g) => g.externalId).join(', ')}`,
        review: {
          id,
          options: [
            { value: 'separate', label: 'Keep separate registrations (later ones get a numbered suffix)' },
            { value: 'merge', label: `Merge into one registration (${list[0]!.externalId})` },
          ],
          default: 'separate',
        },
      });
      if (decision === 'merge') {
        const [head, ...rest] = list;
        for (const g of rest) {
          for (const p of g.participants) if (!head!.participants.some((x) => x.email === p.email)) head!.participants.push(p);
          head!.rows.push(...g.rows);
          groups.delete(g.key);
        }
      } else if (decision === 'separate') {
        list.slice(1).forEach((g, i) => (g.teamName = `${g.teamName} (${i + 2})`));
      }
    }
  }

  /* ---- 3. people appearing in several registrations / possibly the same person */
  const live = () => groupOrder.map((k) => groups.get(k)).filter(Boolean) as ImportGroup[];
  const byEmail = new Map<string, ImportGroup[]>();
  for (const g of live()) for (const p of g.participants) byEmail.set(p.email, [...(byEmail.get(p.email) ?? []), g]);
  for (const [email, list] of byEmail) {
    if (list.length < 2) continue;
    const id = `person:${email}`.slice(0, 80);
    const label = (g: ImportGroup) => g.externalId ?? g.teamName ?? g.key;
    issue({
      code: 'duplicate_participant',
      severity: 'review',
      rows: list.flatMap((g) => g.participants.filter((p) => p.email === email).map((p) => p.row)),
      registrationKey: list[0]!.key,
      message: `${email} appears in ${list.length} registrations (${list.map(label).join(', ')}); a person can only be registered once`,
      review: {
        id,
        options: [
          ...list.map((g) => ({ value: `keep:${g.key}`, label: `Keep in ${label(g)}` })),
          { value: 'drop', label: 'Leave this person out of the import' },
        ],
        default: `keep:${list[0]!.key}`,
      },
    });
    const decision = options.decisions[id];
    if (decision) {
      for (const g of list) {
        if (decision === `keep:${g.key}`) continue;
        g.participants = g.participants.filter((p) => p.email !== email);
      }
    }
  }

  const byRoll = new Map<string, { email: string; row: number | null; name: string }[]>();
  for (const g of live()) {
    for (const p of g.participants) {
      if (!p.rollNumber) continue;
      const list = byRoll.get(p.rollNumber) ?? [];
      if (!list.some((x) => x.email === p.email)) list.push({ email: p.email, row: p.row, name: p.name });
      byRoll.set(p.rollNumber, list);
    }
  }
  for (const [email, u] of ctx.existingUsers) {
    if (!u.rollNumber || !byRoll.has(u.rollNumber)) continue;
    const list = byRoll.get(u.rollNumber)!;
    if (!list.some((x) => x.email === email)) list.push({ email, row: null, name: u.name });
  }
  for (const [roll, list] of byRoll) {
    if (list.length < 2) continue;
    const id = `roll:${roll}`.slice(0, 80);
    const fileRows = list.filter((x) => x.row !== null);
    issue({
      code: 'possible_same_person',
      severity: 'review',
      rows: fileRows.map((x) => x.row!) ,
      registrationKey: null,
      message: `Roll number ${roll} is used by ${list.map((x) => `${x.name} <${x.email}>`).join(' and ')}. These may be the same person with two emails.`,
      review: {
        id,
        options: [
          { value: 'distinct', label: 'They are different people — import as listed' },
          ...fileRows.map((x) => ({ value: `drop:${x.email}`, label: `Leave out ${x.email} (row ${x.row})` })),
        ],
        default: 'distinct',
      },
    });
    const decision = options.decisions[id];
    if (decision?.startsWith('drop:')) {
      const email = decision.slice(5);
      for (const g of live()) g.participants = g.participants.filter((p) => p.email !== email);
    }
  }

  /* ---- 4. per-registration validation, matching and payment interpretation */
  const existingById = new Map(ctx.existingRegistrations.filter((r) => r.externalId).map((r) => [r.externalId!, r]));
  const existingByTeam = new Map(ctx.existingRegistrations.filter((r) => r.teamName).map((r) => [r.teamName!.toLowerCase(), r]));
  const existingByEmail = new Map<string, ExistingRegistration>();
  ctx.existingRegistrations.forEach((r) => r.participantEmails.forEach((e) => existingByEmail.set(e, r)));
  const fileRefs = new Map<string, string[]>();

  for (const g of live()) {
    const label = g.externalId ?? g.teamName ?? g.participants[0]?.email ?? g.key;
    if (!g.participants.length) {
      g.action = 'skip';
      continue;
    }
    if (ctx.mode === 'individual' && g.participants.length > 1) {
      issue({ code: 'mode_mismatch', severity: 'error', rows: g.rows, registrationKey: g.key, message: `${label}: ${g.participants.length} people share one registration, but this is an individual event` });
      g.action = 'skip';
      continue;
    }
    if (ctx.mode === 'individual' && g.teamName) {
      issue({ code: 'mode_mismatch', severity: 'warning', rows: g.rows, registrationKey: g.key, message: `${label}: team name ignored for an individual event` });
    }
    if (ctx.mode === 'team') {
      if (!g.teamName) {
        issue({ code: 'missing_required', severity: 'error', rows: g.rows, registrationKey: g.key, message: `${label}: team name is missing` });
        g.action = 'skip';
        continue;
      }
      if (g.participants.length > ctx.teamSize.max) {
        issue({ code: 'team_too_large', severity: 'error', rows: g.rows, registrationKey: g.key, message: `${label}: ${g.participants.length} members exceeds the maximum of ${ctx.teamSize.max}` });
        g.action = 'skip';
        continue;
      }
      if (g.participants.length < ctx.teamSize.min) {
        issue({ code: 'team_too_small', severity: 'warning', rows: g.rows, registrationKey: g.key, message: `${label}: ${g.participants.length} member${g.participants.length === 1 ? '' : 's'}, below the minimum of ${ctx.teamSize.min}; it will be imported as incomplete` });
      }
      const leaders = g.participants.filter((p) => p.isLeader);
      if (leaders.length !== 1) {
        g.participants.forEach((p, i) => (p.isLeader = i === 0));
      }
    }

    g.match =
      (g.externalId ? existingById.get(g.externalId) : undefined) ??
      (ctx.mode === 'team' && g.teamName ? existingByTeam.get(g.teamName.toLowerCase()) : undefined) ??
      (ctx.mode === 'individual' ? existingByEmail.get(g.participants[0]!.email) : undefined) ??
      null;

    // Someone in this group is already registered elsewhere in the event.
    const elsewhere = g.participants
      .map((p) => ({ p, reg: existingByEmail.get(p.email) }))
      .filter((x) => x.reg && x.reg.id !== g.match?.id);
    if (elsewhere.length) {
      issue({
        code: 'participant_in_other_registration',
        severity: 'error',
        rows: g.rows,
        registrationKey: g.key,
        message: `${label}: ${elsewhere.map((x) => `${x.p.email} is already in ${x.reg!.code}`).join('; ')}. Resolve it in the registration list first.`,
      });
      g.action = 'skip';
      continue;
    }

    // Payment.
    if (ctx.feeAmount === 0) {
      if (g.paymentSignal === 'paid' || g.paymentReference) {
        issue({ code: 'inconsistent_payment', severity: 'warning', rows: g.rows, registrationKey: g.key, message: `${label}: payment details given but this event is free; they will be ignored` });
      }
      g.paymentStatus = 'not_required';
    } else {
      if (g.paymentSignal === 'paid' && !g.paymentReference) {
        issue({ code: 'inconsistent_payment', severity: 'warning', rows: g.rows, registrationKey: g.key, message: `${label}: marked paid but no transaction reference is given` });
      }
      if (g.paymentSignal !== 'paid' && g.paymentReference) {
        issue({ code: 'inconsistent_payment', severity: 'warning', rows: g.rows, registrationKey: g.key, message: `${label}: has a reference (${g.paymentReference}) but payment status is “${g.paymentSignal}”; it will need verification` });
      }
      if (g.amountPaid !== null && g.amountPaid !== ctx.feeAmount && g.paymentSignal === 'paid') {
        issue({ code: 'inconsistent_payment', severity: 'warning', rows: g.rows, registrationKey: g.key, message: `${label}: amount paid (₹${g.amountPaid / 100}) differs from the fee (₹${ctx.feeAmount / 100})` });
      }
      g.paymentStatus = g.paymentSignal === 'paid' && options.treatPaidAsVerified ? 'verified' : 'pending';
      if (g.paymentReference) {
        const k = g.paymentReference.toUpperCase().replace(/[^A-Z0-9]/g, '');
        fileRefs.set(k, [...(fileRefs.get(k) ?? []), label]);
        const prior = (ctx.existingReferences.get(k) ?? []).filter((code) => code !== g.match?.code);
        if (prior.length) {
          issue({ code: 'duplicate_payment_reference', severity: 'warning', rows: g.rows, registrationKey: g.key, message: `${label}: reference ${g.paymentReference} is already used by ${prior.join(', ')}` });
        }
      }
    }

    if (g.match) {
      const emails = new Set(g.match.participantEmails);
      const sameMembers = g.participants.length === emails.size && g.participants.every((p) => emails.has(p.email));
      const sameTeam = ctx.mode === 'individual' || (g.match.teamName ?? '').toLowerCase() === (g.teamName ?? '').toLowerCase();
      const sameRef = !g.paymentReference || g.paymentReference === g.match.paymentReference;
      const statusUpgrade = g.paymentStatus === 'verified' && g.match.paymentStatus === 'pending';
      g.action = sameMembers && sameTeam && sameRef && !statusUpgrade ? 'unchanged' : 'update';
      const missing = g.match.participantEmails.filter((e) => !g.participants.some((p) => p.email === e));
      if (missing.length) {
        issue({ code: 'inconsistent_team', severity: 'warning', rows: g.rows, registrationKey: g.key, message: `${label}: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} registered but not in this file — kept, not removed` });
      }
      if (ctx.mode === 'team' && g.participants.length + missing.length > ctx.teamSize.max) {
        issue({ code: 'team_too_large', severity: 'error', rows: g.rows, registrationKey: g.key, message: `${label}: adding these members would exceed the maximum of ${ctx.teamSize.max}` });
        g.action = 'skip';
      }
    } else g.action = 'create';
  }

  for (const [ref, labels] of fileRefs) {
    if (labels.length > 1) {
      issue({ code: 'duplicate_payment_reference', severity: 'warning', rows: [], message: `Reference ${ref} is quoted by ${labels.join(', ')}` });
    }
  }

  const creates = live().filter((g) => g.action === 'create').length;
  if (ctx.capacity != null && ctx.activeRegistrations + creates > ctx.capacity) {
    issue({ code: 'capacity_exceeded', severity: 'warning', rows: [], message: `Importing ${creates} new registrations takes the event to ${ctx.activeRegistrations + creates}, over its capacity of ${ctx.capacity}` });
  }

  const unresolvedReviews = issues.filter((i) => i.review && !options.decisions[i.review.id]).map((i) => i.review!.id);
  return { layout, groups: live(), issues, unresolvedReviews };
}
