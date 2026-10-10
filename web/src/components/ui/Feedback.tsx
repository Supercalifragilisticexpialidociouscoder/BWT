import type { ReactNode } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { ApiError } from '../../lib/api';
import { Button } from './Button';

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-start gap-3 border border-dashed border-line-strong px-6 py-10 sm:px-10', 'rounded-[var(--radius-md)]', className)}>
      {icon && <div className="text-paper-3">{icon}</div>}
      <h3 className="display-sm text-paper">{title}</h3>
      {body && <div className="max-w-prose text-sm text-paper-2">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded-[var(--radius-sm)] bg-ink-800', className)} />;
}

export function LoadingBlock({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={clsx('h-12', i % 3 === 2 && 'w-2/3')} />
      ))}
    </div>
  );
}

/** Distinguishes "can't reach the server" from an actual error the server reported. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const network = error instanceof ApiError && error.isNetwork;
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div role="alert" className={clsx('flex flex-col items-start gap-3 rounded-[var(--radius-md)] border border-bad/30 bg-bad/5 px-6 py-6', className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-paper">
        {network ? <WifiOff className="size-4 text-bad" aria-hidden /> : null}
        {network ? 'Offline or server unreachable' : 'This couldn’t be loaded'}
      </div>
      <p className="text-sm text-paper-2">{message}</p>
      {onRetry && (
        <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  description,
  actions,
  className,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx('flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {kicker && <p className="kicker mb-2 text-paper-3">{kicker}</p>}
        <h1 className="display-md text-paper">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-sm text-paper-2">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Stat tile: label, value (proportional figures at display size), optional detail. */
export function Stat({ label, value, detail, emphasis, className }: { label: string; value: ReactNode; detail?: ReactNode; emphasis?: boolean; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1.5 py-1', className)}>
      <dt className="text-[12px] text-paper-3">{label}</dt>
      <dd className={clsx('font-semibold tracking-tight text-paper', emphasis ? 'text-4xl' : 'text-2xl')}>{value}</dd>
      {detail && <dd className="text-xs text-paper-2">{detail}</dd>}
    </div>
  );
}
