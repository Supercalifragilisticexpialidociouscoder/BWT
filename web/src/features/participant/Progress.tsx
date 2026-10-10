import { Check } from 'lucide-react';
import clsx from 'clsx';
import type { RegistrationDTO } from '@campusflow/shared';

interface Step {
  key: string;
  label: string;
  state: 'done' | 'current' | 'todo' | 'blocked';
}

/** Lifecycle of a registration, derived entirely from the registration record. */
export function lifecycle(r: RegistrationDTO): Step[] {
  const closed = r.status === 'cancelled' || r.status === 'rejected';
  const steps: Step[] = [{ key: 'registered', label: 'Registered', state: 'done' }];
  if (r.kind === 'team') {
    const complete = (r.team?.memberCount ?? 0) >= r.event.teamSize.min;
    steps.push({ key: 'team', label: `Team ${r.team?.memberCount ?? 0}/${r.event.teamSize.max}`, state: complete ? 'done' : 'current' });
  }
  if (r.payment.required) {
    const s = r.payment.status;
    steps.push({ key: 'payment', label: s === 'verified' ? 'Payment verified' : s === 'rejected' ? 'Payment rejected' : r.payment.reference ? 'Payment in review' : 'Payment due', state: s === 'verified' ? 'done' : s === 'rejected' ? 'blocked' : 'current' });
  }
  if (r.approval.required) {
    const decided = r.approval.decidedAt !== null;
    steps.push({ key: 'approval', label: decided ? (r.status === 'rejected' ? 'Not approved' : 'Approved') : 'Awaiting approval', state: decided ? (r.status === 'rejected' ? 'blocked' : 'done') : 'current' });
  }
  const confirmed = r.status === 'confirmed';
  steps.push({ key: 'ticket', label: 'Ticket issued', state: confirmed ? 'done' : 'todo' });
  const attended = r.participants.some((p) => p.ticket?.status === 'checked_in');
  steps.push({ key: 'checkin', label: 'Checked in', state: attended ? 'done' : confirmed ? 'current' : 'todo' });

  // Only the first unfinished step is "current"; later ones wait.
  let seenCurrent = false;
  for (const s of steps) {
    if (closed && s.state !== 'done') s.state = 'blocked';
    else if (s.state === 'current') {
      if (seenCurrent) s.state = 'todo';
      seenCurrent = true;
    }
  }
  return steps;
}

export function RegistrationProgress({ registration, compact }: { registration: RegistrationDTO; compact?: boolean }) {
  const steps = lifecycle(registration);
  return (
    <ol className={clsx('flex w-full', compact ? 'gap-1' : 'gap-2')} aria-label="Registration progress">
      {steps.map((s) => (
        <li key={s.key} className="min-w-0 flex-1" aria-current={s.state === 'current' ? 'step' : undefined}>
          <div
            className={clsx(
              'h-[3px] rounded-full',
              s.state === 'done' && 'bg-signal',
              s.state === 'current' && 'bg-[linear-gradient(90deg,var(--color-signal)_0%,var(--color-signal)_40%,var(--color-ink-700)_40%)]',
              s.state === 'todo' && 'bg-ink-700',
              s.state === 'blocked' && 'bg-bad/60',
            )}
          />
          {!compact && (
            <p className={clsx('mt-2 flex items-center gap-1 truncate text-[11.5px]', s.state === 'done' ? 'text-paper-2' : s.state === 'current' ? 'text-paper' : s.state === 'blocked' ? 'text-bad' : 'text-paper-3')}>
              {s.state === 'done' && <Check className="size-3 shrink-0 text-signal" aria-hidden />}
              <span className="truncate">{s.label}</span>
              <span className="sr-only">
                {' '}
                ({s.state === 'done' ? 'done' : s.state === 'current' ? 'in progress' : s.state === 'blocked' ? 'blocked' : 'not yet'})
              </span>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
