import { useRef } from 'react';
import { CalendarSearch, ChevronLeft, ChevronRight, LocateFixed, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { formatInZone } from '@campusflow/shared';
import { FormGlyph } from '../../../components/CategoryMark';
import { STATE_LABEL, type Node } from '../../../three/layout';
import { SPANS, type UniverseState } from './useUniverse';

const DAY_MS = 86_400_000;

/**
 * Time navigation for the landscape, and an accessible index of the events in view.
 * Every marker is a real button; the rail mirrors exactly what the scene shows.
 */
export function TimeRail({ u, tz }: { u: UniverseState; tz: string }) {
  const dateInput = useRef<HTMLInputElement>(null);
  const from = u.centerDay - 1;
  const to = u.centerDay + u.spanDays;
  const pct = (day: number) => ((day - from) / (to - from)) * 100;
  const inView = u.layout.nodes.filter((n) => n.day >= from && n.day <= to);
  const earlier = u.layout.nodes.filter((n) => n.day < from).length;
  const later = u.layout.nodes.filter((n) => n.day > to).length;
  const ticks = Array.from({ length: Math.floor(to) - Math.ceil(from) + 1 }, (_, i) => Math.ceil(from) + i);
  const dayLabel = (d: number) => formatInZone(u.layout.startOfToday + d * DAY_MS + 12 * 3600_000, tz, 'd MMM');
  const todayPos = u.layout.todayX / 0.62;

  // Stack markers that land on the same day so none hide each other.
  const stackIndex = new Map<string, number>();
  const perDay = new Map<number, number>();
  for (const n of inView) {
    const d = Math.floor(n.day);
    const k = perDay.get(d) ?? 0;
    perDay.set(d, k + 1);
    stackIndex.set(n.id, k);
  }

  const marker = (n: Node) => {
    const selected = u.selected?.id === n.id;
    const hovered = u.hoveredId === n.id;
    const k = stackIndex.get(n.id) ?? 0;
    return (
      <button
        key={n.id}
        type="button"
        onClick={() => u.select(selected ? null : n.id)}
        onMouseEnter={() => u.setHovered(n.id)}
        onMouseLeave={() => u.setHovered(null)}
        onFocus={() => u.setHovered(n.id)}
        onBlur={() => u.setHovered(null)}
        aria-pressed={selected}
        aria-label={`${n.title}, ${formatInZone(n.startsAt, tz, 'EEE d MMM HH:mm')}, ${n.categoryName}, ${STATE_LABEL[n.state]}`}
        title={`${n.title} · ${formatInZone(n.startsAt, tz, 'EEE d MMM, HH:mm')}`}
        className={clsx(
          'absolute flex size-6 -translate-x-1/2 items-center justify-center rounded-[3px] transition-colors duration-[var(--dur-fast)]',
          selected ? 'bg-signal text-signal-ink' : hovered ? 'bg-ink-700 text-paper' : n.live ? 'text-signal' : n.state === 'open' ? 'text-paper' : 'text-paper-3',
          u.selected && !selected && 'opacity-50',
        )}
        style={{ left: `${pct(n.day)}%`, bottom: `${10 + Math.min(k, 2) * 18}px` }}
      >
        <FormGlyph form={n.form} className="size-3.5" />
        {n.state === 'full' && <span aria-hidden className="absolute -top-0.5 left-1 right-1 h-[2px] bg-warn" />}
      </button>
    );
  };

  return (
    <div className="relative z-20 border-t border-line bg-ink-950/85 backdrop-blur-[2px]">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-2 px-[var(--gutter)] py-2 md:h-[76px] md:flex-row md:items-stretch md:gap-5 md:py-0">
        <div className="flex items-center gap-1.5 md:py-3">
          <RailButton label="Earlier" onClick={() => u.shiftWindow(-1)} disabled={u.centerDay <= 0}>
            <ChevronLeft className="size-4" />
          </RailButton>
          <button
            type="button"
            onClick={u.goToday}
            className={clsx('inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[12.5px] transition-colors', u.centerDay === 0 && !u.selected ? 'text-signal' : 'text-paper-2 hover:bg-ink-800 hover:text-paper')}
          >
            <LocateFixed className="size-3.5" /> Today
          </button>
          <RailButton label="Later" onClick={() => u.shiftWindow(1)}>
            <ChevronRight className="size-4" />
          </RailButton>
          <span className="ml-auto flex items-center gap-1.5 md:hidden">
            <SpanPicker u={u} />
          </span>
        </div>

        <div className="relative min-h-[64px] flex-1 md:min-h-0" role="group" aria-label={`Events from ${dayLabel(Math.max(from, 0))} to ${dayLabel(to)}`}>
          <div aria-hidden className="absolute inset-x-0 bottom-[6px] h-px bg-line-strong" />
          {ticks.map((d) => {
            const week = d % 7 === 0;
            return (
              <span key={d} aria-hidden className="absolute bottom-[6px] -translate-x-1/2" style={{ left: `${pct(d)}%` }}>
                <span className={clsx('block w-px', week ? 'h-2.5 bg-paper-3' : 'h-1.5 bg-line-strong')} />
                {week && <span className="kicker absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap !text-[9.5px] text-paper-3">{d === 0 ? 'Today' : dayLabel(d)}</span>}
              </span>
            );
          })}
          {todayPos >= from && todayPos <= to && <span aria-hidden className="absolute bottom-[6px] top-2 w-px bg-signal" style={{ left: `${pct(todayPos)}%` }} />}
          {inView.map(marker)}
          {earlier > 0 && <span className="kicker absolute left-0 top-1 !text-[9.5px] text-paper-3">‹ {earlier} earlier</span>}
          {later > 0 && <span className="kicker absolute right-0 top-1 !text-[9.5px] text-paper-3">{later} later ›</span>}
          {u.status === 'loading' && <span className="absolute inset-0 flex items-center text-xs text-paper-3">Loading events…</span>}
          {u.status === 'error' && (
            <button type="button" onClick={u.refetch} className="absolute inset-0 flex items-center gap-1.5 text-xs text-bad">
              <RefreshCw className="size-3.5" /> Couldn’t load events — retry
            </button>
          )}
          {u.status === 'ready' && u.events.length > 0 && inView.length === 0 && (
            <span className="absolute inset-x-0 top-2 text-center text-xs text-paper-3">No events in this window — use ‹ › to move through time</span>
          )}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <SpanPicker u={u} />
          <RailButton label="Jump to a date" onClick={() => dateInput.current?.showPicker?.() ?? dateInput.current?.focus()}>
            <CalendarSearch className="size-4" />
          </RailButton>
          <input
            ref={dateInput}
            type="date"
            aria-label="Jump to date"
            className="sr-only"
            min={formatInZone(Date.now(), tz, 'yyyy-MM-dd')}
            onChange={(e) => u.goToDate(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function SpanPicker({ u }: { u: UniverseState }) {
  return (
    <div role="group" aria-label="Time range" className="flex rounded-[var(--radius-sm)] border border-line p-0.5">
      {SPANS.map((s) => (
        <button
          key={s.days}
          type="button"
          aria-pressed={u.spanDays === s.days}
          onClick={() => u.setSpan(s.days)}
          className={clsx('rounded-[3px] px-2 py-1 text-[11.5px] transition-colors', u.spanDays === s.days ? 'bg-ink-700 text-paper' : 'text-paper-3 hover:text-paper')}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function RailButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] text-paper-2 transition-colors hover:bg-ink-800 hover:text-paper disabled:opacity-30"
    >
      {children}
    </button>
  );
}
