import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, Search } from 'lucide-react';
import clsx from 'clsx';
import { useSession } from '../../lib/session';
import { useFormat, formatLabel } from '../../lib/format';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { DemoBadge, StatusPill } from '../../components/ui/Status';
import { Tabs } from '../../components/ui/Tabs';
import { useWorkspaceEvents } from './context';

type Filter = 'upcoming' | 'draft' | 'past' | 'cancelled' | 'all';

export function EventsPage() {
  const { access } = useSession();
  const events = useWorkspaceEvents();
  const fmt = useFormat();
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [q, setQ] = useState('');
  const now = Date.now();
  const all = (events.data ?? []).filter((e) => e.access !== 'checkin');
  const match = (f: Filter) => (e: (typeof all)[number]) =>
    f === 'all'
      ? true
      : f === 'draft'
        ? e.status === 'draft'
        : f === 'cancelled'
          ? e.status === 'cancelled'
          : f === 'past'
            ? e.status !== 'cancelled' && e.status !== 'draft' && new Date(e.endsAt).getTime() <= now
            : e.status === 'published' && new Date(e.endsAt).getTime() > now;
  const rows = all
    .filter(match(filter))
    .filter((e) => !q || e.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (filter === 'past' ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Workspace"
        title="Events"
        description="Everything you organize or co-manage. Open an event to edit details, book a venue or manage staff."
        actions={
          access.canOrganize ? (
            <ButtonLink to="/workspace/events/new" variant="primary" icon={<Plus className="size-4" />}>
              New event
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          label="Event filter"
          value={filter}
          onChange={setFilter}
          items={(['upcoming', 'draft', 'past', 'cancelled', 'all'] as Filter[]).map((f) => ({
            value: f,
            label: { upcoming: 'Published', draft: 'Drafts', past: 'Past', cancelled: 'Cancelled', all: 'All' }[f],
            count: all.filter(match(f)).length,
          }))}
        />
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search events</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-paper-3" />
          <input className="field !py-2 !pl-9 !text-[13px]" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {events.isError ? (
        <ErrorState error={events.error} onRetry={() => events.refetch()} />
      ) : events.isPending ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter === 'draft' ? 'No drafts' : 'No events here'}
          body={access.canOrganize ? 'Create an event to start taking registrations.' : 'Events you co-manage will appear here.'}
          action={
            access.canOrganize ? (
              <ButtonLink to="/workspace/events/new" variant="primary">
                Create an event
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="kicker border-b border-line bg-ink-900 text-paper-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Event</th>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Format</th>
                <th className="px-4 py-2.5 text-right font-medium">Registrations</th>
                <th className="px-4 py-2.5 text-right font-medium">People</th>
                <th className="px-4 py-2.5 text-right font-medium">Checked in</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-ink-900">
                  <td className="px-4 py-3">
                    <Link to={`/workspace/events/${e.id}`} className="font-medium text-paper hover:underline">
                      {e.title}
                    </Link>
                    {e.isDemo && <DemoBadge className="ml-2" />}
                    <span className="block text-xs text-paper-3">
                      {e.organization.name} · {e.categoryName}
                    </span>
                  </td>
                  <td className="tnum px-4 py-3 text-paper-2">{fmt.dateTime(e.startsAt)}</td>
                  <td className="px-4 py-3 text-paper-2">{formatLabel(e.mode, e.teamSize)}</td>
                  <td className="tnum px-4 py-3 text-right">
                    {e.counts.registrations}
                    {e.capacity !== null && <span className="text-paper-3"> / {e.capacity}</span>}
                    {e.counts.pendingPayments > 0 && <span className="block text-[11px] text-warn">{e.counts.pendingPayments} to verify</span>}
                  </td>
                  <td className="tnum px-4 py-3 text-right text-paper-2">{e.counts.participants}</td>
                  <td className={clsx('tnum px-4 py-3 text-right', e.counts.checkedIn ? 'text-paper' : 'text-paper-3')}>{e.counts.checkedIn}</td>
                  <td className="px-4 py-3">
                    <StatusPill kind="event" value={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
