import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Camera,
  CameraOff,
  CircleCheck,
  Clock,
  Keyboard,
  RefreshCw,
  Search,
  ShieldX,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import clsx from 'clsx';
import type { CheckInResultDTO, EventDetailDTO, LiveStatsDTO, TicketStatus } from '@campusflow/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useEventChannel } from '../../lib/realtime';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { StatusPill } from '../../components/ui/Status';
import { useQrScanner } from './useQrScanner';

type Shown = { kind: 'result'; result: CheckInResultDTO; retry?: undefined } | { kind: 'unavailable'; message: string; retry: () => void };

interface LookupRow {
  ticketId: string;
  shortCode: string;
  status: TicketStatus;
  checkedInAt: string | null;
  participant: { name: string; rollNumber: string | null; department: string | null };
  registration: { code: string; status: string; statusReason: string };
  team: string | null;
}

async function submitCheckIn(eventId: string, body: { token?: string; ticketId?: string }) {
  // Definitive answers (invalid, duplicate, wrong event, not eligible) arrive as 4xx with a body.
  return api<CheckInResultDTO>(`/events/${eventId}/checkins`, { method: 'POST', body, acceptStatuses: [404, 409, 422] });
}

function buzz(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

export function ScanPage() {
  const { eventId } = useParams();
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => api<EventDetailDTO>(`/events/${eventId}`) });
  if (event.isError) return <div className="p-6"><ErrorState error={event.error} onRetry={() => event.refetch()} /></div>;
  if (!event.data) return <div className="p-6"><LoadingBlock /></div>;
  if (!event.data.viewer.canCheckIn) return <div className="p-6"><ErrorState error={new Error('You are not on the check-in team for this event.')} /></div>;
  return <Scanner event={event.data} />;
}

function Scanner({ event }: { event: EventDetailDTO }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [shown, setShown] = useState<Shown | null>(null);
  const [session, setSession] = useState({ scans: 0, admitted: 0 });
  const [history, setHistory] = useState<{ id: number; outcome: CheckInResultDTO['outcome'] | 'unavailable'; name: string; at: number }[]>([]);
  const remember = (outcome: CheckInResultDTO['outcome'] | 'unavailable', name: string) =>
    setHistory((h) => [{ id: Date.now() + Math.random(), outcome, name, at: Date.now() }, ...h].slice(0, 6));
  const autoClose = useRef<number | null>(null);

  const stats = useQuery({ queryKey: ['live', event.id], queryFn: () => api<LiveStatsDTO>(`/events/${event.id}/live`), refetchInterval: 30_000 });
  const channel = useEventChannel(event.id, {
    onUpdate: () => qc.invalidateQueries({ queryKey: ['live', event.id] }),
    onResync: () => qc.invalidateQueries({ queryKey: ['live', event.id] }),
  });

  const dismiss = useCallback(() => {
    if (autoClose.current) window.clearTimeout(autoClose.current);
    setShown(null);
  }, []);

  const check = useMutation({
    mutationFn: (body: { token?: string; ticketId?: string }) => submitCheckIn(event.id, body),
    onSuccess: (result) => {
      setSession((s) => ({ scans: s.scans + 1, admitted: s.admitted + (result.outcome === 'valid' ? 1 : 0) }));
      remember(result.outcome, result.participant?.name ?? (result.outcome === 'wrong_event' ? 'Other event’s ticket' : 'Unknown code'));
      setShown({ kind: 'result', result });
      buzz(result.outcome === 'valid' ? [60] : [180, 80, 180]);
      qc.invalidateQueries({ queryKey: ['live', event.id] });
      // Lookup rows show ticket status; refresh them so a just-admitted person no longer reads "Valid".
      qc.invalidateQueries({ queryKey: ['lookup', event.id] });
      if (result.outcome === 'valid') autoClose.current = window.setTimeout(() => setShown(null), 2600);
    },
    onError: (err, body) => {
      // Not an answer about the ticket: the server could not be reached or failed.
      remember('unavailable', 'Not checked — no connection');
      setShown({
        kind: 'unavailable',
        message: err instanceof ApiError && err.isNetwork ? 'No connection to CAMPUSFLOW.' : errorMessage(err),
        retry: () => check.mutate(body),
      });
      buzz([300]);
    },
  });

  const scanner = useQrScanner((text) => !check.isPending && check.mutate({ token: text }), { paused: shown !== null || check.isPending || mode !== 'camera' });

  useEffect(() => () => void (autoClose.current && window.clearTimeout(autoClose.current)), []);
  const stopCamera = scanner.stop;
  useEffect(() => {
    if (mode !== 'camera') stopCamera();
  }, [mode, stopCamera]);

  const s = stats.data;
  return (
    <div className="flex min-h-dvh flex-col bg-ink-950">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link to={`/live/${event.id}`} className="-ml-1 p-1.5 text-paper-2" aria-label="Back to live dashboard">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{event.title}</p>
          <p className="text-xs text-paper-3">
            {channel === 'live' ? 'Live' : channel === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'} · this device: {session.admitted} admitted / {session.scans} scans
          </p>
        </div>
        <div className="text-right">
          <p className="tnum text-xl font-semibold leading-none">{s ? s.checkedIn : '–'}</p>
          <p className="tnum text-[11px] text-paper-3">of {s ? s.expectedParticipants : '–'} in</p>
        </div>
      </header>

      {s && s.window.state !== 'open' && (
        <p className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-[13px] text-paper">
          <Clock className="mr-1.5 inline size-3.5 text-warn" />
          {s.window.state === 'not_open' ? `Check-in opens ${fmt.dateTime(s.window.opensAt)} — scans will be refused until then.` : 'Check-in has closed for this event.'}
        </p>
      )}

      <div role="tablist" aria-label="Check-in method" className="grid grid-cols-2 border-b border-line">
        {(
          [
            ['camera', 'Scan QR', Camera],
            ['manual', 'Manual lookup', Keyboard],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => {
              dismiss();
              setMode(m);
            }}
            className={clsx('flex items-center justify-center gap-2 py-3 text-sm', mode === m ? 'border-b-2 border-signal text-paper' : 'text-paper-3')}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <ol aria-label="Recent results on this device" className="scrollbar-none flex gap-2 overflow-x-auto border-b border-line px-4 py-2">
          {history.map((h) => {
            const tone = h.outcome === 'valid' ? 'text-ok' : h.outcome === 'already_checked_in' ? 'text-warn' : h.outcome === 'unavailable' ? 'text-info' : 'text-bad';
            const Icon = h.outcome === 'valid' ? CircleCheck : h.outcome === 'already_checked_in' ? Clock : h.outcome === 'unavailable' ? WifiOff : ShieldX;
            return (
              <li key={h.id} className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs">
                <Icon className={clsx('size-3.5', tone)} aria-hidden />
                <span className="max-w-[9rem] truncate text-paper-2">{h.name}</span>
                <span className="tnum text-paper-3">{fmt.f(new Date(h.at), 'HH:mm')}</span>
                <span className="sr-only">{h.outcome.replace(/_/g, ' ')}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="relative flex flex-1 flex-col">
        {mode === 'camera' ? (
          <CameraView scanner={scanner} busy={check.isPending} />
        ) : (
          <ManualLookup eventId={event.id} busy={check.isPending} onCheckIn={(ticketId) => check.mutate({ ticketId })} />
        )}
        {shown && <ResultPanel shown={shown} onDismiss={() => { dismiss(); scanner.forget(); }} />}
      </div>
    </div>
  );
}

function CameraView({ scanner, busy }: { scanner: ReturnType<typeof useQrScanner>; busy: boolean }) {
  const { state, start, video } = scanner;
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-black">
      <video ref={video} muted playsInline className={clsx('absolute inset-0 size-full object-cover', state.kind !== 'running' && 'invisible')} aria-label="Camera preview" />
      {state.kind === 'running' && (
        <div aria-hidden className="pointer-events-none relative aspect-square w-[min(72vw,340px)]">
          {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2', 'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2'].map((c) => (
            <span key={c} className={clsx('absolute size-10 border-signal', c)} />
          ))}
          <span className="absolute inset-x-4 top-1/2 h-px animate-[scanline_2.2s_ease-in-out_infinite] bg-signal/70 shadow-[0_0_12px_var(--color-signal)]" />
          <style>{'@keyframes scanline { 0%,100% { transform: translateY(-120px) } 50% { transform: translateY(120px) } } @media (prefers-reduced-motion: reduce) { .animate-\\[scanline_2\\.2s_ease-in-out_infinite\\] { animation: none } }'}</style>
        </div>
      )}
      {state.kind === 'running' && (
        <p className="absolute bottom-6 rounded-full bg-ink-950/80 px-4 py-1.5 text-[13px] text-paper-2" aria-live="polite">
          {busy ? 'Checking ticket…' : 'Point at the QR code on the participant’s ticket'}
        </p>
      )}
      {(state.kind === 'idle' || state.kind === 'starting') && (
        <div className="relative max-w-sm px-6 text-center">
          <Camera className="mx-auto size-10 text-paper-3" aria-hidden />
          <h2 className="display-sm mt-4">Scan entry tickets</h2>
          <p className="mt-3 text-sm text-paper-2">
            The camera is used only to read ticket QR codes on this device. Video is not recorded or uploaded — only the code is sent to verify the ticket.
          </p>
          <Button variant="primary" size="lg" className="mt-6 w-full" loading={state.kind === 'starting'} onClick={start} icon={<Camera className="size-4" />}>
            Start camera
          </Button>
        </div>
      )}
      {state.kind === 'error' && (
        <div role="alert" className="relative max-w-sm px-6 text-center">
          <CameraOff className="mx-auto size-10 text-bad" aria-hidden />
          <h2 className="display-sm mt-4">Camera unavailable</h2>
          <p className="mt-3 text-sm text-paper-2">{state.message}</p>
          {state.reason !== 'insecure' && state.reason !== 'unsupported' && (
            <Button className="mt-6" onClick={start} icon={<RefreshCw className="size-4" />}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ManualLookup({ eventId, busy, onCheckIn }: { eventId: string; busy: boolean; onCheckIn: (ticketId: string) => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const fmt = useFormat();
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const results = useQuery({
    queryKey: ['lookup', eventId, term],
    queryFn: () => api<LookupRow[]>(`/events/${eventId}/lookup`, { query: { q: term } }),
    enabled: term.length >= 2,
  });
  return (
    <div className="flex-1 px-4 py-5">
      <label className="relative block">
        <span className="sr-only">Find a ticket</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-paper-3" />
        <input autoFocus className="field !py-3 !pl-9 !text-base" placeholder="Ticket code, name, roll number or registration code" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <p className="mt-2 text-xs text-paper-3">Use when a QR code won’t scan. Check the person’s college ID before admitting them.</p>
      <div className="mt-5">
        {results.isError && <ErrorState error={results.error} onRetry={() => results.refetch()} />}
        {results.data && results.data.length === 0 && <p className="text-sm text-paper-3">No tickets match “{term}”.</p>}
        <ul className="space-y-2">
          {results.data?.map((r) => (
            <li key={r.ticketId} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line bg-ink-900 p-3">
              <div className="min-w-0">
                <p className="truncate text-paper">{r.participant.name}</p>
                <p className="truncate text-xs text-paper-3">
                  {[r.participant.rollNumber, r.team, r.registration.code].filter(Boolean).join(' · ')} · <span className="font-mono">{r.shortCode}</span>
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <StatusPill kind="ticket" value={r.status} />
                  {r.checkedInAt && <span className="text-xs text-paper-3">{fmt.time(r.checkedInAt)}</span>}
                  {r.registration.status !== 'confirmed' && <span className="text-xs text-warn">Registration {r.registration.status}</span>}
                </div>
              </div>
              <Button variant={r.status === 'active' ? 'primary' : 'secondary'} size="sm" loading={busy} onClick={() => onCheckIn(r.ticketId)}>
                {r.status === 'active' ? 'Check in' : 'Verify'}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const OUTCOME = {
  valid: { tone: 'ok', icon: CircleCheck, title: 'Checked in' },
  already_checked_in: { tone: 'warn', icon: Clock, title: 'Already checked in' },
  invalid: { tone: 'bad', icon: ShieldX, title: 'Not a valid ticket' },
  wrong_event: { tone: 'bad', icon: TriangleAlert, title: 'Wrong event' },
  not_eligible: { tone: 'bad', icon: Ban, title: 'Not eligible' },
} as const;

function ResultPanel({ shown, onDismiss }: { shown: Shown; onDismiss: () => void }) {
  const fmt = useFormat();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), [shown]);
  if (shown.kind === 'unavailable') {
    return (
      <div role="alertdialog" aria-labelledby="scan-result" className="absolute inset-0 z-10 flex flex-col justify-end bg-ink-950/70 backdrop-blur-sm">
        <div className="animate-rise rounded-t-[var(--radius-lg)] border-t-4 border-info bg-ink-900 px-6 pb-8 pt-6">
          <WifiOff className="size-9 text-info" aria-hidden />
          <h2 id="scan-result" className="mt-3 text-2xl font-semibold">Verification service unavailable</h2>
          <p className="mt-2 text-paper-2">
            {shown.message} <strong className="font-medium text-paper">The ticket was not checked</strong> — this says nothing about whether it is valid.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button ref={btn} variant="primary" size="lg" onClick={shown.retry} icon={<RefreshCw className="size-4" />}>
              Retry
            </Button>
            <Button size="lg" onClick={onDismiss}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }
  const r = shown.result;
  const def = OUTCOME[r.outcome];
  const Icon = def.icon;
  const tone = { ok: 'border-ok text-ok', warn: 'border-warn text-warn', bad: 'border-bad text-bad' }[def.tone];
  return (
    <div role="alertdialog" aria-labelledby="scan-result" aria-describedby="scan-detail" className="absolute inset-0 z-10 flex flex-col justify-end bg-ink-950/70 backdrop-blur-sm" onClick={r.outcome === 'valid' ? onDismiss : undefined}>
      <div className={clsx('animate-rise rounded-t-[var(--radius-lg)] border-t-4 bg-ink-900 px-6 pb-8 pt-6', tone.split(' ')[0])}>
        <div className="flex items-center gap-3">
          <Icon className={clsx('size-10', tone.split(' ')[1])} aria-hidden />
          <h2 id="scan-result" className="text-2xl font-semibold">
            {r.reason === 'participation_not_approved' ? 'Participation not approved' : def.title}
          </h2>
        </div>
        {r.participant && <p className="mt-4 text-3xl font-semibold leading-tight tracking-tight">{r.participant.name}</p>}
        <div id="scan-detail" className="mt-2 space-y-1 text-paper-2">
          {r.participant && <p className="text-sm">{[r.participant.rollNumber, r.participant.department, r.registrationCode].filter(Boolean).join(' · ')}</p>}
          {r.team && (
            <p className="text-sm">
              Team <span className="text-paper">{r.team.name}</span> · <span className="tnum">{r.team.arrived} of {r.team.size}</span> arrived
            </p>
          )}
          {r.outcome === 'already_checked_in' && r.checkedInAt && (
            <p className="text-sm text-paper">
              First admitted at {fmt.time(r.checkedInAt)}
              {r.checkedInBy ? ` by ${r.checkedInBy.name}` : ''}. Do not admit twice.
            </p>
          )}
          {r.outcome !== 'valid' && r.outcome !== 'already_checked_in' && <p className="text-sm text-paper">{r.message}</p>}
        </div>
        <Button ref={btn} variant={r.outcome === 'valid' ? 'secondary' : 'primary'} size="lg" className="mt-6 w-full" onClick={onDismiss}>
          Scan next
        </Button>
      </div>
    </div>
  );
}
