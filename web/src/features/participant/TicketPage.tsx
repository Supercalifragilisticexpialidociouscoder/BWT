import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ArrowLeft, DoorOpen, Sun } from 'lucide-react';
import clsx from 'clsx';
import type { TicketDTO } from '@campusflow/shared';
import { api, ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { ErrorState } from '../../components/ui/Feedback';
import { Wordmark } from '../../components/Wordmark';
import { NotFound } from '../../router';

/** Full-screen entry ticket. The QR encodes only an opaque signed token. */
export function TicketPage() {
  const { id } = useParams();
  const fmt = useFormat();
  const q = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api<TicketDTO>(`/tickets/${id}`),
    // Poll gently so the ticket flips to "checked in" at the gate without a manual refresh.
    refetchInterval: (query) => (query.state.data?.status === 'active' ? 8000 : false),
  });
  const [svg, setSvg] = useState<string | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!q.data) return;
    QRCode.toString(q.data.qrPayload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0c0b0a', light: '#00000000' } })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [q.data]);

  // Keep the screen awake while the ticket is shown (where supported).
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => (wake.current = l)).catch(() => undefined);
    return () => void wake.current?.release().catch(() => undefined);
  }, []);

  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFound title="Ticket not found" body="Tickets can only be opened by the person they were issued to." />;
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </main>
    );
  }
  const t = q.data;
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center bg-ink-950 px-4 pb-10 pt-5">
      <div className="flex w-full max-w-sm items-center justify-between">
        <Link to={t ? `/me/registrations/${t.registration.id}` : '/me'} className="inline-flex items-center gap-1.5 text-sm text-paper-3 hover:text-paper">
          <ArrowLeft className="size-4" /> Back
        </Link>
        <Wordmark compact />
      </div>

      <article aria-label="Entry ticket" className="mt-6 w-full max-w-sm overflow-hidden rounded-[18px] shadow-[0_40px_90px_-30px_rgb(0_0_0/0.9)]">
        <div className="bg-ink-850 px-6 pb-6 pt-6">
          <p className="kicker text-paper-3">Entry ticket</p>
          <h1 className="display-sm mt-2 !text-2xl">{t?.event.title ?? ' '}</h1>
          {t && (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-paper-3">When</dt>
                <dd className="text-paper">{fmt.dateTime(t.event.startsAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-paper-3">Where</dt>
                <dd className="text-paper">{t.event.venue ? t.event.venue.name : 'Venue TBA'}</dd>
              </div>
            </dl>
          )}
        </div>
        {/* Perforation */}
        <div aria-hidden className="relative h-0 border-t-2 border-dashed border-ink-700 bg-paper">
          <span className="absolute -left-3 -top-3 size-6 rounded-full bg-ink-950" />
          <span className="absolute -right-3 -top-3 size-6 rounded-full bg-ink-950" />
        </div>
        <div className="relative bg-paper px-6 pb-7 pt-6 text-ink-950">
          <div className={clsx('mx-auto aspect-square w-full max-w-[260px] transition-opacity', t?.status !== 'active' && 'opacity-15')}>
            {svg ? <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label="Ticket QR code" /> : <div className="size-full animate-pulse rounded bg-ink-950/10" />}
          </div>
          {t && t.status !== 'active' && (
            <div className="absolute inset-x-6 top-1/3 flex flex-col items-center text-center">
              {t.status === 'checked_in' ? (
                <>
                  <DoorOpen className="size-10 text-ink-950" aria-hidden />
                  <p className="mt-2 text-xl font-semibold">Checked in</p>
                  {t.checkedInAt && <p className="text-sm text-ink-700">{fmt.dateTime(t.checkedInAt)}</p>}
                </>
              ) : (
                <p className="text-xl font-semibold">Ticket void</p>
              )}
            </div>
          )}
          <p className="mt-5 text-center font-mono text-2xl font-semibold tracking-[0.3em]">{t?.shortCode ?? '······'}</p>
          <p className="text-center text-[11px] uppercase tracking-[0.14em] text-ink-700">Manual entry code</p>
          <div className="mt-5 flex justify-between border-t border-ink-950/15 pt-4 text-sm">
            <div>
              <p className="text-[11px] text-ink-700">Name</p>
              <p className="font-medium">{t?.participant.name}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-ink-700">{t?.team ? 'Team' : 'Registration'}</p>
              <p className="font-medium">{t?.team ? t.team.name : t?.registration.code}</p>
            </div>
          </div>
        </div>
      </article>

      <p className="mt-6 flex max-w-sm items-center gap-2 text-center text-xs text-paper-3">
        <Sun className="size-4 shrink-0" aria-hidden />
        Turn your screen brightness up at the entrance. Carry your college ID as well.
      </p>
    </main>
  );
}
