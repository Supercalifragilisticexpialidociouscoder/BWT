import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ScanLine, Undo2 } from 'lucide-react';
import clsx from 'clsx';
import type { CheckInRowDTO, WorkspaceEventDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { ChannelBadge, EventScoped } from './RegistrationsPage';

export function AttendancePage() {
  return <EventScoped>{(event) => <Attendance event={event} />}</EventScoped>;
}

function Attendance({ event }: { event: WorkspaceEventDTO }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const [showVoided, setShowVoided] = useState(false);
  const [q, setQ] = useState('');
  const [correcting, setCorrecting] = useState<CheckInRowDTO | null>(null);
  const list = useQuery({
    queryKey: ['checkins', event.id, showVoided],
    queryFn: () => api<CheckInRowDTO[]>(`/events/${event.id}/checkins`, { query: { include: showVoided ? 'voided' : undefined } }),
  });
  const rows = (list.data ?? []).filter((r) => !q || `${r.participant.name} ${r.participant.rollNumber ?? ''} ${r.registrationCode} ${r.ticketShortCode} ${r.team?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const active = (list.data ?? []).filter((r) => r.active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={event.title}
        title="Attendance"
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tnum">
              {active} checked in{showVoided ? '' : ''} of {event.counts.participants} with tickets
            </span>
            <ChannelBadge eventId={event.id} />
          </span>
        }
        actions={
          <>
            <ButtonLink to={`/live/${event.id}`} size="sm" variant="primary" icon={<ScanLine className="size-3.5" />}>
              Live check-in
            </ButtonLink>
            <a href={`/api/events/${event.id}/exports/attendance.csv`} className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-ink-800 px-3 text-[13px] text-paper hover:border-line-strong">
              <Download className="size-3.5" /> Export CSV
            </a>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <input className="field !w-full !py-2 !text-[13px] sm:!w-80" placeholder="Search name, roll number, ticket or team" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search check-ins" />
        <label className="flex items-center gap-2 text-[13px] text-paper-2">
          <input type="checkbox" className="accent-[var(--color-signal)]" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
          Include corrected entries
        </label>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title="No check-ins yet" body="Arrivals appear here in real time as tickets are scanned at the entrance." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="kicker border-b border-line bg-ink-900 text-paper-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Participant</th>
                {event.mode === 'team' && <th className="px-4 py-2.5 font-medium">Team</th>}
                <th className="px-4 py-2.5 font-medium">Ticket</th>
                <th className="px-4 py-2.5 font-medium">Method</th>
                <th className="px-4 py-2.5 font-medium">Recorded by</th>
                <th className="px-4 py-2.5 text-right font-medium">Correction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className={clsx(!r.active && 'text-paper-3')}>
                  <td className="tnum px-4 py-2.5">{fmt.time(r.at)}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx(!r.active && 'line-through')}>{r.participant.name}</span>
                    {r.participant.rollNumber && <span className="block text-xs text-paper-3">{r.participant.rollNumber}</span>}
                  </td>
                  {event.mode === 'team' && <td className="px-4 py-2.5 text-paper-2">{r.team?.name ?? '—'}</td>}
                  <td className="px-4 py-2.5 font-mono text-xs text-paper-2">
                    {r.ticketShortCode} · {r.registrationCode}
                  </td>
                  <td className="px-4 py-2.5 text-paper-2">{r.method === 'qr' ? 'QR scan' : 'Manual'}</td>
                  <td className="px-4 py-2.5 text-paper-2">{r.staff?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.active ? (
                      <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => setCorrecting(r)}>
                        Undo
                      </Button>
                    ) : (
                      <span className="text-xs" title={r.voidReason ?? ''}>
                        Undone by {r.voidedBy?.name} · {r.voidedAt && fmt.time(r.voidedAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={correcting !== null}
        onClose={() => setCorrecting(null)}
        title={`Undo check-in for ${correcting?.participant.name}?`}
        description="The original record is kept and marked corrected in the audit log; the ticket becomes valid again so the person can be scanned later."
        confirmLabel="Undo check-in"
        reason={{ label: 'Why is this being corrected?', required: true, minLength: 5, placeholder: 'e.g. Scanned the wrong team member’s ticket' }}
        onConfirm={async (reason) => {
          await api(`/checkins/${correcting!.id}/void`, { method: 'POST', body: { reason } });
          qc.invalidateQueries({ queryKey: ['checkins', event.id] });
          toast({ tone: 'info', title: 'Check-in undone' });
        }}
      />
    </div>
  );
}
