import type { PaymentStatus, RegistrationMode, RegistrationStatus } from '@campusflow/shared';

export interface StatusInput {
  kind: RegistrationMode;
  memberCount: number;
  teamMin: number;
  paymentRequired: boolean;
  paymentStatus: PaymentStatus;
  hasReference: boolean;
  requiresApproval: boolean;
  approved: boolean | null;
}

/**
 * Derive the status of an active registration from the records it depends on.
 * Order matters: a team must be complete before payment or approval are considered.
 * Cancelled and rejected registrations are terminal and never passed here.
 */
export function computeRegistrationStatus(i: StatusInput): { status: Exclude<RegistrationStatus, 'cancelled' | 'rejected'>; reason: string } {
  if (i.kind === 'team' && i.memberCount < i.teamMin) {
    const missing = i.teamMin - i.memberCount;
    return {
      status: 'incomplete',
      reason: `Needs ${missing} more member${missing === 1 ? '' : 's'} (minimum ${i.teamMin})`,
    };
  }
  if (i.paymentRequired && i.paymentStatus !== 'verified') {
    if (i.paymentStatus === 'rejected') return { status: 'pending', reason: 'Payment was rejected — submit a corrected reference' };
    if (i.paymentStatus === 'refunded') return { status: 'pending', reason: 'Payment was refunded' };
    return {
      status: 'pending',
      reason: i.hasReference ? 'Payment awaiting organizer verification' : 'Payment reference not yet submitted',
    };
  }
  if (i.requiresApproval && i.approved !== true) {
    return { status: 'pending', reason: 'Awaiting organizer approval' };
  }
  return { status: 'confirmed', reason: '' };
}

export function amountDue(fee: { amount: number; basis: 'per_registration' | 'per_participant' }, memberCount: number): number {
  return fee.basis === 'per_participant' ? fee.amount * Math.max(memberCount, 1) : fee.amount;
}
