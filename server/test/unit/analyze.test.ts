import { readFileSync } from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { analyzeImport, paymentSignal, resolveDepartment, suggestMapping, type AnalyzeContext } from '../../src/modules/imports/analyze';

const csv = readFileSync(path.resolve(__dirname, '../../../docs/samples/registration-export-sample.csv'), 'utf8');
const [headers, ...rows] = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data as string[][];

const ctx = (over: Partial<AnalyzeContext> = {}): AnalyzeContext => ({
  mode: 'team',
  teamSize: { min: 2, max: 4 },
  feeAmount: 40000,
  capacity: null,
  activeRegistrations: 0,
  departments: [
    { code: 'CSE', name: 'Computer Science & Engineering' },
    { code: 'CSD', name: 'CSE (Data Science)' },
    { code: 'CSC', name: 'CSE (Cyber Security)' },
    { code: 'IT', name: 'Information Technology' },
    { code: 'ECE', name: 'Electronics & Communication Engineering' },
    { code: 'EEE', name: 'Electrical & Electronics Engineering' },
    { code: 'MECH', name: 'Mechanical Engineering' },
  ],
  existingRegistrations: [],
  existingUsers: new Map(),
  existingReferences: new Map(),
  ...over,
});

const opts = (decisions: Record<string, string> = {}) => ({ layout: 'auto' as const, treatPaidAsVerified: false, decisions });

describe('suggestMapping', () => {
  it('maps a typical form export, including leader and member columns', () => {
    const s = suggestMapping(headers!);
    expect(s.layout).toBe('per_registration');
    expect(s.memberGroups).toBe(4);
    expect(s.mapping).toMatchObject({
      externalId: 'Response ID',
      teamName: 'Team Name',
      name: 'Team Leader Name',
      email: 'Team Leader Email',
      rollNumber: 'Leader Roll No',
      department: 'Leader Branch',
      phone: 'Leader Phone',
      paymentStatus: 'Payment Status',
      paymentReference: 'Transaction ID',
      amountPaid: 'Amount',
    });
  });
});

describe('analyzeImport on the sample export', () => {
  const mapping = suggestMapping(headers!).mapping;
  const a = analyzeImport(headers!, rows, mapping, ctx(), opts());
  const codes = (code: string) => a.issues.filter((i) => i.code === code);

  it('flags a byte-identical duplicate line and ignores it', () => {
    expect(codes('duplicate_row')).toHaveLength(1);
    expect(a.groups.find((g) => g.externalId === 'R-1001')!.participants).toHaveLength(3);
  });
  it('treats a team resubmitted under a new response ID as a decision, not a silent drop', () => {
    const review = codes('inconsistent_team').find((i) => i.severity === 'review')!;
    expect(review.message).toMatch(/Lambda Lions/);
    expect(review.message).toMatch(/R-1002/);
    expect(review.message).toMatch(/R-1005/);
    expect(review.review!.options.map((o) => o.value)).toEqual(['separate', 'merge']);
  });
  it('reports a member with no email and imports the team as incomplete', () => {
    expect(codes('missing_required').some((i) => i.message.includes('Vivek Rao'))).toBe(true);
    const overflow = a.groups.find((g) => g.externalId === 'R-1003')!;
    expect(overflow.participants).toHaveLength(1);
    expect(codes('team_too_small').some((i) => i.registrationKey === overflow.key)).toBe(true);
    expect(overflow.action).toBe('create');
  });
  it('skips a team larger than the maximum', () => {
    expect(a.groups.find((g) => g.externalId === 'R-1004')!.action).toBe('skip');
    expect(codes('team_too_large')).toHaveLength(1);
  });
  it('asks for a decision when one person appears in two teams', () => {
    const review = codes('duplicate_participant')[0]!;
    expect(review.severity).toBe('review');
    expect(review.message).toMatch(/kavya\.iyer@example\.edu/);
    expect(a.unresolvedReviews).toContain(review.review!.id);
  });
  it('flags one roll number used under two emails without merging anyone', () => {
    const review = codes('possible_same_person')[0]!;
    expect(review.message).toMatch(/24DM01X002/);
    // Both people are still present until the organizer decides.
    expect(a.groups.flatMap((g) => g.participants).filter((p) => p.rollNumber === '24DM01X002').length).toBeGreaterThanOrEqual(2);
  });
  it('warns about an unrecognised department but resolves known variants', () => {
    expect(codes('unrecognized_department').some((i) => i.message.includes('CSE(AI&ML)'))).toBe(true);
    expect(resolveDepartment('Mech', ctx().departments)).toBe('MECH');
    expect(resolveDepartment('Computer Science & Engineering', ctx().departments)).toBe('CSE');
  });
  it('flags inconsistent payments and reused references', () => {
    expect(codes('inconsistent_payment').some((i) => i.message.includes('no transaction reference'))).toBe(true);
    expect(codes('duplicate_payment_reference').some((i) => i.message.includes('512345678901'))).toBe(true);
  });
  it('rejects an invalid email', () => {
    expect(codes('invalid_email')).toHaveLength(1);
  });
  it('keeps imported payments unverified unless told otherwise', () => {
    expect(a.groups.find((g) => g.externalId === 'R-1001')!.paymentStatus).toBe('pending');
    const trusted = analyzeImport(headers!, rows, mapping, ctx(), { ...opts(), treatPaidAsVerified: true });
    expect(trusted.groups.find((g) => g.externalId === 'R-1001')!.paymentStatus).toBe('verified');
  });
  it('applies decisions: keep a duplicated person in one team only', () => {
    const review = codes('duplicate_participant')[0]!;
    const keepFirst = review.review!.options[0]!.value;
    const decided = analyzeImport(headers!, rows, mapping, ctx(), opts({ [review.review!.id]: keepFirst }));
    const holders = decided.groups.filter((g) => g.participants.some((p) => p.email === 'kavya.iyer@example.edu'));
    expect(holders).toHaveLength(1);
  });
});

describe('idempotency against existing records', () => {
  it('marks matching registrations unchanged on re-import', () => {
    const mapping = suggestMapping(headers!).mapping;
    const first = analyzeImport(headers!, rows, mapping, ctx(), opts());
    const g = first.groups.find((x) => x.externalId === 'R-1002')!;
    const again = analyzeImport(headers!, rows, mapping, ctx({
      existingRegistrations: [{ id: 'r', code: 'X-0001', externalId: 'R-1002', teamName: 'Lambda Lions', participantEmails: g.participants.map((p) => p.email), paymentStatus: 'pending', paymentReference: '512345678902' }],
    }), opts());
    expect(again.groups.find((x) => x.externalId === 'R-1002')!.action).toBe('unchanged');
  });
});

describe('paymentSignal', () => {
  it('normalises common status words', () => {
    expect(paymentSignal('Paid')).toBe('paid');
    expect(paymentSignal('SUCCESS')).toBe('paid');
    expect(paymentSignal('Pending')).toBe('pending');
    expect(paymentSignal('Failed')).toBe('failed');
    expect(paymentSignal('Refunded')).toBe('refunded');
    expect(paymentSignal(null)).toBe('unknown');
  });
});
