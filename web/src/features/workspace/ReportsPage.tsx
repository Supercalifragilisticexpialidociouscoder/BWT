import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Lock, Radio } from 'lucide-react';
import { formatMoney, LABELS, PAYMENT_STATUSES, REGISTRATION_STATUSES, type ReportDTO, type WorkspaceEventDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { useFormat, pct } from '../../lib/format';
import { useInstitutionRequired } from '../../lib/institution';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { ErrorState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { useToast } from '../../components/ui/Toast';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { EventScoped } from './RegistrationsPage';

export function ReportsPage() {
  return <EventScoped>{(event) => <Report event={event} />}</EventScoped>;
}

const EXPORTS = [
  ['summary', 'Summary'],
  ['registrations', 'Registrations'],
  ['participants', 'Participants'],
  ['attendance', 'Attendance log'],
  ['payments', 'Payments'],
] as const;

function Report({ event }: { event: WorkspaceEventDTO }) {
  const fmt = useFormat();
  const inst = useInstitutionRequired();
  const qc = useQueryClient();
  const toast = useToast();
  const [finalizing, setFinalizing] = useState(false);
  const q = useQuery({ queryKey: ['report', event.id], queryFn: () => api<ReportDTO>(`/events/${event.id}/report`) });
  const ended = new Date(event.endsAt).getTime() < Date.now();
  const r = q.data;

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={event.title}
        title="Report"
        description={
          r ? (
            r.kind === 'finalized' ? (
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5 text-info" /> Finalized record, frozen {fmt.dateTime(r.finalizedAt!)}. Later corrections are not reflected.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Radio className="size-3.5 text-signal" /> Live snapshot computed {fmt.dateTime(r.generatedAt)} from current records — it changes as data changes.
              </span>
            )
          ) : undefined
        }
        actions={
          r?.kind === 'live_snapshot' && event.status === 'published' ? (
            <Button
              size="sm"
              variant={ended ? 'primary' : 'secondary'}
              disabled={!ended}
              title={ended ? undefined : 'Available after the event ends'}
              onClick={() => setFinalizing(true)}
              icon={<Lock className="size-3.5" />}
            >
              Finalize report
            </Button>
          ) : undefined
        }
      />

      {r && (
        <p className="text-sm text-paper-2">
          Reporting period: event {fmt.range(event.startsAt, event.endsAt)}
          {r.registrationsByDay.length > 0 &&
            ` · registrations ${fmt.f(`${r.registrationsByDay[0]!.day}T12:00:00Z`, 'd MMM')} – ${fmt.f(`${r.registrationsByDay[r.registrationsByDay.length - 1]!.day}T12:00:00Z`, 'd MMM yyyy')}`}
          {' · '}
          {inst.timezone}
        </p>
      )}

      <nav aria-label="CSV exports" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-paper-3">Export CSV</span>
        {EXPORTS.map(([kind, label]) => (
          <a key={kind} href={`/api/events/${event.id}/exports/${kind}.csv`} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-line bg-ink-900 px-3 text-[13px] text-paper-2 hover:border-line-strong hover:text-paper">
            <Download className="size-3.5" /> {label}
          </a>
        ))}
      </nav>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !r ? (
        <LoadingBlock rows={6} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border border-line bg-line md:grid-cols-4">
            <Big label="Checked in" value={String(r.attendance.checkedIn)} detail={`of ${r.attendance.expected} with valid tickets`} />
            <Big label="Attendance rate" value={pct(r.attendance.rate, 1)} detail={r.attendance.corrections ? `${r.attendance.corrections} correction${r.attendance.corrections === 1 ? '' : 's'} applied` : 'no corrections'} />
            <Big label="No-shows" value={r.attendance.noShows === null ? '—' : String(r.attendance.noShows)} detail={r.attendance.noShows === null ? 'available after the event ends' : 'valid tickets never scanned'} />
            <Big label={event.mode === 'team' ? 'Teams' : 'Registrations'} value={String(r.teams ? r.teams.total : r.registrations.total)} detail={r.teams ? `${r.teams.complete} complete · ${r.participants.total} people` : `${r.participants.confirmed} confirmed people`} />
          </dl>

          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <h2 className="display-sm mb-4">Registrations by status</h2>
              <BarList
                total={r.registrations.total}
                rows={REGISTRATION_STATUSES.map((s) => ({ key: s, label: <StatusPill kind="registration" value={s} />, value: r.registrations.byStatus[s] }))}
              />
              <p className="mt-3 text-xs text-paper-3">
                {r.registrations.bySource.web} registered online · {r.registrations.bySource.import} imported (active only)
              </p>
            </section>
            <section>
              <h2 className="display-sm mb-4">Payments</h2>
              {r.payments.required ? (
                <table className="w-full text-left text-[13px]">
                  <thead className="kicker border-b border-line text-paper-3">
                    <tr>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 text-right font-medium">Count</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="tnum divide-y divide-line">
                    {PAYMENT_STATUSES.filter((s) => s !== 'not_required').map((s) => (
                      <tr key={s}>
                        <td className="py-2">
                          <StatusPill kind="payment" value={s} />
                        </td>
                        <td className="py-2 text-right">{r.payments.byStatus[s].count}</td>
                        <td className="py-2 text-right">{formatMoney(r.payments.byStatus[s].amount, r.payments.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-paper-3">Free event — no payments recorded.</p>
              )}
              <p className="mt-3 text-xs text-paper-3">Amounts are what registrations owe; “verified” means an organizer confirmed the reference, not a bank reconciliation.</p>
            </section>
          </div>

          <section>
            <h2 className="display-sm">Registrations per day</h2>
            <p className="mb-4 mt-1 text-xs text-paper-3">All registrations including later-cancelled ones · {inst.timezone}</p>
            {r.registrationsByDay.length ? (
              <ColumnChart
                title="Registrations per day"
                unit="registrations"
                highlightLast={false}
                data={r.registrationsByDay.map((d) => ({ key: d.day, label: fmt.f(`${d.day}T12:00:00Z`, 'd MMM'), fullLabel: fmt.f(`${d.day}T12:00:00Z`, 'EEE d MMM yyyy'), value: d.count }))}
              />
            ) : (
              <p className="text-sm text-paper-3">No registrations yet.</p>
            )}
          </section>

          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <h2 className="display-sm mb-4">By department</h2>
              {r.departments.length === 0 ? (
                <p className="text-sm text-paper-3">No ticket holders yet.</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead className="kicker border-b border-line text-paper-3">
                    <tr>
                      <th className="py-2 font-medium">Department</th>
                      <th className="py-2 text-right font-medium">With tickets</th>
                      <th className="py-2 text-right font-medium">Checked in</th>
                      <th className="py-2 text-right font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="tnum divide-y divide-line">
                    {r.departments.map((d) => (
                      <tr key={d.department}>
                        <td className="py-2" title={inst.departments.find((x) => x.code === d.department)?.name}>
                          {d.department}
                        </td>
                        <td className="py-2 text-right">{d.participants}</td>
                        <td className="py-2 text-right">{d.checkedIn}</td>
                        <td className="py-2 text-right text-paper-2">{pct(d.participants ? d.checkedIn / d.participants : null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section>
              <h2 className="display-sm mb-4">Venue</h2>
              {r.venue ? (
                <div className="space-y-2 text-sm">
                  <p className="text-paper">{r.venue.name}</p>
                  <p className="text-paper-2">
                    {r.attendance.checkedIn} entries against {r.venue.capacity} seats — <span className="tnum text-paper">{pct(r.venue.peakUtilization)}</span>
                  </p>
                  <p className="text-xs text-paper-3">Based on entries only; exits are not tracked, so this is an upper bound on occupancy.</p>
                </div>
              ) : (
                <p className="text-sm text-paper-3">No confirmed venue booking, so utilization can’t be computed.</p>
              )}
            </section>
          </div>
        </>
      )}

      <ConfirmDialog
        open={finalizing}
        onClose={() => setFinalizing(false)}
        tone="primary"
        title="Finalize this report?"
        description="Freezes the current figures as the official record and marks the event completed. Later attendance corrections will not change the finalized report."
        confirmLabel="Finalize"
        onConfirm={async () => {
          const final = await api<ReportDTO>(`/events/${event.id}/report/finalize`, { method: 'POST' });
          qc.setQueryData(['report', event.id], final);
          qc.invalidateQueries({ queryKey: ['workspace'] });
          toast({ tone: 'ok', title: 'Report finalized' });
        }}
      />
    </div>
  );
}

function Big({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-ink-950 px-5 py-5">
      <dt className="text-xs text-paper-3">{label}</dt>
      <dd className="mt-1 text-4xl font-semibold tracking-tight">{value}</dd>
      <dd className="mt-1 text-xs text-paper-3">{detail}</dd>
    </div>
  );
}

function BarList({ rows, total }: { rows: { key: string; label: React.ReactNode; value: number }[]; total: number }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[140px_1fr_48px] items-center gap-3 text-[13px]">
          <span>{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-ink-800" aria-hidden>
            <span className="block h-full rounded-full bg-paper-2/70" style={{ width: `${total ? (r.value / total) * 100 : 0}%` }} />
          </span>
          <span className="tnum text-right text-paper">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
