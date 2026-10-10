import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accessibility, Check, Pencil, Plus, Sparkles, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { COMMON_FACILITIES, LABELS, VENUE_KINDS, facilityLabel, type EventDetailDTO, type VenueCandidateDTO, type VenueKind } from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useFormat } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { Checkbox, Field, FormAlert, Input, Select } from '../../components/ui/Form';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '../../components/ui/Feedback';
import { DemoBadge } from '../../components/ui/Status';
import { useToast } from '../../components/ui/Toast';
import { useWorkspaceEvents } from './context';

interface Venue {
  id: string;
  name: string;
  building: string;
  roomCode: string;
  kind: VenueKind;
  capacity: number;
  facilities: string[];
  accessibility: { stepFree: boolean; notes: string };
  availability: { days: number[]; opensAt: string; closesAt: string } | null;
  turnoverMinutes: number;
  active: boolean;
  isDemo: boolean;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function VenuesPage() {
  const { access } = useSession();
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/venues') });
  const [editing, setEditing] = useState<Venue | 'new' | null>(null);

  return (
    <div className="space-y-10">
      <PageHeader
        kicker="Campus"
        title="Venues"
        description="Rooms and grounds that events can book. Bookings are checked against capacity, facilities, opening hours and turnover time."
        actions={
          access.isAdmin ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add venue
            </Button>
          ) : undefined
        }
      />
      {venues.isError ? (
        <ErrorState error={venues.error} onRetry={() => venues.refetch()} />
      ) : venues.isPending ? (
        <LoadingBlock />
      ) : venues.data.length === 0 ? (
        <EmptyState title="No venues yet" body={access.isAdmin ? 'Add the rooms and grounds your events use.' : 'An administrator needs to add venues.'} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
          <table className="w-full min-w-[920px] text-left text-[13px]">
            <thead className="kicker border-b border-line bg-ink-900 text-paper-3">
              <tr>
                <th className="px-4 py-2.5 font-medium">Venue</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 text-right font-medium">Seats</th>
                <th className="px-4 py-2.5 font-medium">Facilities</th>
                <th className="px-4 py-2.5 font-medium">Available</th>
                <th className="px-4 py-2.5 text-right font-medium">Turnover</th>
                {access.isAdmin && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {venues.data.map((v) => (
                <tr key={v.id} className={clsx(!v.active && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <span className="text-paper">{v.name}</span>
                    {v.isDemo && <DemoBadge className="ml-2" />}
                    <span className="block text-xs text-paper-3">
                      {v.building}
                      {v.roomCode && ` · ${v.roomCode}`}
                      {v.accessibility.stepFree && <Accessibility className="ml-1.5 inline size-3.5 text-paper-2" aria-label="Step-free access" />}
                      {!v.active && ' · inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-paper-2">{LABELS.venueKind[v.kind]}</td>
                  <td className="tnum px-4 py-3 text-right">{v.capacity}</td>
                  <td className="max-w-[260px] px-4 py-3 text-xs text-paper-2">{v.facilities.map(facilityLabel).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs text-paper-2">{v.availability ? `${v.availability.days.map((d) => DAYS[d]).join(' ')} · ${v.availability.opensAt}–${v.availability.closesAt}` : 'Any time'}</td>
                  <td className="tnum px-4 py-3 text-right text-paper-2">{v.turnoverMinutes} min</td>
                  {access.isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(v)} icon={<Pencil className="size-3.5" />}>
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Planner />
      {editing && <VenueDialog venue={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

interface PlanRow {
  eventId: string;
  title: string;
  proposal: VenueCandidateDTO | null;
  explanation: string;
  error?: string;
}

function Planner() {
  const events = useWorkspaceEvents();
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const now = Date.now();
  const needing = (events.data ?? []).filter((e) => e.access !== 'checkin' && e.status !== 'cancelled' && !e.venue && new Date(e.endsAt).getTime() > now);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set(needing.map((e) => e.id))), [events.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMutation({
    mutationFn: () => api<PlanRow[]>('/allocations/plan', { method: 'POST', body: { eventIds: [...picked] } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  });
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const approve = useMutation({
    mutationFn: async (eventId: string) => {
      const ev = await api<EventDetailDTO>(`/events/${eventId}`);
      const proposal = ev.allocations.find((a) => a.status === 'proposed');
      if (!proposal) throw new Error('The proposal is no longer there — it may have been approved or discarded already.');
      return api<EventDetailDTO>(`/allocations/${proposal.id}/confirm`, { method: 'POST' });
    },
    onSuccess: (ev) => {
      setApproved((s) => new Set(s).add(ev.id));
      qc.setQueryData(['event', ev.id], ev);
      qc.invalidateQueries({ queryKey: ['workspace'] });
      toast({ tone: 'ok', title: `Booked for ${ev.title}` });
    },
    onError: (err) => toast({ tone: 'bad', title: 'Not booked', body: errorMessage(err) }),
  });

  return (
    <section aria-labelledby="planner-h" className="space-y-4">
      <div>
        <h2 id="planner-h" className="display-sm">
          Allocation planner
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-paper-2">
          Proposes rooms for events that don’t have one. It places the most constrained event first and picks the smallest room that fits — a deterministic heuristic, not a guaranteed optimum. Proposals hold the room until you approve or discard them.
        </p>
      </div>
      {needing.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-line-strong px-5 py-6 text-sm text-paper-3">Every upcoming event you manage has a venue.</p>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
            {needing.map((e) => (
              <li key={e.id} className="px-4 py-2.5">
                <Checkbox
                  checked={picked.has(e.id)}
                  onChange={(ev) => setPicked((s) => { const n = new Set(s); ev.target.checked ? n.add(e.id) : n.delete(e.id); return n; })}
                  label={e.title}
                  hint={`${fmt.range(e.startsAt, e.endsAt)} · ${e.status}`}
                />
              </li>
            ))}
          </ul>
          <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={!picked.size} loading={plan.isPending} onClick={() => plan.mutate()}>
            Propose venues for {picked.size} event{picked.size === 1 ? '' : 's'}
          </Button>
        </>
      )}
      {plan.isError && <FormAlert>{errorMessage(plan.error)}</FormAlert>}
      {plan.data && (
        <ul className="space-y-3">
          {plan.data.map((r) => (
            <li key={r.eventId} className={clsx('rounded-[var(--radius-md)] border p-4', r.proposal ? 'border-line' : 'border-warn/40')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-paper">
                    <Link to={`/workspace/events/${r.eventId}?tab=venue`} className="hover:underline">
                      {r.title}
                    </Link>
                  </p>
                  {r.proposal ? (
                    <p className="text-sm text-paper-2">
                      → <span className="text-paper">{r.proposal.venue.name}</span> ({r.proposal.venue.building}, {r.proposal.venue.capacity} seats)
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-sm text-warn">
                      <TriangleAlert className="size-3.5" /> No room proposed
                    </p>
                  )}
                </div>
                {r.proposal &&
                  (approved.has(r.eventId) ? (
                    <span className="inline-flex items-center gap-1 text-sm text-ok">
                      <Check className="size-4" /> Booked
                    </span>
                  ) : (
                    <Button size="sm" variant="primary" loading={approve.isPending && approve.variables === r.eventId} onClick={() => approve.mutate(r.eventId)}>
                      Approve
                    </Button>
                  ))}
              </div>
              <p className="mt-2 text-xs text-paper-3">{r.error ?? r.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VenueDialog({ venue, onClose }: { venue: Venue | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(() => ({
    name: venue?.name ?? '',
    building: venue?.building ?? '',
    roomCode: venue?.roomCode ?? '',
    kind: venue?.kind ?? ('classroom' as VenueKind),
    capacity: venue?.capacity ? String(venue.capacity) : '',
    facilities: venue?.facilities ?? [],
    stepFree: venue?.accessibility.stepFree ?? false,
    notes: venue?.accessibility.notes ?? '',
    restricted: Boolean(venue?.availability),
    days: venue?.availability?.days ?? [1, 2, 3, 4, 5, 6],
    opensAt: venue?.availability?.opensAt ?? '08:00',
    closesAt: venue?.availability?.closesAt ?? '18:00',
    turnoverMinutes: String(venue?.turnoverMinutes ?? 30),
    active: venue?.active ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      api(venue ? `/venues/${venue.id}` : '/venues', {
        method: venue ? 'PUT' : 'POST',
        body: {
          name: v.name,
          building: v.building,
          roomCode: v.roomCode,
          kind: v.kind,
          capacity: Number(v.capacity),
          facilities: v.facilities,
          accessibility: { stepFree: v.stepFree, notes: v.notes },
          availability: v.restricted ? { days: v.days, opensAt: v.opensAt, closesAt: v.closesAt } : null,
          turnoverMinutes: Number(v.turnoverMinutes),
          active: v.active,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] });
      toast({ tone: 'ok', title: venue ? 'Venue updated' : 'Venue added' });
      onClose();
    },
    onError: (err) => setErrors(err instanceof ApiError ? { ...err.fields, _: err.message } : { _: errorMessage(err) }),
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));

  return (
    <Dialog
      open
      onClose={onClose}
      title={venue ? `Edit ${venue.name}` : 'Add a venue'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {venue ? 'Save venue' : 'Add venue'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required error={errors.name}>{({ id }) => <Input id={id} value={v.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="Building / block" required error={errors.building}>{({ id }) => <Input id={id} value={v.building} onChange={(e) => set('building', e.target.value)} />}</Field>
        <Field label="Room code" error={errors.roomCode}>{({ id }) => <Input id={id} value={v.roomCode} onChange={(e) => set('roomCode', e.target.value)} />}</Field>
        <Field label="Type" error={errors.kind}>
          {({ id }) => (
            <Select id={id} value={v.kind} onChange={(e) => set('kind', e.target.value as VenueKind)}>
              {VENUE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LABELS.venueKind[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Seated capacity" required error={errors.capacity}>{({ id }) => <Input id={id} type="number" min={1} value={v.capacity} onChange={(e) => set('capacity', e.target.value)} />}</Field>
        <Field label="Turnover between bookings (min)" error={errors.turnoverMinutes}>{({ id }) => <Input id={id} type="number" min={0} max={240} value={v.turnoverMinutes} onChange={(e) => set('turnoverMinutes', e.target.value)} />}</Field>
      </div>
      <fieldset className="mt-5">
        <legend className="mb-2 text-[13px] font-medium text-paper-2">Facilities</legend>
        <div className="flex flex-wrap gap-2">
          {COMMON_FACILITIES.map((f) => (
            <label key={f} className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1 text-[12.5px] text-paper-2 has-[:checked]:border-signal has-[:checked]:text-paper">
              <input type="checkbox" className="accent-[var(--color-signal)]" checked={v.facilities.includes(f)} onChange={(e) => set('facilities', e.target.checked ? [...v.facilities, f] : v.facilities.filter((x) => x !== f))} />
              {facilityLabel(f)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-5 space-y-3">
        <Checkbox label="Step-free access" checked={v.stepFree} onChange={(e) => set('stepFree', e.target.checked)} />
        <Field label="Accessibility notes">{({ id }) => <Input id={id} value={v.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
        <Checkbox label="Only available at certain times" checked={v.restricted} onChange={(e) => set('restricted', e.target.checked)} />
        {v.restricted && (
          <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-sm)] border border-line p-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days available">
              {DAYS.map((d, i) => (
                <label key={d} className="flex cursor-pointer items-center gap-1 rounded border border-line px-2 py-1 text-xs has-[:checked]:border-signal">
                  <input type="checkbox" className="accent-[var(--color-signal)]" checked={v.days.includes(i)} onChange={(e) => set('days', e.target.checked ? [...v.days, i].sort() : v.days.filter((x) => x !== i))} />
                  {d}
                </label>
              ))}
            </div>
            <Field label="Opens">{({ id }) => <Input id={id} type="time" value={v.opensAt} onChange={(e) => set('opensAt', e.target.value)} />}</Field>
            <Field label="Closes" error={errors['availability.closesAt']}>{({ id }) => <Input id={id} type="time" value={v.closesAt} onChange={(e) => set('closesAt', e.target.value)} />}</Field>
          </div>
        )}
        <Checkbox label="Active — can be booked" checked={v.active} onChange={(e) => set('active', e.target.checked)} />
      </div>
      {errors._ && <div className="mt-4"><FormAlert>{errors._}</FormAlert></div>}
    </Dialog>
  );
}
