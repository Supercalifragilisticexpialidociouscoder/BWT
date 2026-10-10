import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';

type Tone = 'ok' | 'bad' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.tone === 'bad' ? 8000 : 4500);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
        {toasts.map((t) => {
          const Icon = t.tone === 'ok' ? CircleCheck : t.tone === 'bad' ? TriangleAlert : Info;
          return (
            <div
              key={t.id}
              role={t.tone === 'bad' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-[var(--radius-md)] border border-line-strong bg-ink-850 px-4 py-3 shadow-[0_20px_50px_-15px_rgb(0_0_0/0.8)]"
            >
              <Icon className={clsx('mt-0.5 size-4 shrink-0', { ok: 'text-ok', bad: 'text-bad', info: 'text-info' }[t.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-paper">{t.title}</p>
                {t.body && <p className="mt-0.5 text-[13px] text-paper-2">{t.body}</p>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="text-paper-3 hover:text-paper" aria-label="Dismiss notification">
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
