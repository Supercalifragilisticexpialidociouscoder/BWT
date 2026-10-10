import clsx from 'clsx';

/** Brand mark: a vertical stem and a curve that "flows" into the signal dot. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx('size-6', className)} aria-hidden>
      <path d="M9 22.5V9.5" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M14 22.5c3.5 0 7-2.4 7-7.6" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="21" cy="10.6" r="3.2" fill="var(--color-signal)" />
    </svg>
  );
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 text-paper', className)}>
      <Mark />
      {!compact && <span className="font-mono text-[13px] font-semibold tracking-[0.22em]">CAMPUSFLOW</span>}
    </span>
  );
}
