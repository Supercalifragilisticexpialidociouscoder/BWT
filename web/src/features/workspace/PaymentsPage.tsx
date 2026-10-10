import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Copy, Download, X } from 'lucide-react';
import clsx from 'clsx';
import { formatMoney, type Page, type RegistrationDTO, type RegistrationRowDTO, type ReportDTO, type WorkspaceEventDTO } from '@campusflow/shared';
import { api, errorMessage } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { ChannelBadge, EventScoped } from './RegistrationsPage';
import { RegistrationDrawer } from './RegistrationDrawer';

type Stage = 'awaiting_verification' | 'awaiting_reference' | 'verified' | 'rejected' | 'all';

export function PaymentsPage() {
  return <EventScoped>{(event) => <Payments event={event} />}</EventScoped>;
}

const keyOf = (ref: string | null) => (ref ? ref.toUpperCase().replace(/[^A-Z0-9]/g, '') : null);

function Payments({ event }: { event: WorkspaceEventDTO }) {
  const [params, setParams] = useSearchParams();
  const stage = (params.get('stage') as Stage) || 'awaiting_verification';
  const openId = params.get('reg');
  const qc = useQueryClient();
  const toast = useToast();
  const [rejecting, setRejecting] = useState<RegistrationRowDTO | null>(null);
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); v ? n.set(k, v) : n.delete(k); return n; }, { replace: true });

  const query =
    stage === 'awaiting_verification' || stage === 'awaiting_reference'
      ? { paymentStage: stage }
      : stage === 'all'
        ? {}
        : { payment: stage };
  const list = useQuery({
    queryKey: ['registrations', event.id, 'payments', stage],
    queryFn: () => api<Page<RegistrationRowDTO>>(`/events/${event.id}/registrations`, { query: { ...query, sort: 'createdAt', pageSize: 100 } }),
  });
  const report = useQuery({ queryKey: ['report', event.id], queryFn: () => api<ReportDTO>(`/events/${event.id}/report`) });
  const rows = (list.data?.items ?? []).filter((r) => stage !== 'all' || r.payment.status !== 'not_required');
  const dupKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of list.data?.items ?? []) {
      const k = keyOf(r.payment.reference);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  }, [list.data]);

  const verify = useMutation({
    mutationFn: (id: string) => api<RegistrationDTO>(`/registrations/${id}/payment/decision`, { method: 'POST', body: { decision: 'verified', note: '' } }),
    onSuccess: (reg) => {
      qc.invalidateQueries({ queryKey: ['registrations', event.id] });
      qc.invalidateQueries({ queryKey: ['report', event.id] });
      qc.invalidateQueries({ queryKey: ['workspace'] });
      toast({ tone: 'ok', title: `${reg.code} verified`, body: reg.status === 'confirmed' ? 'Tickets issued.' : reg.statusReason });
    },
    onError: (err) => toast({ tone: 'bad', title: 'Not verified', body: errorMessage(err) }),
  });

  if (event.fee.amount === 0) {
    return (
      <div className="space-y-6">
        <PageHeader kicker={event.title} title="Payments" />
        <EmptyState title="This event is free" body="No payment records are kept for free events. Set a fee in the event’s registration settings if that changes." />
      </div>
    );
  }
  const by = report.data?.payments.byStatus;
  return (
    <div className="space-y-6">
      <PageHeader
        kicker={event.title}
        title="Payments"
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span>Match each reference against your account statement, then verify. Verified registrations get tickets automatically.</span>
            <ChannelBadge eventId={event.id} />
          </span>
        }
        actions={
          <a href={`/api/events/${event.id}/exports/payments.csv`} className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-ink-800 px-3 text-[13px] text-paper hover:border-line-strong">
            <Download className="size-3.5" /> Export CSV
          </a>
        }
      />
      {by && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border border-line bg-line sm:grid-cols-4">
          {(['pending', 'verified', 'rejected', 'refunded'] as const).map((s) => (
            <div key={s} className="bg-ink-950 px-4 py-3">
              <dt className="text-xs text-paper-3">
                <StatusPill kind="payment" value={s} />
              </dt>
              <dd className="mt-1 text-xl font-semibold">{by[s].count}</dd>
              <dd className="tnum text-xs text-paper-3">{formatMoney(by[s].amount, report.data!.payments.currency)}</dd>
            </div>
          ))}
        </dl>
      )}
      <Tabs
        label="Payment stage"
        value={stage}
        onChange={(v) => setParam('stage', v)}
        items={[
          { value: 'awaiting_verification', label: 'To verify' },
          { value: 'awaiting_reference', label: 'Awaiting reference' },
          { value: 'verified', label: 'Verified' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'all', label: 'All' },
        ]}
      />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title={stage === 'awaiting_verification' ? 'Nothing to verify' : 'Nothing here'} body={stage === 'awaiting_verification' ? 'New references show up here as soon as a team leader submits one.' : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="kicker border-b border-line bg-ink-900 text-paper-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Registration</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">Reference</th>
                <th className="px-4 py-2.5 font-medium">Submitted</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const dup = r.payment.reference && dupKeys.has(keyOf(r.payment.reference)!);
                return (
                  <tr key={r.id} className="hover:bg-ink-900">
                    <td className="px-4 py-3">
                      <button type="button" className="text-left" onClick={() => setParam('reg', r.id)}>
                        <span className="block text-paper hover:underline">{r.name}</span>
                        <span className="font-mono text-xs text-paper-3">{r.code}</span>
                      </button>
                    </td>
                    <td className="tnum px-4 py-3 text-right">{formatMoney(r.payment.amountDue)}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('font-mono', r.payment.reference ? 'text-paper' : 'text-paper-3')}>{r.payment.reference ?? '—'}</span>
                      {dup && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-warn">
                          <Copy className="size-3" /> also quoted by another registration
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-paper-3">{r.payment.submittedAt ? relativeTime(r.payment.submittedAt) : '—'}</td>
                    <td className="px-4 py-3">
                      <StatusPill kind="payment" value={r.payment.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.payment.status === 'pending' && r.status !== 'cancelled' && r.status !== 'rejected' ? (
                        <div className="inline-flex gap-1.5">
                          <Button size="sm" variant={r.payment.reference ? 'primary' : 'secondary'} loading={verify.isPending && verify.variables === r.id} onClick={() => verify.mutate(r.id)} icon={<BadgeCheck className="size-3.5" />}>
                            Verify
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={`Reject payment for ${r.code}`} onClick={() => setRejecting(r)} icon={<X className="size-3.5" />} />
                        </div>
                      ) : (
                        <button type="button" className="text-xs text-paper-3 hover:text-paper" onClick={() => setParam('reg', r.id)}>
                          Details
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject payment for ${rejecting?.code}?`}
        description="The registration stays pending; the leader sees your reason and can submit a corrected reference."
        confirmLabel="Reject payment"
        reason={{ label: 'Reason shown to the participant', required: true, minLength: 3, placeholder: 'e.g. No matching credit for this UTR on 12 Oct' }}
        onConfirm={async (note) => {
          await api(`/registrations/${rejecting!.id}/payment/decision`, { method: 'POST', body: { decision: 'rejected', note } });
          qc.invalidateQueries({ queryKey: ['registrations', event.id] });
          qc.invalidateQueries({ queryKey: ['report', event.id] });
          toast({ tone: 'info', title: 'Payment rejected' });
        }}
      />
      <RegistrationDrawer id={openId} onClose={() => setParam('reg', null)} />
    </div>
  );
}
