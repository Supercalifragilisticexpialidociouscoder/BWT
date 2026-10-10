import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Copy, Flag, ScanLine, Settings2, Ticket, XCircle } from 'lucide-react';
import { CategoryMark } from '../../components/CategoryMark';
import { useState } from 'react';
import type { EventDetailDTO } from '@campusflow/shared';
import { api, ApiError } from '../../lib/api';
import { feeLabel, formatLabel, relativeTime, useFormat } from '../../lib/format';
import { useInstitutionRequired } from '../../lib/institution';
import { EventPoster } from '../../components/EventPoster';
import { DemoBadge, LiveDot, StatusPill } from '../../components/ui/Status';
import { ButtonLink } from '../../components/ui/Button';
import { ErrorState, Skeleton } from '../../components/ui/Feedback';
import { NotFound } from '../../router';

export function useEventDetail(ref: string | undefined) {
  return useQuery({
    queryKey: ['event', ref],
    queryFn: () => api<EventDetailDTO>(`/events/${ref}`),
    enabled: Boolean(ref),
  });
}

export function EventPage() {
  const { slug } = useParams();
  const q = useEventDetail(slug);
  const fmt = useFormat();
  const inst = useInstitutionRequired();

  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFound title="Event not found" body="It may have been unpublished, or the link is mistyped." />;
    return (
      <main id="main" className="mx-auto max-w-3xl px-[var(--gutter)] py-20">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </main>
    );
  }
  if (!q.data) {
    return (
      <main id="main" className="mx-auto grid max-w-[1400px] gap-12 px-[var(--gutter)] py-12 lg:grid-cols-[5fr_7fr]" aria-busy>
        <Skeleton className="aspect-[3/4] w-full" />
        <div className="space-y-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    );
  }

  const e = q.data;
  const unit = e.mode === 'team' ? 'teams' : 'places';
  const paragraphs = e.description.split(/\n\s*\n/).filter(Boolean);
  const allowed = e.allowedDepartments.map((code) => inst.departments.find((d) => d.code === code)?.name ?? code);

  return (
    <main id="main" className="pb-28 lg:pb-10">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-[var(--gutter)] pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:pt-12">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Link to="/events" className="mb-5 inline-flex items-center gap-1.5 text-sm text-paper-3 hover:text-paper">
            <ArrowLeft className="size-4" /> All events
          </Link>
          <EventPoster event={e} size="lg" className="aspect-[4/3] w-full rounded-[var(--radius-md)] sm:aspect-[3/4]" />
          <div className="mt-4 flex items-center justify-between text-sm text-paper-3">
            <span>
              Organized by <span className="text-paper-2">{e.organization.name}</span>
            </span>
            <CopyLink />
          </div>
        </div>

        <article className="min-w-0">
          <p className="kicker flex flex-wrap items-center gap-2 text-paper-3">
            <CategoryMark slug={e.category} name={e.categoryName} withLabel />
            {e.isDemo && <DemoBadge />}
            {e.status !== 'published' && <StatusPill kind="event" value={e.status} />}
          </p>
          <h1 className="display-lg mt-3 text-balance">{e.title}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-paper-2">{e.summary}</p>
          <StateBanner event={e} />

          <dl className="mt-9 grid grid-cols-2 border-l border-t border-line sm:grid-cols-3">
            <Fact label="When" value={fmt.range(e.startsAt, e.endsAt)} wide />
            <Fact
              label="Where"
              value={e.venue ? `${e.venue.name}` : 'Venue to be announced'}
              detail={e.venue ? [e.venue.building, e.venue.roomCode].filter(Boolean).join(' · ') : undefined}
            />
            <Fact label="Format" value={formatLabel(e.mode, e.teamSize)} detail={e.mode === 'team' ? 'Create a team or join one with a code' : undefined} />
            <Fact label="Fee" value={feeLabel(e.fee, e.mode)} detail={e.fee.amount > 0 ? (e.mode === 'team' ? 'Paid by the team leader' : 'Verified by organizers') : 'No payment needed'} />
            <Fact
              label="Registration closes"
              value={fmt.dateTime(e.registrationDeadline)}
              detail={new Date(e.registrationDeadline) > new Date() ? relativeTime(e.registrationDeadline) : 'Closed'}
            />
            <Fact
              label="Capacity"
              value={e.capacity === null ? 'No limit' : `${e.remaining} of ${e.capacity} ${unit} left`}
              detail={e.requiresApproval ? 'Registrations are reviewed' : undefined}
            />
          </dl>

          <RegisterPanel event={e} />

          <div className="mt-14 space-y-12">
            {paragraphs.length > 0 && (
              <Section title="About">
                <div className="space-y-4 text-[15.5px] leading-[1.7] text-paper-2">
                  {paragraphs.map((p, i) => (
                    <p key={i} className="whitespace-pre-line">
                      {p}
                    </p>
                  ))}
                </div>
              </Section>
            )}
            {(e.eligibility || allowed.length > 0) && (
              <Section title="Who can take part">
                {e.eligibility && <p className="text-[15.5px] leading-[1.7] text-paper-2">{e.eligibility}</p>}
                {allowed.length > 0 && <p className="mt-3 text-sm text-paper-3">Open to: {allowed.join(', ')}</p>}
              </Section>
            )}
            {e.schedule.length > 0 && (
              <Section title="Schedule">
                <ol className="relative border-l border-line">
                  {e.schedule.map((s, i) => (
                    <li key={i} className="relative grid grid-cols-[92px_1fr] gap-4 pb-6 pl-6 last:pb-0">
                      <span aria-hidden className="absolute -left-[4.5px] top-1.5 size-2 rounded-full border border-paper-3 bg-ink-950" />
                      <span className="tnum pt-0.5 font-mono text-[13px] text-paper-2">
                        {fmt.time(s.startsAt)}–{fmt.time(s.endsAt)}
                      </span>
                      <span>
                        <span className="block text-paper">{s.title}</span>
                        {s.location && <span className="text-sm text-paper-3">{s.location}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}
            {e.rules.length > 0 && (
              <Section title="Rules">
                <ol className="space-y-3">
                  {e.rules.map((r, i) => (
                    <li key={i} className="grid grid-cols-[28px_1fr] gap-2 text-[15px] leading-relaxed text-paper-2">
                      <span className="tnum font-mono text-[13px] text-paper-3">{String(i + 1).padStart(2, '0')}</span>
                      {r}
                    </li>
                  ))}
                </ol>
              </Section>
            )}
            {e.fee.amount > 0 && e.paymentInstructions && (
              <Section title="Payment">
                <p className="text-[15px] leading-relaxed text-paper-2">{e.paymentInstructions}</p>
                <p className="mt-3 text-sm text-paper-3">
                  CAMPUSFLOW records the reference you submit; organizers verify it against their account. No money moves through this site.
                </p>
              </Section>
            )}
          </div>
        </article>
      </div>
    </main>
  );
}

function StateBanner({ event: e }: { event: EventDetailDTO }) {
  const fmt = useFormat();
  const now = Date.now();
  const live = new Date(e.startsAt).getTime() <= now && new Date(e.endsAt).getTime() > now && e.status !== 'cancelled';
  if (e.status === 'cancelled') {
    return (
      <p role="status" className="mt-6 flex items-center gap-2 border-l-2 border-bad pl-3 text-sm text-paper">
        <XCircle className="size-4 text-bad" aria-hidden /> This event has been cancelled. Registrations are closed and tickets will not be accepted.
      </p>
    );
  }
  if (live) {
    return (
      <p role="status" className="mt-6 flex items-center gap-2 border-l-2 border-signal pl-3 text-sm text-paper">
        <LiveDot /> Happening now — until {fmt.time(e.endsAt)}.
      </p>
    );
  }
  if (e.status === 'completed' || new Date(e.endsAt).getTime() <= now) {
    return (
      <p role="status" className="mt-6 flex items-center gap-2 border-l-2 border-line-strong pl-3 text-sm text-paper-2">
        <Flag className="size-4 text-paper-3" aria-hidden /> This event ended on {fmt.date(e.endsAt)}.
      </p>
    );
  }
  return null;
}

function Fact({ label, value, detail, wide }: { label: string; value: ReactNode; detail?: ReactNode; wide?: boolean }) {
  return (
    <div className={`border-b border-r border-line px-4 py-4 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <dt className="kicker text-paper-3">{label}</dt>
      <dd className="mt-1.5 text-[15px] text-paper">{value}</dd>
      {detail && <dd className="mt-0.5 text-xs text-paper-3">{detail}</dd>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="kicker mb-4 border-b border-line pb-2 text-paper-3">{title}</h2>
      {children}
    </section>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
      className="inline-flex items-center gap-1.5 hover:text-paper"
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
}

function RegisterPanel({ event: e }: { event: EventDetailDTO }) {
  const fmt = useFormat();
  const state = e.registrationState;
  let primary: ReactNode;
  let note: string | null = null;
  if (e.viewer.registrationId) {
    primary = (
      <ButtonLink to={`/me/registrations/${e.viewer.registrationId}`} variant="primary" size="lg" icon={<Ticket className="size-4" />}>
        View your registration
      </ButtonLink>
    );
    note = 'You’re registered. Your ticket, team and payment status are on your registration page.';
  } else if (state === 'open') {
    primary = (
      <ButtonLink to={`/events/${e.slug}/register`} variant="primary" size="lg" iconRight={<ArrowRight className="size-4" />}>
        {e.mode === 'team' ? 'Register a team' : 'Register'}
      </ButtonLink>
    );
    const left = new Date(e.registrationDeadline).getTime() - Date.now();
    const soon = left < 48 * 3600_000 ? `Registration closes ${relativeTime(e.registrationDeadline)}. ` : '';
    note = soon + (e.mode === 'team' ? `The person who registers becomes team leader and gets a code to share with ${e.teamSize.max - 1 > 1 ? `up to ${e.teamSize.max - 1} teammates` : 'a teammate'}.` : '') || null;
  } else {
    const reasons: Record<string, string> = {
      not_yet_open: e.registrationOpensAt ? `Registration opens ${fmt.dateTime(e.registrationOpensAt)}.` : 'Registration has not opened yet.',
      closed: 'Registration has closed.',
      full: `All ${e.capacity} ${e.mode === 'team' ? 'team slots' : 'places'} are taken.`,
      cancelled: 'This event has been cancelled.',
      ended: 'This event has ended.',
      draft: 'This event is a draft and not yet visible to participants.',
    };
    primary = (
      <span className="inline-flex h-12 items-center rounded-[var(--radius-sm)] border border-line px-5 text-[15px] text-paper-3" aria-disabled>
        Registration unavailable
      </span>
    );
    note = reasons[state] ?? null;
  }

  return (
    <div className="mt-8 flex flex-col gap-4 border border-line bg-ink-900 p-5 sm:p-6 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:mt-0 max-lg:border-x-0 max-lg:border-b-0 max-lg:bg-ink-900/95 max-lg:p-4 max-lg:backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-3">
        {primary}
        {e.mode === 'team' && !e.viewer.registrationId && (state === 'open' || state === 'full') && (
          <ButtonLink to="/join" variant="secondary" size="lg">
            Join with a team code
          </ButtonLink>
        )}
        <span className="max-lg:hidden">
          <StatusPill kind="window" value={state} size="md" />
        </span>
      </div>
      {note && <p className="text-sm text-paper-2 max-lg:text-xs">{note}</p>}
      {(e.viewer.canManage || e.viewer.canCheckIn) && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4 max-lg:hidden">
          {e.viewer.canManage && (
            <ButtonLink to={`/workspace/events/${e.id}`} size="sm" icon={<Settings2 className="size-3.5" />}>
              Manage event
            </ButtonLink>
          )}
          {e.viewer.canCheckIn && (
            <ButtonLink to={`/live/${e.id}`} size="sm" icon={<ScanLine className="size-3.5" />}>
              Live check-in
            </ButtonLink>
          )}
        </div>
      )}
    </div>
  );
}
