import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MapPin, Sparkles, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { facilityLabel, type AllocationSuggestionDTO, type EventDetailDTO } from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { FormAlert, Select } from '../../components/ui/Form';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';

interface VenueRow {
  id: string;
  name: string;
  building: string;
  capacity: number;
  active: boolean;
}

export function VenuePanel({ event: e }: { event: EventDetailDTO }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<VenueRow[]>('/venues') });
  const [manual, setManual] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [release, setRelease] = useState<string | null>(null);
  const suggest = useMutation({ mutationFn: () => api<AllocationSuggestionDTO>(`/events/${e.id}/allocations/suggest`, { method: 'POST', body: {} }) });

  const refresh = (saved: EventDetailDTO) => {
    qc.setQueryData(['event', e.id], saved);
    qc.invalidateQueries({ queryKey: ['workspace'] });
    qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const book = useMutation({
    mutationFn: (venueId: string) => api<{ warnings: string[]; event: EventDetailDTO }>(`/events/${e.id}/allocations`, { method: 'POST', body: { venueId, status: 'confirmed' } }),
    onSuccess: (res) => {
      refresh(res.event);
      setConflict(null);
      suggest.reset();
      toast({ tone: 'ok', title: 'Venue booked', body: res.warnings.join(' ') || undefined });
    },
    onError: (err) => setConflict(err instanceof ApiError ? err.message : errorMessage(err)),
  });
  const confirmProposal = useMutation({
    mutationFn: (allocationId: string) => api<EventDetailDTO>(`/allocations/${allocationId}/confirm`, { method: 'POST' }),
    onSuccess: (saved) => {
      refresh(saved);
      toast({ tone: 'ok', title: 'Proposal approved and booked' });
    },
    onError: (err) => setConflict(errorMessage(err)),
  });

  return (
    <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section>
        <h2 className="kicker mb-3 text-paper-3">Bookings</h2>
        {e.allocations.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-line-strong px-5 py-6 text-sm text-paper-2">
            No venue yet. Ask for a suggestion, or pick a room directly — CAMPUSFLOW checks for clashes either way.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
            {e.allocations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="flex items-center gap-2 text-paper">
                    <MapPin className="size-4 text-paper-3" /> {a.venue.name}
                    <span className={clsx('kicker !text-[10px]', a.status === 'confirmed' ? 'text-ok' : 'text-warn')}>{a.status}</span>
                  </p>
                  <p className="text-xs text-paper-3">
                    {a.venue.building} · seats {a.venue.capacity} · {fmt.range(a.startsAt, a.endsAt)}
                  </p>
                  {a.status === 'proposed' && a.reason && <p className="mt-1 max-w-md text-xs text-paper-2">{a.reason}</p>}
                </div>
                <div className="flex gap-2">
                  {a.status === 'proposed' && (
                    <Button size="sm" variant="primary" loading={confirmProposal.isPending} onClick={() => confirmProposal.mutate(a.id)} icon={<Check className="size-3.5" />}>
                      Approve
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setRelease(a.id)} icon={<X className="size-3.5" />}>
                    {a.status === 'proposed' ? 'Discard' : 'Release'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 space-y-3">
          <h2 className="kicker text-paper-3">Book a specific room</h2>
          <div className="flex gap-2">
            <Select aria-label="Venue" value={manual} onChange={(ev) => setManual(ev.target.value)}>
              <option value="">Choose a venue…</option>
              {(venues.data ?? [])
                .filter((v) => v.active)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.building} · {v.capacity} seats
                  </option>
                ))}
            </Select>
            <Button disabled={!manual} loading={book.isPending && book.variables === manual} onClick={() => manual && book.mutate(manual)}>
              Book
            </Button>
          </div>
          {conflict && (
            <FormAlert>
              <span className="font-medium">Not booked.</span> {conflict}
            </FormAlert>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="kicker text-paper-3">Allocation assistant</h2>
          <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={suggest.isPending} onClick={() => suggest.mutate()}>
            {suggest.data ? 'Re-run' : 'Suggest a venue'}
          </Button>
        </div>
        <p className="text-sm text-paper-2">
          Checks every room against expected attendance{e.expectedAttendance ? ` (${e.expectedAttendance})` : ''}, required facilities, opening hours and existing bookings including turnover time, then picks the closest fit. It explains every rejection.
        </p>
        {suggest.isError && (
          <div className="mt-4">
            <FormAlert>{errorMessage(suggest.error)}</FormAlert>
          </div>
        )}
        {suggest.data && (
          <div className="mt-5 space-y-4">
            <p className={clsx('rounded-[var(--radius-md)] border px-4 py-3 text-sm', suggest.data.selected ? 'border-ok/40 bg-ok/5' : 'border-warn/40 bg-warn/5')}>
              {suggest.data.explanation}
            </p>
            <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
              {suggest.data.candidates.map((c, i) => (
                <li key={c.venue.id} className={clsx('px-4 py-3', !c.eligible && 'opacity-70')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-paper">
                      {c.eligible && i === 0 && <span className="kicker mr-2 !text-[10px] text-signal">Best fit</span>}
                      {c.venue.name} <span className="text-xs text-paper-3">· {c.venue.building} · {c.venue.capacity} seats</span>
                    </p>
                    {c.eligible && (
                      <Button size="sm" variant={i === 0 ? 'primary' : 'secondary'} loading={book.isPending && book.variables === c.venue.id} onClick={() => book.mutate(c.venue.id)}>
                        Book
                      </Button>
                    )}
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-xs">
                    {c.blockers.map((b) => (
                      <li key={b} className="flex gap-1.5 text-paper-2">
                        <TriangleAlert className="mt-px size-3 shrink-0 text-warn" aria-hidden /> {b}
                      </li>
                    ))}
                    {c.eligible &&
                      c.reasons.map((r) => (
                        <li key={r} className="flex gap-1.5 text-paper-3">
                          <Check className="mt-px size-3 shrink-0 text-ok" aria-hidden /> {r}
                        </li>
                      ))}
                  </ul>
                  {c.venue.facilities.length > 0 && <p className="mt-1 text-[11px] text-paper-3">{c.venue.facilities.map(facilityLabel).join(' · ')}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={release !== null}
        onClose={() => setRelease(null)}
        title="Release this booking?"
        description="The room becomes available to other events immediately."
        confirmLabel="Release"
        onConfirm={async () => {
          const saved = await api<EventDetailDTO>(`/allocations/${release}`, { method: 'DELETE' });
          refresh(saved);
        }}
      />
    </div>
  );
}
