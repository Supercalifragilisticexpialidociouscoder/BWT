import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { TZDate } from '@date-fns/tz';
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight, MapPin, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import type { CalendarEntryDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { FormGlyph } from '../../components/CategoryMark';
import { categoryForm } from '../../lib/categories';
import { ErrorState, PageHeader } from '../../components/ui/Feedback';
import { DemoBadge, StatusPill } from '../../components/ui/Status';
import { Tabs } from '../../components/ui/Tabs';

type View = 'month' | 'week' | 'agenda';
const DAY_START = 7;
const DAY_END = 23;
const HOUR_PX = 44;

export function CalendarPage() {
  const fmt = useFormat();
  const tz = fmt.tz;
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'agenda' : 'month'));
  const [cursor, setCursor] = useState(() => new TZDate(Date.now(), tz));
  const [open, setOpen] = useState<CalendarEntryDTO | null>(null);
  const venue = params.get('venue') ?? '';
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<{ id: string; name: string; building: string }[]>('/venues') });

  const range = useMemo(() => {
    if (view === 'month') return { from: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), to: addDays(endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }), 1) };
    if (view === 'week') return { from: startOfWeek(cursor, { weekStartsOn: 1 }), to: addDays(startOfWeek(cursor, { weekStartsOn: 1 }), 7) };
    const today = startOfDay(new TZDate(Date.now(), tz));
    return { from: today, to: addDays(today, 90) };
  }, [view, cursor, tz]);

  const q = useQuery({
    queryKey: ['calendar', range.from.toISOString(), range.to.toISOString(), venue],
    queryFn: () => api<CalendarEntryDTO[]>('/calendar', { query: { from: range.from.toISOString(), to: startOfDay(range.to).toISOString(), venue: venue || undefined } }),
    placeholderData: (prev) => prev,
  });
  const entries = q.data ?? [];
  const conflicts = entries.filter((e) => e.conflicts.length).length;

  const step = (dir: 1 | -1) => setCursor((c) => (view === 'month' ? addMonths(c, dir) : addWeeks(c, dir)));
  const title = view === 'month' ? format(cursor, 'MMMM yyyy') : view === 'week' ? `${format(range.from, 'd MMM')} – ${format(addDays(range.to, -1), 'd MMM yyyy')}` : 'Next 90 days';

  const onDay = (day: Date) =>
    entries
      .filter((e) => {
        const s = new TZDate(e.startsAt, tz);
        const en = new TZDate(new Date(e.endsAt).getTime() - 1, tz);
        return startOfDay(s) <= day && day <= startOfDay(en);
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Workspace"
        title="Calendar"
        description={
          <span>
            Published events and the drafts you manage, with venue bookings. Times in {tz}.
            {conflicts > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-warn">
                <TriangleAlert className="size-3.5" /> {conflicts} event{conflicts === 1 ? '' : 's'} with a venue clash in view
              </span>
            )}
          </span>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          {view !== 'agenda' && (
            <>
              <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => step(-1)} icon={<ChevronLeft className="size-4" />} />
              <Button size="sm" variant="ghost" aria-label="Next" onClick={() => step(1)} icon={<ChevronRight className="size-4" />} />
              <Button size="sm" onClick={() => setCursor(new TZDate(Date.now(), tz))}>
                Today
              </Button>
            </>
          )}
          <h2 className="display-sm ml-2" aria-live="polite">
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <select aria-label="Filter by venue" className="field !w-auto !py-1.5 !text-[13px]" value={venue} onChange={(e) => setParams(e.target.value ? { venue: e.target.value } : {}, { replace: true })}>
            <option value="">All venues</option>
            {(venues.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <Tabs label="Calendar view" value={view} onChange={setView} items={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'agenda', label: 'Agenda' }]} />
        </div>
      </div>

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      <div className={clsx('transition-opacity', q.isFetching && 'opacity-60')}>
        {view === 'month' && (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-line">
            <div className="grid grid-cols-7 border-b border-line bg-ink-900">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="kicker px-2 py-2 text-paper-3">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: Math.round((range.to.getTime() - range.from.getTime()) / 864e5) }, (_, i) => {
                const day = addDays(range.from, i);
                const list = onDay(day);
                const today = isSameDay(day, new TZDate(Date.now(), tz));
                return (
                  <div key={i} className={clsx('min-h-28 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0', !isSameMonth(day, cursor) && 'bg-ink-900/40')}>
                    <p className={clsx('tnum mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs', today ? 'bg-signal font-semibold text-signal-ink' : isSameMonth(day, cursor) ? 'text-paper-2' : 'text-paper-3/60')}>{format(day, 'd')}</p>
                    <ul className="space-y-1">
                      {list.slice(0, 3).map((e) => (
                        <li key={e.id}>
                          <Chip entry={e} onOpen={setOpen} time={fmt.time(e.startsAt)} />
                        </li>
                      ))}
                      {list.length > 3 && (
                        <li>
                          <button type="button" className="px-1 text-[11px] text-paper-3 hover:text-paper" onClick={() => { setCursor(day as TZDate); setView('week'); }}>
                            +{list.length - 3} more
                          </button>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === 'week' && (
          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-line">
            <div className="grid min-w-[860px] grid-cols-[52px_repeat(7,1fr)]">
              <div className="border-b border-line bg-ink-900" />
              {Array.from({ length: 7 }, (_, i) => {
                const day = addDays(range.from, i);
                const today = isSameDay(day, new TZDate(Date.now(), tz));
                return (
                  <div key={i} className="border-b border-l border-line bg-ink-900 px-2 py-2">
                    <span className="kicker text-paper-3">{format(day, 'EEE')}</span> <span className={clsx('tnum text-sm', today ? 'text-signal' : 'text-paper')}>{format(day, 'd')}</span>
                  </div>
                );
              })}
              <div className="relative" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
                {Array.from({ length: DAY_END - DAY_START }, (_, h) => (
                  <span key={h} className="tnum absolute right-2 -translate-y-1/2 text-[10px] text-paper-3" style={{ top: h * HOUR_PX }}>
                    {h > 0 ? `${String(DAY_START + h).padStart(2, '0')}:00` : ''}
                  </span>
                ))}
              </div>
              {Array.from({ length: 7 }, (_, i) => {
                const day = addDays(range.from, i);
                const list = onDay(day);
                const lanes: CalendarEntryDTO[][] = [];
                for (const e of list) {
                  const lane = lanes.find((l) => l.every((x) => x.endsAt <= e.startsAt || x.startsAt >= e.endsAt));
                  lane ? lane.push(e) : lanes.push([e]);
                }
                return (
                  <div key={i} className="relative border-l border-line" style={{ height: (DAY_END - DAY_START) * HOUR_PX, backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line) 0 1px, transparent 1px ${HOUR_PX}px)` }}>
                    {lanes.flatMap((lane, li) =>
                      lane.map((e) => {
                        const dayStart = day.getTime() + DAY_START * 3600_000;
                        const top = Math.max(0, (new Date(e.startsAt).getTime() - dayStart) / 3600_000) * HOUR_PX;
                        const bottom = Math.min(DAY_END - DAY_START, (new Date(e.endsAt).getTime() - dayStart) / 3600_000) * HOUR_PX;
                        if (bottom <= 0 || top >= (DAY_END - DAY_START) * HOUR_PX) return null;
                        return (
                          <button
                            key={`${e.id}-${li}`}
                            type="button"
                            onClick={() => setOpen(e)}
                            className={clsx('absolute overflow-hidden rounded-[4px] border px-1.5 py-1 text-left text-[11px] leading-tight transition-colors hover:z-10', e.conflicts.length ? 'border-warn/70 bg-warn/15' : e.status === 'draft' ? 'border-dashed border-line-strong bg-ink-850' : 'border-line-strong bg-ink-800 hover:border-paper-3')}
                            style={{ top, height: Math.max(22, bottom - top - 2), left: `calc(${(li / lanes.length) * 100}% + 2px)`, width: `calc(${100 / lanes.length}% - 4px)` }}
                          >
                            <span className="tnum flex items-center gap-1 text-paper-3">
                              {e.conflicts.length ? <TriangleAlert className="size-3 text-warn" aria-label="Venue clash" /> : <FormGlyph form={categoryForm(e.category)} className="size-3" />}
                              {fmt.time(e.startsAt)}
                            </span>
                            <span className="block truncate text-paper">{e.title}</span>
                            {e.allocations[0] && <span className="block truncate text-paper-3">{e.allocations[0].venueName}</span>}
                          </button>
                        );
                      }),
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === 'agenda' && (
          <ol className="space-y-6">
            {entries.length === 0 && <li className="text-sm text-paper-3">Nothing scheduled.</li>}
            {Object.entries(
              entries.reduce<Record<string, CalendarEntryDTO[]>>((acc, e) => {
                const k = fmt.f(e.startsAt, 'yyyy-MM-dd');
                (acc[k] ??= []).push(e);
                return acc;
              }, {}),
            ).map(([day, list]) => (
              <li key={day} className="grid gap-3 sm:grid-cols-[120px_1fr]">
                <p className="text-sm text-paper-2">
                  <span className="display-sm block !text-2xl">{fmt.f(`${day}T12:00:00Z`, 'd')}</span>
                  {fmt.f(`${day}T12:00:00Z`, 'EEE, MMM')}
                </p>
                <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
                  {list.map((e) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => setOpen(e)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-ink-900">
                        <span className="min-w-0">
                          <span className="block text-paper">{e.title}</span>
                          <span className="text-xs text-paper-3">
                            {fmt.time(e.startsAt)}–{fmt.time(e.endsAt)} · {e.allocations.map((a) => a.venueName).join(', ') || 'No venue'} · {e.organization}
                          </span>
                        </span>
                        {e.conflicts.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-warn">
                            <TriangleAlert className="size-3.5" /> clash
                          </span>
                        ) : (
                          <StatusPill kind="event" value={e.status} />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Dialog open={open !== null} onClose={() => setOpen(null)} variant="drawer" title={open?.title ?? ''} description={open ? `${fmt.range(open.startsAt, open.endsAt)} · ${open.organization}` : undefined}>
        {open && (
          <div className="space-y-6 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill kind="event" value={open.status} />
              {open.isDemo && <DemoBadge />}
            </div>
            <section>
              <h3 className="kicker mb-2 text-paper-3">Venue bookings</h3>
              {open.allocations.length === 0 ? (
                <p className="text-paper-3">No venue booked.</p>
              ) : (
                <ul className="space-y-1">
                  {open.allocations.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <MapPin className="size-4 text-paper-3" /> {a.venueName} <span className={clsx('kicker !text-[10px]', a.status === 'confirmed' ? 'text-ok' : 'text-warn')}>{a.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {open.conflicts.length > 0 && (
              <section>
                <h3 className="kicker mb-2 text-warn">Clashes</h3>
                <ul className="space-y-1 text-paper-2">
                  {open.conflicts.map((c) => (
                    <li key={c.allocationId + c.withEventId}>
                      {c.venueName} is also booked for “{c.withEventTitle}” within its turnover window.
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="flex flex-wrap gap-2">
              {open.manageable && (
                <ButtonLink to={`/workspace/events/${open.id}?tab=venue`} variant="primary" size="sm">
                  Open in editor
                </ButtonLink>
              )}
              {open.status !== 'draft' && (
                <Link to={`/events/${open.slug}`} className="inline-flex h-8 items-center px-3 text-[13px] text-paper-2 hover:text-paper">
                  Public page →
                </Link>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Chip({ entry: e, onOpen, time }: { entry: CalendarEntryDTO; onOpen: (e: CalendarEntryDTO) => void; time: string }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      className={clsx(
        'flex w-full items-center gap-1.5 truncate rounded-[3px] px-1.5 py-0.5 text-left text-[11px] transition-colors',
        e.conflicts.length ? 'bg-warn/15 text-paper ring-1 ring-warn/60' : e.status === 'draft' ? 'border border-dashed border-line-strong text-paper-2' : 'bg-ink-800 text-paper hover:bg-ink-700',
      )}
      title={`${e.title}${e.conflicts.length ? ' — venue clash' : ''}`}
    >
      {e.conflicts.length > 0 ? <TriangleAlert className="size-3 shrink-0 text-warn" aria-label="Venue clash" /> : <FormGlyph form={categoryForm(e.category)} className="size-3 text-paper-3" />}
      <span className="tnum shrink-0 text-paper-3">{time}</span>
      <span className="truncate">{e.title}</span>
    </button>
  );
}
