import { describe, expect, it } from 'vitest';
import { amountDue, computeRegistrationStatus, type StatusInput } from '../../src/modules/registrations/status';

const base: StatusInput = { kind: 'team', memberCount: 3, teamMin: 2, paymentRequired: true, paymentStatus: 'verified', hasReference: true, requiresApproval: false, approved: null };

describe('computeRegistrationStatus', () => {
  it('is incomplete while a team is below its minimum, regardless of payment', () => {
    expect(computeRegistrationStatus({ ...base, memberCount: 1 })).toEqual({ status: 'incomplete', reason: 'Needs 1 more member (minimum 2)' });
  });
  it('waits for a payment reference, then for verification', () => {
    expect(computeRegistrationStatus({ ...base, paymentStatus: 'pending', hasReference: false }).reason).toMatch(/not yet submitted/);
    expect(computeRegistrationStatus({ ...base, paymentStatus: 'pending', hasReference: true }).reason).toMatch(/awaiting organizer verification/);
    expect(computeRegistrationStatus({ ...base, paymentStatus: 'rejected' }).status).toBe('pending');
  });
  it('requires approval after payment when configured', () => {
    expect(computeRegistrationStatus({ ...base, requiresApproval: true, approved: null })).toEqual({ status: 'pending', reason: 'Awaiting organizer approval' });
    expect(computeRegistrationStatus({ ...base, requiresApproval: true, approved: true }).status).toBe('confirmed');
  });
  it('confirms free individual registrations immediately', () => {
    expect(computeRegistrationStatus({ ...base, kind: 'individual', memberCount: 1, paymentRequired: false, paymentStatus: 'not_required' }).status).toBe('confirmed');
  });
});

describe('amountDue', () => {
  it('charges per registration or per participant', () => {
    expect(amountDue({ amount: 40000, basis: 'per_registration' }, 4)).toBe(40000);
    expect(amountDue({ amount: 10000, basis: 'per_participant' }, 4)).toBe(40000);
  });
});
