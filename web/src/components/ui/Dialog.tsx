import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './Button';
import { Field, FormAlert, Textarea } from './Form';
import { errorMessage } from '../../lib/api';

/**
 * Native <dialog>: focus is trapped, Escape closes, and the rest of the page is inert.
 * `variant="drawer"` slides in from the right (bottom sheet on small screens).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'modal',
  size = 'md',
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: 'modal' | 'drawer';
  size?: 'sm' | 'md' | 'lg';
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onClick={(e) => {
        if (dismissable && e.target === ref.current) onClose();
      }}
      className={clsx(
        'm-0 border-0 bg-transparent p-0 text-paper backdrop:transition-opacity',
        variant === 'modal' && 'fixed inset-0 m-auto max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)]',
        variant === 'modal' && { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }[size],
        variant === 'drawer' &&
          'fixed inset-y-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-[min(640px,100vw)] max-sm:top-auto max-sm:h-[92dvh] max-sm:max-w-none',
      )}
      aria-labelledby="dialog-title"
    >
      {open && (
        <div
          className={clsx(
            'flex max-h-[inherit] flex-col border border-line bg-ink-900 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]',
            variant === 'modal' ? 'animate-rise rounded-[var(--radius-lg)]' : 'h-full animate-[drawer-in_360ms_var(--ease-out-expo)_both] max-sm:rounded-t-[var(--radius-lg)] sm:border-y-0 sm:border-r-0',
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id="dialog-title" className="display-sm text-paper">
                {title}
              </h2>
              {description && <div className="mt-1 text-sm text-paper-2">{description}</div>}
            </div>
            {dismissable && (
              <button type="button" onClick={onClose} className="-mr-1 rounded p-1.5 text-paper-3 hover:bg-ink-800 hover:text-paper" aria-label="Close">
                <X className="size-4" />
              </button>
            )}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5 sm:px-6">{footer}</footer>}
        </div>
      )}
      <style>{`@keyframes drawer-in { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }
        @media (max-width: 639px) { @keyframes drawer-in { from { transform: translateY(32px); opacity: 0 } to { transform: none; opacity: 1 } } }`}</style>
    </dialog>
  );
}

/** Confirmation for destructive or irreversible actions, with an optional required reason. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  reason,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  reason?: { label: string; placeholder?: string; minLength?: number; required?: boolean };
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
    }
  }, [open]);
  const tooShort = Boolean(reason?.required && text.trim().length < (reason.minLength ?? 3));
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep as is
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            disabled={tooShort}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(text.trim());
                onClose();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-paper-2">
        <div>{description}</div>
        {reason && (
          <Field label={reason.label} required={reason.required} hint={reason.required ? `At least ${reason.minLength ?? 3} characters; recorded in the audit log.` : undefined}>
            {({ id, describedBy }) => (
              <Textarea id={id} aria-describedby={describedBy} value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} rows={3} />
            )}
          </Field>
        )}
        {error && <FormAlert>{error}</FormAlert>}
      </div>
    </Dialog>
  );
}
