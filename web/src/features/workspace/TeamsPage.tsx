import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Crown, DoorOpen, Search } from 'lucide-react';
import clsx from 'clsx';
import type { RegistrationStatus, WorkspaceEventDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { Tabs } from '../../components/ui/Tabs';
import { ChannelBadge, EventScoped } from './RegistrationsPage';
import { RegistrationDrawer } from './RegistrationDrawer';

interface TeamRow {
  id: string;
  name: string;
  code: string;
  memberCount: number;
  complete: boolean;
  registration: { id: string; code: string; status: RegistrationStatus; statusReason: string } | null;
  members: { id: string; name: string; email: string; rollNumber: string | null; department: string | null; isLeader: boolean; checkedIn: boolean }[];
}

export function TeamsPage() {
  return <EventScoped>{(event) => (event.mode === 'team' ? <Teams event={event} /> : <NotTeam event={event} />)}</EventScoped>;
}

function NotTeam({ event }: { event: WorkspaceEventDTO }) {
  return (
    <div className="space-y-6">
      <PageHeader kicker={event.title} title="Teams" />
      <EmptyState title="Individual event" body="This event registers people individually, so there are no teams. Pick a team event in the sidebar to manage teams." />
    </div>
  );
}

function Teams({ event }: { event: WorkspaceEventDTO }) {
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as 'all' | 'incomplete' | 'complete') || 'all';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const reg = params.get('reg');
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); v ? n.set(k, v) : n.delete(k); return n; }, { replace: true });
  const data = useQuery({ queryKey: ['teams', event.id], queryFn: () => api<{ teamSize: { min: number; max: number }; teams: TeamRow[] }>(`/events/${event.id}/teams`) });
  const all = data.data?.teams ?? [];
  const rows = all
    .filter((t) => (filter === 'incomplete' ? !t.complete : filter === 'complete' ? t.complete : true))
    .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.members.some((m) => `${m.name} ${m.email} ${m.rollNumber ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={event.title}
        title="Teams"
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span>
              {all.length} teams · {all.reduce((n, t) => n + t.memberCount, 0)} people · size {event.teamSize.min}–{event.teamSize.max}
            </span>
            <ChannelBadge eventId={event.id} />
          </span>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          label="Team filter"
          value={filter}
          onChange={(v) => setParam('filter', v === 'all' ? null : v)}
          items={[
            { value: 'all', label: 'All', count: all.length },
            { value: 'incomplete', label: 'Incomplete', count: all.filter((t) => !t.complete).length },
            { value: 'complete', label: 'Complete', count: all.filter((t) => t.complete).length },
          ]}
        />
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search teams or members</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-paper-3" />
          <input className="field !py-2 !pl-9 !text-[13px]" placeholder="Team or member" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {data.isError ? (
        <ErrorState error={data.error} onRetry={() => data.refetch()} />
      ) : data.isPending ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title="No teams match" />
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
          {rows.map((t) => {
            const expanded = open.has(t.id);
            const arrived = t.members.filter((m) => m.checkedIn).length;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-ink-900 sm:grid-cols-[1.5fr_1fr_1fr_auto]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-paper">{t.name}</span>
                    <span className="font-mono text-xs text-paper-3">{t.registration?.code}</span>
                  </span>
                  <span className="hidden items-center gap-2 sm:flex">
                    <span className="flex gap-0.5" aria-label={`${t.memberCount} of ${event.teamSize.max} members`}>
                      {Array.from({ length: event.teamSize.max }, (_, i) => (
                        <span key={i} className={clsx('h-3 w-2 rounded-[2px]', i < t.memberCount ? (t.complete ? 'bg-paper-2' : 'bg-info') : 'border border-line-strong')} />
                      ))}
                    </span>
                    <span className="tnum text-xs text-paper-3">
                      {t.memberCount}/{event.teamSize.max}
                    </span>
                  </span>
                  <span className="hidden sm:block">{t.registration && <StatusPill kind="registration" value={t.registration.status} />}</span>
                  <span className="flex items-center gap-3">
                    {arrived > 0 && (
                      <span className="tnum inline-flex items-center gap-1 text-xs text-paper-2">
                        <DoorOpen className="size-3.5 text-info" /> {arrived}
                      </span>
                    )}
                    <ChevronDown className={clsx('size-4 text-paper-3 transition-transform', expanded && 'rotate-180')} />
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-line bg-ink-900/50 px-4 py-3">
                    {t.registration?.statusReason && <p className="mb-2 text-xs text-paper-3">{t.registration.statusReason}</p>}
                    <ul className="space-y-1.5 text-[13px]">
                      {t.members.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-paper">
                            {m.name}
                            {m.isLeader && <Crown className="size-3.5 text-signal" aria-label="Leader" />}
                            <span className="text-xs text-paper-3">{[m.rollNumber, m.department, m.email].filter(Boolean).join(' · ')}</span>
                          </span>
                          {m.checkedIn ? <span className="text-xs text-info">Checked in</span> : <span className="text-xs text-paper-3">Not arrived</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-center gap-4 text-xs text-paper-3">
                      <span>
                        Code <span className="font-mono text-paper-2">{t.code.slice(0, 4)}-{t.code.slice(4)}</span>
                      </span>
                      {t.registration && (
                        <button type="button" className="text-paper-2 underline decoration-line-strong underline-offset-4 hover:text-paper" onClick={() => setParam('reg', t.registration!.id)}>
                          Open registration
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <RegistrationDrawer id={reg} onClose={() => setParam('reg', null)} />
    </div>
  );
}
