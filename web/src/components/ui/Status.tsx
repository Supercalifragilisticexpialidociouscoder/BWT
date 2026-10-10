import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  BadgeCheck,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  DoorOpen,
  Flag,
  Globe,
  Minus,
  PencilLine,
  Ticket,
  Undo2,
  Lock,
  Hourglass,
  Users,
  FileClock,
  FileWarning,
  FilePen,
  ShieldCheck,
  Eye,
} from 'lucide-react';
import clsx from 'clsx';
import {
  LABELS,
  type DocumentStatus,
  type EventStatus,
  type ParticipationStatus,
  type PaymentStatus,
  type RegistrationStatus,
  type RegistrationWindowState,
  type TicketStatus,
} from '@campusflow/shared';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'signal';

const toneClass: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  muted: 'text-paper-3',
  signal: 'text-signal',
};

interface Def {
  tone: Tone;
  icon: LucideIcon;
  label: string;
}

const registration: Record<RegistrationStatus, Def> = {
  incomplete: { tone: 'info', icon: CircleDashed, label: LABELS.registrationStatus.incomplete },
  pending: { tone: 'warn', icon: Clock, label: LABELS.registrationStatus.pending },
  confirmed: { tone: 'ok', icon: CircleCheck, label: LABELS.registrationStatus.confirmed },
  cancelled: { tone: 'muted', icon: CircleX, label: LABELS.registrationStatus.cancelled },
  rejected: { tone: 'bad', icon: Ban, label: LABELS.registrationStatus.rejected },
};
const payment: Record<PaymentStatus, Def> = {
  not_required: { tone: 'muted', icon: Minus, label: 'No fee' },
  pending: { tone: 'warn', icon: Clock, label: LABELS.paymentStatus.pending },
  verified: { tone: 'ok', icon: BadgeCheck, label: LABELS.paymentStatus.verified },
  rejected: { tone: 'bad', icon: CircleX, label: LABELS.paymentStatus.rejected },
  refunded: { tone: 'info', icon: Undo2, label: LABELS.paymentStatus.refunded },
};
const ticket: Record<TicketStatus, Def> = {
  active: { tone: 'ok', icon: Ticket, label: LABELS.ticketStatus.active },
  checked_in: { tone: 'info', icon: DoorOpen, label: LABELS.ticketStatus.checked_in },
  void: { tone: 'muted', icon: Ban, label: LABELS.ticketStatus.void },
};
const event: Record<EventStatus, Def> = {
  draft: { tone: 'muted', icon: PencilLine, label: 'Draft' },
  published: { tone: 'ok', icon: Globe, label: 'Published' },
  cancelled: { tone: 'bad', icon: CircleX, label: 'Cancelled' },
  completed: { tone: 'info', icon: Flag, label: 'Completed' },
};
const windowState: Record<RegistrationWindowState, Def> = {
  open: { tone: 'signal', icon: CircleCheck, label: 'Registration open' },
  not_yet_open: { tone: 'info', icon: Hourglass, label: 'Opens soon' },
  closed: { tone: 'muted', icon: Lock, label: 'Registration closed' },
  full: { tone: 'warn', icon: Users, label: 'Full' },
  cancelled: { tone: 'bad', icon: CircleX, label: 'Cancelled' },
  ended: { tone: 'muted', icon: Flag, label: 'Ended' },
  draft: { tone: 'muted', icon: PencilLine, label: 'Draft' },
};

const participation: Record<ParticipationStatus, Def> = {
  not_required: { tone: 'muted', icon: Minus, label: LABELS.participationStatus.not_required },
  not_submitted: { tone: 'warn', icon: FileWarning, label: LABELS.participationStatus.not_submitted },
  submitted: { tone: 'info', icon: FileClock, label: LABELS.participationStatus.submitted },
  under_review: { tone: 'info', icon: Eye, label: LABELS.participationStatus.under_review },
  changes_requested: { tone: 'warn', icon: FilePen, label: LABELS.participationStatus.changes_requested },
  approved: { tone: 'ok', icon: ShieldCheck, label: LABELS.participationStatus.approved },
  rejected: { tone: 'bad', icon: Ban, label: LABELS.participationStatus.rejected },
};
const document: Record<DocumentStatus | 'missing', Def> = {
  missing: { tone: 'muted', icon: CircleDashed, label: 'Not uploaded' },
  submitted: { tone: 'info', icon: Clock, label: LABELS.documentStatus.submitted },
  approved: { tone: 'ok', icon: CircleCheck, label: LABELS.documentStatus.approved },
  changes_requested: { tone: 'warn', icon: FilePen, label: LABELS.documentStatus.changes_requested },
  rejected: { tone: 'bad', icon: CircleX, label: LABELS.documentStatus.rejected },
};

const maps = { registration, payment, ticket, event, window: windowState, participation, document };

export function StatusPill<K extends keyof typeof maps>({
  kind,
  value,
  label,
  className,
  size = 'sm',
}: {
  kind: K;
  value: keyof (typeof maps)[K];
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const def = (maps[kind] as Record<string, Def>)[value as string];
  if (!def) return null;
  const Icon = def.icon;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        size === 'sm' ? 'text-[12px]' : 'text-[13px]',
        className,
      )}
    >
      <Icon className={clsx(size === 'sm' ? 'size-3.5' : 'size-4', toneClass[def.tone])} aria-hidden strokeWidth={2} />
      <span className="text-paper">{label ?? def.label}</span>
    </span>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={clsx('kicker inline-flex items-center gap-1 rounded-[3px] border border-line-strong px-1.5 py-px !text-[10px] text-paper-3', className)}
      title="Sample record created by the demonstration seed — not an official event"
    >
      Demo data
    </span>
  );
}

export function LiveDot({ className, tone = 'signal' }: { className?: string; tone?: Tone }) {
  return (
    <span className={clsx('relative inline-flex size-2', className)} aria-hidden>
      <span className={clsx('status-dot absolute inset-0 rounded-full animate-pulse-dot', tone === 'signal' ? 'bg-signal' : tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : tone === 'bad' ? 'bg-bad' : 'bg-paper-3')} />
    </span>
  );
}
