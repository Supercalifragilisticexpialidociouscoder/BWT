import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowUpRight, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { zonedInputToUtc, type EventSummaryDTO, type Page } from '@campusflow/shared';
import { api } from '../../lib/api';
import { useInstitutionRequired } from '../../lib/institution';
import { feeLabel, formatLabel, relativeTime, useFormat } from '../../lib/format';
import { CategoryMark, FormGlyph } from '../../components/CategoryMark';
import { categoryForm } from '../../lib/categories';
import { EventPoster } from '../../components/EventPoster';
import { DemoBadge, StatusPill } from '../../components/ui/Status';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';

export type WhenFilter = 'any' | 'week' | 'month' | 'custom';

export function useDirectoryFilters() {
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') ?? '',
    category: params.get('category'),
    mode: (params.get('mode') as 'individual' | 'team' | null) ?? null,
    when: (params.get('when') as WhenFilter | null) ?? 'any',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    open: params.get('open') === '1',
  };
  const set = (patch: Partial<Record<'q' | 'category' | 'mode' | 'when' | 'from' | 'to' | 'open', string | null>>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '' || v === undefined) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  };
  const active = Boolean(filters.q || filters.category || filters.mode || filters.when !== 'any' || filters.open);
  return { filters, set, active, clear: () => set({ q: null, category: null, mode: null, when: null, from: null, to: null, open: null }) };
}

function rangeFor(when: WhenFilter, from: string, to: string, tz: string): { from?: string; to?: string } {
  const now = new Date();
  if (when === 'week') return { from: now.toISOString(), to: new Date(now.getTime() + 7 * 864e5).toISOString() };
  if (when === 'month') return { from: now.toISOString(), to: new Date(now.getTime() + 30 * 864e5).toISOString() };
  if (when === 'custom') {
    return {
      from: from ? zonedInputToUtc(`${from}T00:00`, tz).toISOString() : undefined,
      to: to ? new Date(zonedInputToUtc(`${to}T00:00`, tz).getTime() + 864e5).toISOString() : undefined,
    };
  }
  return {};
}

export function Directory({ stickyTop = 0, heading = true }: { stickyTop?: number; heading?: boolean }) {
  const inst = useInstitutionRequired();
  const { filters, set, active, clear } = useDirectoryFilters();
  const [search, setSearch] = useState(filters.q);
  useEffect(() => setSearch(filters.q), [filters.q]);
  useEffect(() => {
    const t = window.setTimeout(() => search !== filters.q && set({ q: search.trim() || null }), 260);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const range = rangeFor(filters.when, filters.from, filters.to, inst.timezone);
  const query = useInfiniteQuery({
    queryKey: ['events', 'directory', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      api<Page<EventSummaryDTO>>('/events', {
        signal,
        query: {
          page: pageParam,
          pageSize: 12,
          q: filters.q,
          category: filters.category ?? undefined,
          mode: filters.mode ?? undefined,
          availability: filters.open ? 'open' : undefined,
          when: 'upcoming',
          ...range,
        },
      }),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: (prev) => prev,
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <div className="mx-auto max-w-[1400px] px-[var(--gutter)]">
      {heading && (
        <div className="flex flex-col justify-between gap-4 pb-8 pt-20 sm:flex-row sm:items-end">
          <div>
            <p className="kicker mb-3 text-paper-3">The directory</p>
            <h2 className="display-lg">
              What’s on at <span className="italic-accent">{inst.shortName}</span>
            </h2>
          </div>
          <p className="max-w-sm text-sm text-paper-2">
            Every published event, soonest first. Open one to see the schedule, rules and how to register — solo or with your team.
          </p>
        </div>
      )}

      <div className="sticky z-30 -mx-[var(--gutter)] border-y border-line bg-ink-950/92 px-[var(--gutter)] py-3 backdrop-blur-md" style={{ top: stickyTop }}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 basis-56">
              <span className="sr-only">Search events</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-paper-3" aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" placeholder="Search by name or topic" className="field !pl-9" />
            </label>
            <select aria-label="When" className="field !w-auto" value={filters.when} onChange={(e) => set({ when: e.target.value === 'any' ? null : e.target.value })}>
              <option value="any">Any date</option>
              <option value="week">Next 7 days</option>
              <option value="month">Next 30 days</option>
              <option value="custom">Pick dates…</option>
            </select>
            {filters.when === 'custom' && (
              <div className="flex items-center gap-2">
                <input type="date" aria-label="From date" className="field !w-auto" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
                <span className="text-paper-3">–</span>
                <input type="date" aria-label="To date" className="field !w-auto" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
              </div>
            )}
            <div role="group" aria-label="Format" className="flex rounded-[var(--radius-sm)] border border-line p-0.5">
              {(
                [
                  [null, 'All'],
                  ['individual', 'Solo'],
                  ['team', 'Team'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={filters.mode === v}
                  onClick={() => set({ mode: v })}
                  className={clsx('rounded-[3px] px-3 py-1.5 text-[13px] transition-colors', filters.mode === v ? 'bg-ink-700 text-paper' : 'text-paper-3 hover:text-paper')}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-line px-3 py-2 text-[13px] text-paper-2 has-[:checked]:border-signal/60 has-[:checked]:text-paper">
              <input type="checkbox" className="accent-[var(--color-signal)]" checked={filters.open} onChange={(e) => set({ open: e.target.checked ? '1' : null })} />
              Open for registration
            </label>
          </div>
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Category">
            <CategoryChip active={!filters.category} onClick={() => set({ category: null })}>
              All categories
            </CategoryChip>
            {inst.categories.map((c) => (
              <CategoryChip key={c.slug} active={filters.category === c.slug} onClick={() => set({ category: filters.category === c.slug ? null : c.slug })}>
                <FormGlyph form={categoryForm(c.slug, c.name)} className="size-3" />
                {c.name}
              </CategoryChip>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between py-4 text-[13px] text-paper-3" aria-live="polite">
        <span>
          {query.isPending ? 'Loading events…' : `${total} upcoming ${total === 1 ? 'event' : 'events'}${active ? ' match your filters' : ''}`}
        </span>
        {active && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-paper-2 hover:text-paper">
            <X className="size-3.5" /> Clear filters
          </button>
        )}
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <ul className="divide-y divide-line border-y border-line">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex gap-6 py-6">
              <Skeleton className="h-28 w-20" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          title={filters.category && !filters.q && filters.when === 'any' && !filters.open && !filters.mode ? `No upcoming ${inst.categories.find((c) => c.slug === filters.category)?.name ?? ''} events` : 'No events match'}
          body={
            filters.open
              ? 'Nothing open for registration fits these filters. Include closed and full events, or widen the dates.'
              : filters.category && !filters.q
                ? 'Nothing in this category is published yet. Try another category or clear the filter.'
                : 'Try a different search, another category, or a wider date range.'
          }
          action={active ? <Button onClick={clear}>Clear all filters</Button> : undefined}
        />
      ) : (
        <ul className={clsx('border-t border-line transition-opacity', query.isFetching && !query.isFetchingNextPage && 'opacity-60')}>
          {items.map((e, i) => (
            <EventRow key={e.id} event={e} index={i} />
          ))}
        </ul>
      )}

      {query.hasNextPage && (
        <div className="flex justify-center pt-8">
          <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Show more events
          </Button>
        </div>
      )}
    </div>
  );
}

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px] transition-colors duration-[var(--dur-fast)]',
        active ? 'border-signal bg-signal text-signal-ink' : 'border-line text-paper-2 hover:border-line-strong hover:text-paper',
      )}
    >
      {children}
    </button>
  );
}

export function EventRow({ event: e, index = 0 }: { event: EventSummaryDTO; index?: number }) {
  const fmt = useFormat();
  const unit = e.mode === 'team' ? 'teams' : 'places';
  const now = Date.now();
  const live = new Date(e.startsAt).getTime() <= now && new Date(e.endsAt).getTime() > now;
  const closingSoon = e.registrationState === 'open' && new Date(e.registrationDeadline).getTime() - now < 48 * 3600_000;
  return (
    <li
      className="group relative grid animate-rise grid-cols-[64px_1fr] items-start gap-4 border-b border-line py-5 transition-colors duration-[var(--dur-fast)] hover:bg-ink-900/60 sm:grid-cols-[80px_112px_1fr_200px] sm:gap-7 sm:py-6 sm:pr-3"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <EventPoster event={e} size="sm" showDate={false} showCategory={false} className="aspect-[3/4] w-16 rounded-[var(--radius-xs)] transition-transform duration-[var(--dur-panel)] group-hover:scale-[1.03] sm:w-20" />
      <div className="hidden pt-1 sm:block">
        <p className="font-display text-5xl leading-[0.85] tracking-tight" style={{ fontWeight: 330, fontVariationSettings: '"opsz" 144' }}>
          {fmt.dayNum(e.startsAt)}
        </p>
        <p className="kicker mt-2 text-paper-3">
          {fmt.month(e.startsAt)} · {fmt.weekday(e.startsAt)}
        </p>
        <p className="tnum mt-1 text-xs text-paper-3">{fmt.time(e.startsAt)}</p>
      </div>
      <div className="min-w-0">
        <p className="kicker flex flex-wrap items-center gap-x-2 gap-y-1 text-paper-3">
          <CategoryMark slug={e.category} name={e.categoryName} withLabel />
          <span aria-hidden>·</span>
          <span className="normal-case tracking-normal">{e.organization.name}</span>
          {e.isDemo && <DemoBadge />}
        </p>
        <h3 className="display-sm mt-1.5 text-paper decoration-signal decoration-1 underline-offset-[5px] group-hover:underline">
          <Link to={`/events/${e.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {e.title}
          </Link>
        </h3>
        <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm text-paper-2">{e.summary}</p>
        <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-paper-3">
          <span className="sm:hidden">{fmt.dateTime(e.startsAt)}</span>
          <span>{formatLabel(e.mode, e.teamSize)}</span>
          <span>{feeLabel(e.fee, e.mode)}</span>
          {e.venue && <span>{e.venue.name}</span>}
        </p>
      </div>
      <div className="col-start-2 flex items-center justify-between gap-3 sm:col-start-auto sm:flex-col sm:items-end sm:justify-start sm:pt-1">
        <StatusPill kind="window" value={live ? 'open' : e.registrationState} label={live ? 'On now' : undefined} />
        <div className="text-right text-[12.5px] text-paper-3">
          {e.registrationState === 'open' && e.remaining !== null && (
            <span className={clsx('tnum', e.remaining <= 5 && 'text-warn')}>
              {e.remaining} {e.remaining === 1 ? unit.slice(0, -1) : unit} left
            </span>
          )}
          {e.registrationState === 'open' && e.capacity === null && <span>No limit</span>}
          {e.registrationState === 'open' && (
            <span className={clsx('block', closingSoon && 'text-warn')}>{closingSoon ? `Closes ${relativeTime(e.registrationDeadline)}` : `Closes ${fmt.shortDate(e.registrationDeadline)}`}</span>
          )}
          {e.registrationState === 'full' && e.mode === 'team' && <span>Teams can still add members</span>}
          {e.registrationState === 'not_yet_open' && e.registrationOpensAt && <span>Opens {fmt.dateTime(e.registrationOpensAt)}</span>}
        </div>
        <ArrowUpRight className="hidden size-5 text-paper-3 transition-transform duration-[var(--dur-fast)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-signal sm:block" aria-hidden />
      </div>
    </li>
  );
}
