import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, FileUp, Search } from 'lucide-react';
import clsx from 'clsx';
import { LABELS, PAYMENT_STATUSES, REGISTRATION_STATUSES, formatMoney, type Page, type RegistrationRowDTO, type WorkspaceEventDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { LiveDot, StatusPill } from '../../components/ui/Status';
import { useWorkspaceEvent } from './context';
import { RegistrationDrawer, useLiveInvalidation } from './RegistrationDrawer';

export function EventScoped({ children }: { children: (event: WorkspaceEventDTO) => ReactNode }) {
  const { event, isPending, error } = useWorkspaceEvent({ manageOnly: true });
  if (error) return <ErrorState error={error} />;
  if (isPending) return <LoadingBlock />;
  if (!event) {
    return (
      <EmptyState
        title="No events to show"
        body="Create an event first — registrations, payments and attendance are organized per event."
        action={
          <ButtonLink to="/workspace/events/new" variant="primary">
            Create an event
          </ButtonLink>
        }
      />
    );
  }
  return <>{children(event)}</>;
}

export function ChannelBadge({ eventId }: { eventId: string }) {
  const state = useLiveInvalidation(eventId);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-paper-3" title="Updates from other organizers and the check-in desk appear automatically">
      {state === 'live' ? <LiveDot tone="ok" /> : <span className="size-2 rounded-full bg-paper-3/50" />}
      {state === 'live' ? 'Live' : state === 'reconnecting' ? 'Reconnecting…' : state === 'forbidden' ? 'No live access' : 'Connecting…'}
    </span>
  );
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function RegistrationsPage() {
  return <EventScoped>{(event) => <RegistrationsTable event={event} />}</EventScoped>;
}

function RegistrationsTable({ event }: { event: WorkspaceEventDTO }) {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search);
  useEffect(() => {
    if ((params.get('q') ?? '') !== q) set({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const status = params.get('status');
  const payment = params.get('payment');
  const sort = params.get('sort') ?? '-createdAt';
  const page = Number(params.get('page') ?? 1);
  const pageSize = 25;
  const openId = params.get('reg');

  const list = useQuery({
    queryKey: ['registrations', event.id, { q, status, payment, sort, page }],
    queryFn: () => api<Page<RegistrationRowDTO>>(`/events/${event.id}/registrations`, { query: { q, status, payment, sort, page, pageSize } }),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const SortHead = ({ field, children, className }: { field: string; children: ReactNode; className?: string }) => {
    const active = sort.replace('-', '') === field;
    const desc = sort.startsWith('-');
    return (
      <th className={clsx('px-4 py-2.5 font-medium', className)} aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
        <button type="button" onClick={() => set({ sort: active && !desc ? `-${field}` : field })} className="inline-flex items-center gap-1 hover:text-paper">
          {children}
          {active && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={event.title}
        title="Registrations"
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span>
              {event.counts.registrations} active {event.mode === 'team' ? 'team registrations' : 'registrations'} · {event.counts.participants} people with tickets
            </span>
            <ChannelBadge eventId={event.id} />
          </span>
        }
        actions={
          <>
            <ButtonLink to={`/workspace/imports?event=${event.id}`} size="sm" icon={<FileUp className="size-3.5" />}>
              Import CSV
            </ButtonLink>
            <a href={`/api/events/${event.id}/exports/registrations.csv`} className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-ink-800 px-3 text-[13px] text-paper hover:border-line-strong">
              <Download className="size-3.5" /> Export CSV
            </a>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">Search registrations</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-paper-3" />
          <input className="field !py-2 !pl-9 !text-[13px]" placeholder="Code, name, team, email, roll number or UTR" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select aria-label="Registration status" className="field !w-auto !py-2 !text-[13px]" value={status ?? ''} onChange={(e) => set({ status: e.target.value || null })}>
          <option value="">Any status</option>
          {REGISTRATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LABELS.registrationStatus[s]}
            </option>
          ))}
        </select>
        <select aria-label="Payment status" className="field !w-auto !py-2 !text-[13px]" value={payment ?? ''} onChange={(e) => set({ payment: e.target.value || null })}>
          <option value="">Any payment</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LABELS.paymentStatus[s]}
            </option>
          ))}
        </select>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <LoadingBlock rows={6} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={q || status || payment ? 'No registrations match' : 'No registrations yet'}
          body={q || status || payment ? 'Try another search or clear the filters.' : event.status === 'draft' ? 'Publish the event to start taking registrations, or import an existing export.' : 'Registrations appear here the moment someone signs up.'}
        />
      ) : (
        <div className={clsx('transition-opacity', list.isFetching && 'opacity-70')}>
          {/* Table on wide screens */}
          <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-line md:block">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="kicker border-b border-line bg-ink-900 text-paper-3">
                <tr>
                  <SortHead field="code">Code</SortHead>
                  <SortHead field="name">{event.mode === 'team' ? 'Team' : 'Name'}</SortHead>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <SortHead field="status">Status</SortHead>
                  <th className="px-4 py-2.5 font-medium">Payment</th>
                  <SortHead field="createdAt" className="text-right">
                    Registered
                  </SortHead>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.items.map((r) => (
                  <tr key={r.id} className={clsx('cursor-pointer hover:bg-ink-900', openId === r.id && 'bg-ink-900')} onClick={() => set({ reg: r.id, page: String(page) })}>
                    <td className="px-4 py-3">
                      <button type="button" className="font-mono text-paper hover:underline" onClick={(e) => (e.stopPropagation(), set({ reg: r.id, page: String(page) }))}>
                        {r.code}
                      </button>
                      {r.source === 'import' && <span className="kicker ml-2 !text-[9px] text-paper-3">import</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-paper">{r.name}</span>
                      {r.kind === 'team' && (
                        <span className={clsx('tnum ml-2 text-xs', r.memberCount < event.teamSize.min ? 'text-info' : 'text-paper-3')}>
                          {r.memberCount}/{event.teamSize.max}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-paper-2">
                      <span className="block max-w-[220px] truncate">{r.primaryEmail}</span>
                      {r.primaryRollNumber && <span className="text-xs text-paper-3">{r.primaryRollNumber}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill kind="registration" value={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill kind="payment" value={r.payment.status} label={r.payment.status === 'pending' ? (r.payment.reference ? 'To verify' : 'No reference') : undefined} />
                      {r.payment.status !== 'not_required' && <span className="tnum block text-xs text-paper-3">{formatMoney(r.payment.amountDue)}</span>}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-paper-3" title={r.createdAt}>
                      {relativeTime(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Cards on phones */}
          <ul className="space-y-2 md:hidden">
            {list.data.items.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => set({ reg: r.id, page: String(page) })} className="w-full rounded-[var(--radius-md)] border border-line bg-ink-900 p-4 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-paper">{r.name}</p>
                      <p className="font-mono text-xs text-paper-3">
                        {r.code}
                        {r.kind === 'team' ? ` · ${r.memberCount}/${event.teamSize.max}` : ''}
                      </p>
                    </div>
                    <StatusPill kind="registration" value={r.status} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-paper-3">
                    <StatusPill kind="payment" value={r.payment.status} />
                    <span>{relativeTime(r.createdAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-[13px] text-paper-3">
            <span className="tnum">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex gap-1">
              <button type="button" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} className="rounded p-1.5 hover:bg-ink-800 disabled:opacity-30" aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </button>
              <span className="tnum px-2 py-1.5">
                {page} / {pages}
              </span>
              <button type="button" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} className="rounded p-1.5 hover:bg-ink-800 disabled:opacity-30" aria-label="Next page">
                <ChevronRight className="size-4" />
              </button>
            </div>
          </nav>
        </div>
      )}
      <RegistrationDrawer id={openId} onClose={() => set({ reg: null, page: String(page) })} />
    </div>
  );
}
