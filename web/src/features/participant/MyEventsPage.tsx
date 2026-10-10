import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, QrCode } from 'lucide-react';
import type { RegistrationDTO, TicketDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useFormat } from '../../lib/format';
import { EventPoster } from '../../components/EventPoster';
import { StatusPill } from '../../components/ui/Status';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { RegistrationProgress } from './Progress';

export function useMyRegistrations() {
  return useQuery({ queryKey: ['me', 'registrations'], queryFn: () => api<RegistrationDTO[]>('/me/registrations') });
}
export function useMyTickets() {
  return useQuery({ queryKey: ['me', 'tickets'], queryFn: () => api<TicketDTO[]>('/me/tickets') });
}

/** The single most useful next step for a registration, if any. */
export function nextAction(r: RegistrationDTO): { label: string; detail: string } | null {
  if (r.status === 'cancelled' || r.status === 'rejected') return null;
  if (r.kind === 'team' && r.team && r.team.memberCount < r.event.teamSize.min) {
    return { label: 'Invite teammates', detail: `Share code ${r.team.code ? `${r.team.code.slice(0, 4)}-${r.team.code.slice(4)}` : ''} — needs ${r.event.teamSize.min - r.team.memberCount} more` };
  }
  if (r.payment.required && (r.payment.status === 'pending' || r.payment.status === 'rejected') && !r.payment.reference && r.viewer.isLeader) {
    return { label: 'Submit payment reference', detail: 'Organizers verify it before confirming' };
  }
  if (r.payment.status === 'rejected' && r.viewer.isLeader) return { label: 'Resubmit payment', detail: r.payment.note ?? 'The reference was rejected' };
  return null;
}

export function MyEventsPage() {
  const { user } = useSession();
  const regs = useMyRegistrations();
  const tickets = useMyTickets();
  const fmt = useFormat();
  const now = Date.now();
  const upcomingTickets = (tickets.data ?? []).filter((t) => new Date(t.event.endsAt).getTime() > now);
  const active = (regs.data ?? []).filter((r) => r.status !== 'cancelled' && r.status !== 'rejected' && new Date(r.event.endsAt).getTime() > now);
  const past = (regs.data ?? []).filter((r) => !active.includes(r));
  const attention = active.flatMap((r) => {
    const action = nextAction(r);
    return action ? [{ r, action }] : [];
  });

  return (
    <main id="main" className="mx-auto max-w-[1200px] px-[var(--gutter)] py-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="kicker text-paper-3">{user?.name}</p>
          <h1 className="display-lg mt-2">Your events</h1>
        </div>
        <div className="flex gap-2">
          <ButtonLink to="/me/profile" size="sm">
            Profile
          </ButtonLink>
          <ButtonLink to="/join" size="sm">
            Join a team
          </ButtonLink>
        </div>
      </header>

      {attention.length > 0 && (
        <section className="mt-10" aria-labelledby="todo-h">
          <h2 id="todo-h" className="kicker mb-3 text-warn">
            Needs you · {attention.length}
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {attention.map(({ r, action }) => (
              <li key={r.id}>
                <Link to={`/me/registrations/${r.id}`} className="group flex flex-wrap items-center justify-between gap-3 px-1 py-3 hover:bg-ink-900">
                  <span className="min-w-0">
                    <span className="block text-paper">{action.label}</span>
                    <span className="block truncate text-xs text-paper-3">
                      {r.event.title} · {action.detail}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-paper-3 transition-transform group-hover:translate-x-0.5 group-hover:text-signal" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upcomingTickets.length > 0 && (
        <section className="mt-10" aria-labelledby="tickets-h">
          <h2 id="tickets-h" className="kicker mb-4 text-paper-3">
            Tickets
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingTickets.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/me/tickets/${t.id}`}
                  className="group flex items-center gap-4 rounded-[var(--radius-md)] border border-line bg-ink-900 p-4 transition-colors hover:border-signal/50"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-paper text-ink-950">
                    <QrCode className="size-7" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-paper">{t.event.title}</span>
                    <span className="block text-xs text-paper-3">
                      {fmt.dateTime(t.event.startsAt)} · <span className="font-mono">{t.shortCode}</span>
                    </span>
                  </span>
                  <StatusPill kind="ticket" value={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12" aria-labelledby="regs-h">
        <h2 id="regs-h" className="kicker mb-4 text-paper-3">
          Registrations
        </h2>
        {regs.isError ? (
          <ErrorState error={regs.error} onRetry={() => regs.refetch()} />
        ) : regs.isPending ? (
          <LoadingBlock rows={3} />
        ) : active.length === 0 ? (
          <EmptyState
            title="Nothing coming up yet"
            body="When you register for an event or join a team, it shows up here with its ticket and status."
            action={
              <ButtonLink to="/events" variant="primary">
                Browse events
              </ButtonLink>
            }
          />
        ) : (
          <ul className="space-y-3">
            {active.map((r) => (
              <RegistrationCard key={r.id} r={r} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-12" aria-labelledby="past-h">
          <h2 id="past-h" className="kicker mb-4 text-paper-3">
            Past & closed
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {past.map((r) => (
              <li key={r.id}>
                <Link to={`/me/registrations/${r.id}`} className="flex items-center justify-between gap-4 px-1 py-3 text-sm hover:bg-ink-900">
                  <span className="min-w-0 truncate text-paper-2">
                    {r.event.title} <span className="text-paper-3">· {fmt.shortDate(r.event.startsAt)}</span>
                  </span>
                  <StatusPill kind="registration" value={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function RegistrationCard({ r }: { r: RegistrationDTO }) {
  const fmt = useFormat();
  const action = nextAction(r);
  return (
    <li className="group relative grid grid-cols-[72px_1fr] gap-5 rounded-[var(--radius-md)] border border-line bg-ink-900 p-4 transition-colors hover:border-line-strong sm:grid-cols-[88px_1fr_auto] sm:p-5">
      <EventPoster event={r.event} size="sm" showCategory={false} className="aspect-[3/4] w-[72px] rounded-[var(--radius-xs)] sm:w-[88px]" />
      <div className="min-w-0">
        <p className="kicker text-paper-3">
          {r.code} · {r.kind === 'team' ? `Team ${r.team?.name ?? ''}` : 'Individual'}
        </p>
        <h3 className="display-sm mt-1">
          <Link to={`/me/registrations/${r.id}`} className="after:absolute after:inset-0 after:content-['']">
            {r.event.title}
          </Link>
        </h3>
        <p className="mt-1 text-sm text-paper-2">{fmt.range(r.event.startsAt, r.event.endsAt)}</p>
        <div className="mt-4 max-w-xl">
          <RegistrationProgress registration={r} />
        </div>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start">
        <StatusPill kind="registration" value={r.status} size="md" />
        {action && (
          <span className="relative z-10 inline-flex items-center gap-1.5 text-right text-sm text-signal">
            {action.label} <ArrowRight className="size-3.5" />
          </span>
        )}
      </div>
    </li>
  );
}
