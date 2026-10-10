import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus, Clock, CreditCard, MapPin, ScanLine, TriangleAlert, Users, FileText, FileClock, Copy, Gauge, Hourglass } from 'lucide-react';
import { LiveDot } from '../../components/ui/Status';
import clsx from 'clsx';
import type { AttentionItemDTO, OverviewDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useFormat } from '../../lib/format';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { DemoBadge, StatusPill } from '../../components/ui/Status';
import { useWorkspaceEvents } from './context';

const ICONS: Record<AttentionItemDTO['kind'], typeof Clock> = {
  payments_awaiting_verification: CreditCard,
  duplicate_payment_reference: Copy,
  pending_approvals: Clock,
  incomplete_teams_near_deadline: Users,
  no_venue: MapPin,
  venue_conflict: TriangleAlert,
  stale_draft: FileText,
  unfinalized_report: FileText,
  near_capacity: Gauge,
  deadline_soon: Hourglass,
  documents_awaiting_review: FileClock,
};

export function OverviewPage() {
  const { managesAny, user } = useSession();
  if (!managesAny) return <Assignments />;
  return <OrganizerOverview name={user?.name ?? ''} />;
}

function OrganizerOverview({ name }: { name: string }) {
  const { access } = useSession();
  const [params, setParams] = useSearchParams();
  const events = useWorkspaceEvents();
  const scope = params.get('scope');
  const fmt = useFormat();
  const q = useQuery({
    queryKey: ['workspace', 'overview', scope],
    queryFn: () => api<OverviewDTO>('/workspace/overview', { query: { event: scope ?? undefined } }),
    refetchInterval: 30_000,
  });
  const scoped = (events.data ?? []).filter((e) => e.access !== 'checkin');

  return (
    <div className="space-y-10">
      <PageHeader
        kicker={`Hello, ${name.split(/\s+/).find((w) => !/^(dr|prof|mr|mrs|ms)\.?$/i.test(w)) ?? name}`}
        title="Overview"
        description="Live totals from the registration, payment and attendance records of the events you manage."
        actions={
          <>
            <select
              aria-label="Overview scope"
              className="field !w-auto !py-2 !text-[13px]"
              value={scope ?? ''}
              onChange={(e) => setParams(e.target.value ? { scope: e.target.value } : {}, { replace: true })}
            >
              <option value="">All my events</option>
              {scoped.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
            {access.canOrganize && (
              <ButtonLink to="/workspace/events/new" variant="primary" size="sm" icon={<Plus className="size-4" />}>
                New event
              </ButtonLink>
            )}
          </>
        }
      />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoadingBlock rows={5} />
      ) : (
        <>
          <OnNow />
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
            <Tile label="Registrations" value={q.data.totals.registrations} detail={`${q.data.totals.confirmedRegistrations} confirmed`} />
            <Tile label="Teams" value={q.data.totals.teams} detail={`${q.data.totals.completeTeams} complete`} />
            <Tile label="Participants" value={q.data.totals.participants} detail="people across all registrations" />
            <Tile
              label="Payments to verify"
              value={q.data.totals.paymentsAwaitingVerification}
              detail={`${q.data.totals.paymentsAwaitingReference} awaiting a reference`}
              tone={q.data.totals.paymentsAwaitingVerification > 0 ? 'warn' : undefined}
            />
            <Tile label="Checked in" value={q.data.totals.checkedIn} detail="people, all time" />
            <Tile label="Events" value={q.data.totals.events} detail={q.data.scope.label} />
          </dl>

          <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <section aria-labelledby="att-h">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 id="att-h" className="display-sm">
                  Needs attention
                </h2>
                <span className="tnum text-sm text-paper-3">{q.data.attention.length}</span>
              </div>
              {q.data.attention.length === 0 ? (
                <EmptyState title="All clear" body="No pending payments, approvals, venue gaps or clashes right now." />
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {q.data.attention.map((a, i) => {
                    const Icon = ICONS[a.kind];
                    return (
                      <li key={`${a.kind}-${a.eventId}-${i}`}>
                        <Link to={a.href} className="group flex items-start gap-3 px-1 py-3 transition-colors hover:bg-ink-900">
                          <Icon className={clsx('mt-0.5 size-4 shrink-0', a.severity === 'high' ? 'text-bad' : a.severity === 'medium' ? 'text-warn' : 'text-paper-3')} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-paper">{a.message}</span>
                            <span className="block truncate text-xs text-paper-3">
                              <span className="sr-only">{a.severity} priority · </span>
                              {a.eventTitle}
                            </span>
                          </span>
                          <ArrowRight className="mt-0.5 size-4 shrink-0 text-paper-3 transition-transform group-hover:translate-x-0.5 group-hover:text-paper" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="act-h">
              <h2 id="act-h" className="display-sm">
                New registrations per day
              </h2>
              <p className="mb-4 mt-1 text-xs text-paper-3">Last 30 days · teams count once · today highlighted</p>
              <ColumnChart
                title="New registrations per day, last 30 days"
                unit="registrations"
                data={q.data.activity.map((d) => ({
                  key: d.day,
                  label: fmt.f(`${d.day}T12:00:00Z`, 'd MMM'),
                  fullLabel: fmt.f(`${d.day}T12:00:00Z`, 'EEE d MMM'),
                  value: d.registrations,
                }))}
                labelEvery={7}
              />
            </section>
          </div>

          <section aria-labelledby="up-h">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="up-h" className="display-sm">
                Coming up
              </h2>
              <Link to="/workspace/events" className="text-sm text-paper-3 hover:text-paper">
                All events →
              </Link>
            </div>
            {q.data.upcoming.length === 0 ? (
              <EmptyState
                title="No upcoming events"
                body="Create an event, publish it, and it will appear here with live registration numbers."
                action={
                  <ButtonLink to="/workspace/events/new" variant="primary">
                    Create an event
                  </ButtonLink>
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead className="kicker border-b border-line bg-ink-900 text-paper-3">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Event</th>
                      <th className="px-4 py-2.5 font-medium">When</th>
                      <th className="px-4 py-2.5 text-right font-medium">Registered</th>
                      <th className="px-4 py-2.5 text-right font-medium">To verify</th>
                      <th className="px-4 py-2.5 font-medium">Venue</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {q.data.upcoming.map((e) => (
                      <tr key={e.id} className="hover:bg-ink-900">
                        <td className="px-4 py-3">
                          <Link to={`/workspace/registrations?event=${e.id}`} className="font-medium text-paper hover:underline">
                            {e.title}
                          </Link>
                          {e.isDemo && <DemoBadge className="ml-2" />}
                          <span className="block text-xs text-paper-3">{e.organization.name}</span>
                        </td>
                        <td className="tnum px-4 py-3 text-paper-2">{fmt.dateTime(e.startsAt)}</td>
                        <td className="tnum px-4 py-3 text-right text-paper">
                          {e.activeRegistrations}
                          {e.capacity !== null && <span className="text-paper-3"> / {e.capacity}</span>}
                        </td>
                        <td className={clsx('tnum px-4 py-3 text-right', e.pendingPayments ? 'text-warn' : 'text-paper-3')}>{e.pendingPayments}</td>
                        <td className="px-4 py-3 text-paper-2">{e.venue?.name ?? <span className="text-warn">Not booked</span>}</td>
                        <td className="px-4 py-3">
                          <StatusPill kind="event" value={e.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Events in progress right now, with arrivals so far and a direct path to the gate. */
function OnNow() {
  const events = useWorkspaceEvents();
  const now = Date.now();
  const live = (events.data ?? []).filter((e) => e.status === 'published' && new Date(e.startsAt).getTime() <= now && new Date(e.endsAt).getTime() > now);
  if (!live.length) return null;
  return (
    <section aria-label="On now" className="space-y-2">
      {live.map((e) => {
        const rate = e.counts.participants ? e.counts.checkedIn / e.counts.participants : null;
        return (
          <div key={e.id} className="flex flex-wrap items-center gap-x-8 gap-y-3 border-l-2 border-signal bg-ink-900 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="kicker inline-flex items-center gap-2 text-signal">
                <LiveDot /> On now
              </p>
              <p className="mt-1 truncate text-lg text-paper">{e.title}</p>
            </div>
            <div>
              <p className="tnum text-3xl font-semibold leading-none">
                {e.counts.checkedIn}
                <span className="text-lg text-paper-3"> / {e.counts.participants}</span>
              </p>
              <p className="mt-1 text-xs text-paper-3">checked in{rate !== null ? ` · ${Math.round(rate * 100)}%` : ''}</p>
            </div>
            <div className="flex gap-2">
              <ButtonLink to={`/live/${e.id}`} variant="primary" size="sm" icon={<ScanLine className="size-3.5" />}>
                Live check-in
              </ButtonLink>
              <ButtonLink to={`/workspace/attendance?event=${e.id}`} size="sm">
                Attendance
              </ButtonLink>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Tile({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: 'warn' }) {
  return (
    <div className="bg-ink-950 px-4 py-4">
      <dt className="text-[12px] text-paper-3">{label}</dt>
      <dd className={clsx('mt-1 text-[28px] font-semibold leading-tight tracking-tight', tone === 'warn' ? 'text-warn' : 'text-paper')}>{value.toLocaleString('en-IN')}</dd>
      <dd className="mt-0.5 truncate text-[11.5px] text-paper-3">{detail}</dd>
    </div>
  );
}

/** Check-in volunteers land here: their assignments and a direct path to the scanner. */
function Assignments() {
  const events = useWorkspaceEvents();
  const fmt = useFormat();
  const list = (events.data ?? []).filter((e) => e.status !== 'cancelled');
  return (
    <div className="space-y-8">
      <PageHeader kicker="Check-in" title="Your assignments" description="Events where you are on the check-in team. Open the live view to scan tickets and watch arrivals." />
      {events.isPending ? (
        <LoadingBlock rows={2} />
      ) : list.length === 0 ? (
        <EmptyState title="No assignments yet" body="An organizer adds you to an event’s staff list to give you check-in access." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.map((e) => {
            const live = new Date(e.startsAt).getTime() <= Date.now() && new Date(e.endsAt).getTime() > Date.now();
            return (
              <li key={e.id} className="rounded-[var(--radius-md)] border border-line bg-ink-900 p-5">
                <p className="kicker text-paper-3">{live ? 'Happening now' : fmt.dateTime(e.startsAt)}</p>
                <p className="display-sm mt-2">{e.title}</p>
                <p className="mt-1 text-sm text-paper-2">
                  {e.counts.checkedIn} of {e.counts.participants} checked in · {e.venue?.name ?? 'Venue TBA'}
                </p>
                <div className="mt-4 flex gap-2">
                  <ButtonLink to={`/live/${e.id}/scan`} variant="primary" size="sm" icon={<ScanLine className="size-4" />}>
                    Scan tickets
                  </ButtonLink>
                  <ButtonLink to={`/live/${e.id}`} size="sm">
                    Live dashboard
                  </ButtonLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
