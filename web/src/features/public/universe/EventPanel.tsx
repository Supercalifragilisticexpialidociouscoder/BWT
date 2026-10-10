import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import clsx from 'clsx';
import type { EventSummaryDTO } from '@campusflow/shared';
import { feeLabel, formatLabel, relativeTime, useFormat } from '../../../lib/format';
import { FormGlyph } from '../../../components/CategoryMark';
import { DemoBadge, LiveDot, StatusPill } from '../../../components/ui/Status';
import type { Node } from '../../../three/layout';

const HOUR = 3_600_000;

/** What a visitor can do with this event right now, decided by the server's registration state. */
export function primaryAction(e: EventSummaryDTO): { label: string; to: string | null; note: string | null; secondary?: { label: string; to: string } } {
  const team = e.mode === 'team';
  switch (e.registrationState) {
    case 'open':
      return {
        label: team ? 'Register a team' : 'Register',
        to: `/events/${e.slug}/register`,
        note: null,
        secondary: team ? { label: 'Join with a code', to: '/join' } : undefined,
      };
    case 'full':
      return team
        ? { label: 'Join a team with a code', to: '/join', note: `All ${e.capacity} team slots are taken; existing teams can still add members.` }
        : { label: 'View details', to: null, note: `All ${e.capacity} places are taken.` };
    case 'not_yet_open':
      return { label: 'View details', to: null, note: e.registrationOpensAt ? `Registration opens ${relativeTime(e.registrationOpensAt)}.` : 'Registration has not opened yet.' };
    case 'cancelled':
      return { label: 'View details', to: null, note: 'This event has been cancelled.' };
    case 'ended':
      return { label: 'View details', to: null, note: 'This event has ended.' };
    default:
      return { label: 'View details', to: null, note: 'Registration has closed.' };
  }
}

export function EventPanel({
  event: e,
  node,
  onClose,
  onStep,
  onKeyDown,
  position,
}: {
  event: EventSummaryDTO;
  node: Node;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
  onKeyDown?: (ev: React.KeyboardEvent) => void;
  position: string;
}) {
  const fmt = useFormat();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Move focus into the panel only when the selection came from a pointer; keyboard users
    // stay on the landscape so the arrow keys keep stepping through events.
    const active = document.activeElement;
    if (active?.getAttribute('role') !== 'application' && !heading.current?.closest('section')?.contains(active)) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [e.id]);
  const action = primaryAction(e);
  const unit = e.mode === 'team' ? 'teams' : 'places';
  const deadlineMs = new Date(e.registrationDeadline).getTime() - Date.now();
  const closingSoon = e.registrationState === 'open' && deadlineMs > 0 && deadlineMs < 48 * HOUR;
  const live = node.live;

  return (
    <section
      aria-label="Selected event"
      onKeyDown={(ev) => {
        if (['ArrowLeft', 'ArrowRight', 'Escape'].includes(ev.key) && !(ev.target instanceof HTMLInputElement)) onKeyDown?.(ev);
      }}
      className="pointer-events-auto flex max-h-full animate-rise flex-col border-line bg-ink-950/95 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)] max-lg:rounded-t-[var(--radius-lg)] max-lg:border-t lg:border lg:border-line-strong"
    >
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <FormGlyph form={node.form} className={clsx('size-4', live ? 'text-signal' : 'text-paper-2')} />
        <p className="kicker min-w-0 flex-1 truncate text-paper-3">
          {e.categoryName} · <span className="normal-case tracking-normal">{e.organization.name}</span>
        </p>
        <span className="tnum mr-1 text-[11px] text-paper-3">{position}</span>
        <button type="button" onClick={() => onStep(-1)} aria-label="Previous event" className="rounded p-1 text-paper-3 hover:bg-ink-800 hover:text-paper">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" onClick={() => onStep(1)} aria-label="Next event" className="rounded p-1 text-paper-3 hover:bg-ink-800 hover:text-paper">
          <ChevronRight className="size-4" />
        </button>
        <button type="button" onClick={onClose} aria-label="Back to the overview (Escape)" className="-mr-1 rounded p-1 text-paper-3 hover:bg-ink-800 hover:text-paper">
          <X className="size-4" />
        </button>
      </header>

      <div className="overflow-y-auto px-5 pb-5 pt-4">
        {live && (
          <p className="kicker mb-2 inline-flex items-center gap-2 text-signal">
            <LiveDot /> Happening now
          </p>
        )}
        <h2 ref={heading} tabIndex={-1} className="display-md !text-[clamp(1.6rem,2.4vw,2.2rem)] outline-none">
          {e.title}
        </h2>
        <p className="mt-2 text-sm text-paper-2">
          {fmt.range(e.startsAt, e.endsAt)}
          {!live && <span className="text-paper-3"> · {relativeTime(e.startsAt)}</span>}
        </p>
        <p className="mt-3 line-clamp-3 text-[13.5px] leading-relaxed text-paper-2">{e.summary}</p>

        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3.5 border-t border-line pt-4 text-[13px]">
          <Item label="Where" value={e.venue ? e.venue.name : 'Venue to be announced'} detail={e.venue?.building} />
          <Item
            label="Places"
            value={e.capacity === null ? 'No limit set' : e.registrationState === 'full' ? `All ${e.capacity} taken` : `${e.remaining} of ${e.capacity} ${unit} left`}
          />
          <Item label="Format" value={formatLabel(e.mode, e.teamSize)} />
          <Item label="Fee" value={feeLabel(e.fee, e.mode)} />
          <Item
            label="Registration"
            value={<StatusPill kind="window" value={e.registrationState} />}
            detail={
              e.registrationState === 'open' ? (
                <span className={clsx(closingSoon && 'text-warn')}>
                  {closingSoon ? 'Closes ' : 'Until '}
                  {closingSoon ? relativeTime(e.registrationDeadline) : fmt.dateTime(e.registrationDeadline)}
                </span>
              ) : undefined
            }
          />
          <Item label="Registered" value={`${e.activeRegistrations} ${e.mode === 'team' ? (e.activeRegistrations === 1 ? 'team' : 'teams') : e.activeRegistrations === 1 ? 'person' : 'people'}`} />
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            to={action.to ?? `/events/${e.slug}`}
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-signal px-4 text-sm font-medium text-signal-ink transition-colors hover:bg-signal-2"
          >
            {action.label} <ArrowRight className="size-4" />
          </Link>
          {action.secondary && (
            <Link to={action.secondary.to} className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-line-strong px-3.5 text-sm text-paper hover:border-paper-3">
              {action.secondary.label}
            </Link>
          )}
          {action.to && (
            <Link to={`/events/${e.slug}`} className="ml-auto text-sm text-paper-2 underline decoration-line-strong underline-offset-4 hover:text-paper">
              Full details
            </Link>
          )}
        </div>
        {action.note && <p className="mt-3 text-xs text-paper-3">{action.note}</p>}
        {e.isDemo && (
          <p className="mt-4">
            <DemoBadge />
          </p>
        )}
      </div>
    </section>
  );
}

function Item({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-paper-3">{label}</dt>
      <dd className="mt-0.5 truncate text-paper">{value}</dd>
      {detail && <dd className="truncate text-[11.5px] text-paper-3">{detail}</dd>}
    </div>
  );
}
