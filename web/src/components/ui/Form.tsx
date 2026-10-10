import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { TriangleAlert } from 'lucide-react';
import clsx from 'clsx';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label + control + hint/error, wired with aria-describedby and aria-invalid. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-paper-2">
        {label}
        {required && <span className="ml-0.5 text-paper-3" aria-hidden>*</span>}
      </label>
      {children({ id, describedBy: [hintId, errId].filter(Boolean).join(' ') || undefined, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-paper-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="flex items-start gap-1.5 text-xs text-bad">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx('field', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx('field min-h-24 resize-y', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={clsx(
        'field appearance-none bg-[length:12px] bg-[right_0.7rem_center] bg-no-repeat pr-8',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4.5 6 8l4-3.5' stroke='%23bdb6aa' stroke-width='1.5' fill='none'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Checkbox({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={clsx('flex items-start gap-3', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 appearance-none rounded-[3px] border border-line-strong bg-ink-800 transition-colors checked:border-signal checked:bg-signal checked:bg-[url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5 6.5 11.5 12.5 4.5' stroke='%2310130a' stroke-width='2' fill='none'/%3E%3C/svg%3E&quot;)]"
        {...rest}
      />
      <label htmlFor={id} className="text-sm leading-5 text-paper">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-paper-3">{hint}</span>}
      </label>
    </div>
  );
}

export function FormAlert({ children, tone = 'bad' }: { children: ReactNode; tone?: 'bad' | 'warn' | 'info' | 'ok' }) {
  if (!children) return null;
  const tones = {
    bad: 'border-bad/40 bg-bad/8 text-paper',
    warn: 'border-warn/40 bg-warn/8 text-paper',
    info: 'border-info/40 bg-info/8 text-paper',
    ok: 'border-ok/40 bg-ok/8 text-paper',
  } as const;
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={clsx('flex gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-sm', tones[tone])}>
      <TriangleAlert className={clsx('mt-0.5 size-4 shrink-0', { bad: 'text-bad', warn: 'text-warn', info: 'text-info', ok: 'text-ok' }[tone])} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
