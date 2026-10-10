import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Ban, Copy, Crown, TriangleAlert, Undo2, X } from 'lucide-react';
import { formatMoney, LABELS, type RegistrationDTO } from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useFormat, relativeTime } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { FormAlert } from '../../components/ui/Form';
import { LoadingBlock, ErrorState } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { useToast } from '../../components/ui/Toast';
import { useEventChannel } from '../../lib/realtime';
import { RegistrationProgress } from '../participant/Progress';
import { RegistrationDocuments, documentsKey } from '../documents/RegistrationDocuments';

/** Keeps workspace lists in sync with writes made elsewhere (other organizers, the gate). */
export function useLiveInvalidation(eventId: string | undefined) {
  const qc = useQueryClient();
  return useEventChannel(eventId, {
    onUpdate: (u) => {
      if (u.type === 'registration.changed' || u.type === 'payment.changed') {
        qc.invalidateQueries({ queryKey: ['registrations', eventId] });
        qc.invalidateQueries({ queryKey: ['registration', u.registrationId as string] });
        qc.invalidateQueries({ queryKey: documentsKey(u.registrationId as string) });
        qc.invalidateQueries({ queryKey: ['teams', eventId] });
      }
      if (u.type === 'checkin.created' || u.type === 'checkin.voided') {
        qc.invalidateQueries({ queryKey: ['checkins', eventId] });
        qc.invalidateQueries({ queryKey: ['teams', eventId] });
      }
      qc.invalidateQueries({ queryKey: ['report', eventId] });
    },
    onResync: () => {
      qc.invalidateQueries({ queryKey: ['registrations', eventId] });
      qc.invalidateQueries({ queryKey: ['checkins', eventId] });
    },
  });
}

type Pending = { kind: 'reject_payment' | 'reject_reg' | 'cancel' | 'refund' } | null;

export function RegistrationDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const q = useQuery({ queryKey: ['registration', id], queryFn: () => api<RegistrationDTO>(`/registrations/${id}`), enabled: Boolean(id) });
  const r = q.data;

  const done = (reg: RegistrationDTO, title: string) => {
    qc.setQueryData(['registration', reg.id], reg);
    qc.invalidateQueries({ queryKey: ['registrations', reg.event.id] });
    qc.invalidateQueries({ queryKey: ['teams', reg.event.id] });
    qc.invalidateQueries({ queryKey: ['workspace'] });
    toast({ tone: 'ok', title });
  };
  const verify = useMutation({
    mutationFn: () => api<RegistrationDTO>(`/registrations/${id}/payment/decision`, { method: 'POST', body: { decision: 'verified', note: '' } }),
    onSuccess: (reg) => done(reg, `Payment verified · ${reg.code} is now ${LABELS.registrationStatus[reg.status].toLowerCase()}`),
    onError: (err) => toast({ tone: 'bad', title: 'Not verified', body: errorMessage(err) }),
  });
  const approve = useMutation({
    mutationFn: () => api<RegistrationDTO>(`/registrations/${id}/review`, { method: 'POST', body: { decision: 'approve', note: '' } }),
    onSuccess: (reg) => done(reg, `${reg.code} approved`),
    onError: (err) => toast({ tone: 'bad', title: 'Not approved', body: errorMessage(err) }),
  });

  const closed = r && (r.status === 'cancelled' || r.status === 'rejected');
  return (
    <Dialog
      open={Boolean(id)}
      onClose={onClose}
      variant="drawer"
      title={r ? (r.team?.name ?? r.primary.name) : 'Registration'}
      description={
        r ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-paper-2">{r.code}</span>
            <StatusPill kind="registration" value={r.status} />
            {r.externalId && <span className="text-xs text-paper-3">External ID {r.externalId}</span>}
          </span>
        ) : undefined
      }
    >
      {q.isError && q.error instanceof ApiError && q.error.status === 404 ? (
        <div className="space-y-4 text-sm">
          <p className="text-paper">This registration doesn’t exist, or you can’t see it.</p>
          <p className="text-paper-2">The link may point to a registration of another event, one you don’t manage, or data that was reset (for example by <span className="font-mono text-[13px]">npm run demo:reset</span>).</p>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !r ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-8 text-sm">
          <RegistrationProgress registration={r} />
          {r.statusReason && (
            <p className="rounded-[var(--radius-sm)] bg-ink-850 px-3 py-2 text-paper-2">
              <span className="text-paper-3">Status detail · </span>
              {r.statusReason}
            </p>
          )}

          <section>
            <h3 className="kicker mb-2 text-paper-3">
              {r.kind === 'team' ? `Members · ${r.participants.length} of ${r.event.teamSize.max} (min ${r.event.teamSize.min})` : 'Participant'}
            </h3>
            <ul className="divide-y divide-line rounded-[var(--radius-sm)] border border-line">
              {r.participants.map((p) => (
                <li key={p.id} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-paper">
                      {p.name}
                      {p.isLeader && r.kind === 'team' && <Crown className="size-3.5 text-signal" aria-label="Team leader" />}
                      {!p.claimed && <span className="kicker !text-[9px] text-paper-3" title="Imported; the person has not signed in yet">imported</span>}
                    </p>
                    <p className="truncate text-xs text-paper-3">{[p.email, p.rollNumber, p.department, p.phone].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    {p.ticket ? (
                      <>
                        <span className="font-mono text-xs text-paper-2">{p.ticket.shortCode}</span>
                        <StatusPill kind="ticket" value={p.ticket.status} />
                      </>
                    ) : (
                      <span className="text-xs text-paper-3">No ticket</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {r.team?.code && (
              <p className="mt-2 text-xs text-paper-3">
                Join code <span className="font-mono text-paper-2">{r.team.code.slice(0, 4)}-{r.team.code.slice(4)}</span> · valid until {fmt.dateTime(r.team.codeExpiresAt!)}
              </p>
            )}
          </section>

          {r.payment.required && (
            <section>
              <h3 className="kicker mb-2 text-paper-3">Payment</h3>
              <div className="grid grid-cols-2 gap-4 rounded-[var(--radius-sm)] border border-line p-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-paper-3">Amount due</p>
                  <p className="tnum mt-0.5 text-lg font-semibold">{formatMoney(r.payment.amountDue, r.payment.currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-paper-3">Status</p>
                  <div className="mt-1">
                    <StatusPill kind="payment" value={r.payment.status} label={r.payment.status === 'pending' ? (r.payment.reference ? 'Awaiting verification' : 'Awaiting reference') : undefined} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-paper-3">Reference</p>
                  <p className="mt-0.5 break-all font-mono text-paper">{r.payment.reference ?? '—'}</p>
                  {r.payment.payerName && <p className="text-xs text-paper-3">paid by {r.payment.payerName}</p>}
                </div>
              </div>
              {r.payment.duplicateReferenceOf.length > 0 && (
                <div className="mt-3">
                  <FormAlert tone="warn">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Copy className="size-3.5" /> Same reference used by {r.payment.duplicateReferenceOf.join(', ')}
                    </span>
                    <span className="block text-paper-2">Check your statement before verifying — one payment may have been quoted twice.</span>
                  </FormAlert>
                </div>
              )}
              {r.payment.decidedAt && (
                <p className="mt-2 text-xs text-paper-3">
                  {LABELS.paymentStatus[r.payment.status]} by {r.payment.decidedBy?.name ?? 'an organizer'} · {fmt.dateTime(r.payment.decidedAt)}
                  {r.payment.note ? ` · “${r.payment.note}”` : ''}
                </p>
              )}
              {!closed && r.payment.status === 'pending' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" icon={<BadgeCheck className="size-3.5" />} loading={verify.isPending} onClick={() => verify.mutate()}>
                    {r.payment.reference ? 'Mark verified' : 'Mark received (no reference)'}
                  </Button>
                  <Button variant="danger" size="sm" icon={<X className="size-3.5" />} onClick={() => setPending({ kind: 'reject_payment' })}>
                    Reject payment
                  </Button>
                </div>
              )}
              {closed && r.payment.status === 'verified' && (
                <Button className="mt-3" size="sm" icon={<Undo2 className="size-3.5" />} onClick={() => setPending({ kind: 'refund' })}>
                  Record refund
                </Button>
              )}
              <p className="mt-3 text-xs text-paper-3">Verification records your decision; it does not move money or check a bank account.</p>
            </section>
          )}

          {r.approval.required && !closed && (
            <section>
              <h3 className="kicker mb-2 text-paper-3">Approval</h3>
              {r.approval.decidedAt ? (
                <p className="text-paper-2">
                  Approved by {r.approval.decidedBy?.name} · {fmt.dateTime(r.approval.decidedAt)}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setPending({ kind: 'reject_reg' })}>
                    Reject registration
                  </Button>
                </div>
              )}
            </section>
          )}

          <RegistrationDocuments
            registrationId={r.id}
            eventId={r.event.id}
            mode="organizer"
            closed={Boolean(closed)}
            heading={(content) =>
              content && (
                <section>
                  <h3 className="kicker mb-3 text-paper-3">Documents & participation</h3>
                  {content}
                </section>
              )
            }
          />

          <section className="space-y-1 text-xs text-paper-3">
            <p>
              Registered {fmt.dateTime(r.createdAt)} ({relativeTime(r.createdAt)}) · {r.source === 'import' ? 'imported from a file' : 'via CAMPUSFLOW'}
            </p>
            {r.cancelledAt && (
              <p>
                Closed {fmt.dateTime(r.cancelledAt)}
                {r.cancelReason ? ` — “${r.cancelReason}”` : ''}
              </p>
            )}
          </section>

          {!closed && (
            <section className="border-t border-line pt-5">
              <Button variant="danger" size="sm" icon={<TriangleAlert className="size-3.5" />} onClick={() => setPending({ kind: 'cancel' })}>
                Cancel registration
              </Button>
            </section>
          )}
        </div>
      )}

      {r && (
        <ConfirmDialog
          open={pending !== null}
          onClose={() => setPending(null)}
          title={
            pending?.kind === 'reject_payment'
              ? 'Reject this payment?'
              : pending?.kind === 'reject_reg'
                ? 'Reject this registration?'
                : pending?.kind === 'refund'
                  ? 'Record a refund?'
                  : 'Cancel this registration?'
          }
          description={
            pending?.kind === 'reject_payment'
              ? `${r.code} stays pending and the leader is asked to submit a corrected reference.`
              : pending?.kind === 'reject_reg'
                ? `${r.code} is closed, its slot is released and every ticket is voided. The participant sees your reason.`
                : pending?.kind === 'refund'
                  ? 'Marks the verified payment as refunded. Only do this after the money has actually been returned.'
                  : `${r.code} is closed, its slot is released${r.kind === 'team' ? ', the team is disbanded' : ''} and every ticket is voided.`
          }
          confirmLabel={pending?.kind === 'refund' ? 'Record refund' : pending?.kind === 'cancel' ? 'Cancel registration' : 'Reject'}
          reason={{
            label: pending?.kind === 'refund' ? 'How was it refunded?' : 'Reason',
            required: pending?.kind !== 'cancel',
            minLength: 3,
          }}
          onConfirm={async (reason) => {
            const path =
              pending?.kind === 'reject_payment'
                ? ['payment/decision', { decision: 'rejected', note: reason }]
                : pending?.kind === 'reject_reg'
                  ? ['review', { decision: 'reject', note: reason }]
                  : pending?.kind === 'refund'
                    ? ['payment/refund', { note: reason }]
                    : ['cancel', { reason }];
            const reg = await api<RegistrationDTO>(`/registrations/${r.id}/${path[0]}`, { method: 'POST', body: path[1] });
            done(reg, pending?.kind === 'refund' ? 'Refund recorded' : pending?.kind === 'cancel' ? 'Registration cancelled' : 'Rejected');
          }}
        />
      )}
    </Dialog>
  );
}
