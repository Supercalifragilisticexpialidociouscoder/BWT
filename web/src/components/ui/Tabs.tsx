import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';

/** WAI-ARIA tabs (manual activation with arrow-key focus movement). */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode; count?: number }[];
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next]!.value);
  };
  return (
    <div role="tablist" aria-label={label} className={clsx('scrollbar-none -mb-px flex gap-1 overflow-x-auto border-b border-line', className)}>
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(item.value)}
            className={clsx(
              'relative whitespace-nowrap px-3 pb-2.5 pt-1.5 text-sm transition-colors duration-[var(--dur-fast)]',
              selected ? 'text-paper' : 'text-paper-3 hover:text-paper-2',
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="tnum ml-1.5 text-xs text-paper-3">{item.count}</span>}
            <span
              aria-hidden
              className={clsx('absolute inset-x-2 -bottom-px h-0.5 origin-left bg-signal transition-transform duration-[var(--dur-base)] ease-[var(--ease-out-expo)]', selected ? 'scale-x-100' : 'scale-x-0')}
            />
          </button>
        );
      })}
    </div>
  );
}
