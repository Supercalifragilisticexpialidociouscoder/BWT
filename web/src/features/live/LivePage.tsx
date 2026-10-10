import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Download, DoorOpen, ScanLine, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { formatInZone, type EventDetailDTO, type LiveStatsDTO } from '@campusflow/shared';
import { api } from '../../lib/api';
import { useFormat, pct, relativeTime } from '../../lib/format';
import { useEventChannel, type ChannelState } from '../../lib/realtime';
import { ButtonLink } from '../../components/ui/Button';
import { ErrorState, LoadingBlock } from '../../components/ui/Feedback';
import { LiveDot } from '../../components/ui/Status';
import { ColumnChart } from '../../components/charts/ColumnChart';

export function LivePage() {
  const { eventId } = useParams();
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => api<EventDetailDTO>(`/events/${eventId}`) });
  if (event.isError) return <div className="p-6"><ErrorState error={event.error} onRetry={() => event.refetch()} /></div>;
  if (!event.data) return <div className="p-6"><LoadingBlock /></div>;
  if (!event.data.viewer.canCheckIn) return <div className="p-6"><ErrorState error={new Error('You are not on the check-in team for this event.')} /></div>;
  return <Live event={event.data} />;
}

function useClock(tz: string) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return formatInZone(now, tz, 'HH:mm:ss');
}

function Live({ event }: { event: EventDetailDTO }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const clock = useClock(fmt.tz);
  const stats = useQuery({
    queryKey: ['live', event.id],
    queryFn: () => api<LiveStatsDTO>(`/events/${event.id}/live`),
    refetchInterval: 30_000, // safety net; socket hints drive normal updates
  });
  const pending = useRef<number | null>(null);
  const refresh = () => {
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => qc.invalidateQueries({ queryKey: ['live', event.id] }), 200);
  };
  const channel = useEventChannel(event.id, { onUpdate: refresh, onResync: refresh });
  const s = stats.data;

  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-ink-950/90 px-4 py-3 backdrop-blur-md sm:px-8">
        <Link to={`/workspace/attendance?event=${event.id}`} className="-ml-1 p-1.5 text-paper-2 hover:text-paper" aria-label="Back to workspace">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="kicker text-paper-3">Live check-in</p>
          <h1 className="truncate text-lg font-medium leading-tight sm:text-xl">{event.title}</h1>
        </div>
        <ConnectionState state={channel} updatedAt={s?.generatedAt} />
        <span className="tnum hidden font-mono text-lg text-paper-2 md:block" aria-label="Local time">
          {clock}
        </span>
        <ButtonLink to={`/live/${event.id}/scan`} variant="primary" icon={<ScanLine className="size-4" />} className="max-sm:hidden">
          Scan tickets
        </ButtonLink>
      </header>

      {stats.isError && !s ? (
        <div className="p-8"><ErrorState error={stats.error} onRetry={() => stats.refetch()} /></div>
      ) : !s ? (
        <div className="p-8"><LoadingBlock rows={6} /></div>
      ) : (
        <main id="main" className="mx-auto grid max-w-[1500px] gap-px bg-line pb-24 lg:grid-cols-12 lg:pb-0">
          {s.window.state !== 'open' && (
            <p className="bg-warn/10 px-6 py-2.5 text-sm text-paper lg:col-span-12">
              {s.window.state === 'not_open' ? `Check-in opens ${fmt.dateTime(s.window.opensAt)} (${relativeTime(s.window.opensAt)}).` : `Check-in closed at ${fmt.dateTime(s.window.closesAt)}. Figures below are final unless corrected.`}
            </p>
          )}

          <section aria-label="Arrivals" className="bg-ink-950 px-6 py-8 sm:px-10 lg:col-span-5 lg:py-12">
            <p className="kicker text-paper-3">Checked in</p>
            <div className="mt-3 flex items-end gap-4" aria-live="polite" aria-atomic="true">
              <motion.span
                key={s.checkedIn}
                initial={{ opacity: 0.4, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="tnum text-[clamp(5rem,13vw,10.5rem)] font-semibold leading-[0.82] tracking-[-0.05em]"
              >
                {s.checkedIn}
              </motion.span>
              <span className="tnum pb-2 text-2xl text-paper-3 sm:text-3xl">/ {s.expectedParticipants}</span>
            </div>
            <p className="mt-2 text-sm text-paper-3">people with valid tickets · {s.confirmedRegistrations} confirmed {event.mode === 'team' ? 'teams' : 'registrations'}</p>

            <div className="mt-8">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-paper-2">Attendance</span>
                <span className="tnum text-xl font-semibold">{pct(s.attendanceRate)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-700" role="meter" aria-valuemin={0} aria-valuemax={s.expectedParticipants} aria-valuenow={s.checkedIn} aria-label="Attendance">
                <motion.div className="h-full rounded-full bg-signal" initial={false} animate={{ width: `${Math.min(100, (s.attendanceRate ?? 0) * 100)}%` }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
              </div>
            </div>

            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6">
              <Figure label="Entries, last 15 min" value={String(s.entriesLast15Min)} detail={`${(s.entriesLast15Min / 15).toFixed(1)} per minute`} />
              {s.teams ? (
                <Figure label="Teams fully arrived" value={`${s.teams.arrivedComplete}`} detail={`${s.teams.arrivedPartial} partial · ${s.teams.notArrived} not yet`} />
              ) : (
                <Figure label="Still expected" value={String(Math.max(0, s.expectedParticipants - s.checkedIn))} detail="valid tickets not yet scanned" />
              )}
              {s.venue && <Figure label={`${s.venue.name} capacity`} value={pct(s.venue.occupancyRate)} detail={`${s.checkedIn} entries / ${s.venue.capacity} seats`} />}
              <Figure label="Window" value={s.window.state === 'open' ? 'Open' : s.window.state === 'not_open' ? 'Not yet' : 'Closed'} detail={`${fmt.time(s.window.opensAt)}–${fmt.time(s.window.closesAt)}`} />
            </dl>
          </section>

          <section aria-label="Entry rate and recent arrivals" className="grid gap-px bg-line lg:col-span-7">
            <div className="bg-ink-950 px-6 py-8 sm:px-10">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm text-paper-2">Arrivals per 5 minutes</h2>
                <span className="text-xs text-paper-3">last 2 hours · current interval highlighted</span>
              </div>
              <ColumnChart
                className="mt-4"
                height={160}
                title="Check-ins per 5-minute interval, last two hours"
                unit="check-ins"
                labelEvery={6}
                data={s.entryBuckets.map((b) => ({ key: b.at, label: fmt.time(b.at), fullLabel: `${fmt.time(b.at)}–${fmt.time(new Date(new Date(b.at).getTime() + 300_000))}`, value: b.count }))}
              />
            </div>
            <div className="bg-ink-950 px-6 py-8 sm:px-10">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm text-paper-2">Recent arrivals</h2>
                <a href={`/api/events/${event.id}/exports/attendance.csv`} className="inline-flex items-center gap-1 text-xs text-paper-3 hover:text-paper">
                  <Download className="size-3" /> CSV
                </a>
              </div>
              {s.recent.length === 0 ? (
                <p className="mt-6 text-sm text-paper-3">No one has checked in yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {s.recent.slice(0, 12).map((r) => (
                      <motion.li
                        key={r.id}
                        layout
                        initial={{ opacity: 0, y: -8, backgroundColor: 'rgba(201,240,60,0.10)' }}
                        animate={{ opacity: r.active ? 1 : 0.45, y: 0, backgroundColor: 'rgba(201,240,60,0)' }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="grid grid-cols-[64px_1fr_auto] items-center gap-3 py-2.5 text-sm"
                      >
                        <span className="tnum font-mono text-xs text-paper-3">{fmt.time(r.at)}</span>
                        <span className="min-w-0">
                          <span className={clsx('block truncate', r.active ? 'text-paper' : 'text-paper-3 line-through')}>{r.participant.name}</span>
                          <span className="block truncate text-xs text-paper-3">{[r.team?.name, r.registrationCode].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="text-right text-xs text-paper-3">
                          {r.method === 'qr' ? 'QR' : 'Manual'}
                          {r.staff && <span className="block">{r.staff.name.split(' ')[0]}</span>}
                        </span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </section>

          {s.teamBoard.length > 0 && (
            <section aria-label="Team arrivals" className="bg-ink-950 px-6 py-8 sm:px-10 lg:col-span-12">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm text-paper-2">Team arrivals</h2>
                <p className="flex items-center gap-4 text-xs text-paper-3">
                  <span className="flex items-center gap-1.5"><span className="h-3 w-2 rounded-[2px] bg-signal" /> arrived</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-2 rounded-[2px] border border-line-strong" /> expected</span>
                </p>
              </div>
              <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
                {[...s.teamBoard]
                  .sort((a, b) => Number(b.arrived > 0 && b.arrived < b.size) - Number(a.arrived > 0 && a.arrived < a.size) || a.name.localeCompare(b.name))
                  .map((t) => {
                    const done = t.arrived >= t.size && t.size > 0;
                    return (
                      <li key={t.id} className={clsx('rounded-[var(--radius-sm)] border px-3 py-2.5', done ? 'border-signal/40 bg-signal/[0.04]' : 'border-line')}>
                        <p className="truncate text-[13px] text-paper">{t.name}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="flex gap-0.5" aria-label={`${t.arrived} of ${t.size} arrived`}>
                            {Array.from({ length: t.size }, (_, i) => (
                              <span key={i} className={clsx('h-3 w-2 rounded-[2px] transition-colors duration-500', i < t.arrived ? 'bg-signal' : 'border border-line-strong')} />
                            ))}
                          </span>
                          <span className="tnum text-xs text-paper-3">
                            {t.arrived}/{t.size}
                          </span>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}
        </main>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-ink-950/95 p-3 backdrop-blur-md sm:hidden">
        <ButtonLink to={`/live/${event.id}/scan`} variant="primary" size="lg" className="w-full" icon={<ScanLine className="size-5" />}>
          Scan tickets
        </ButtonLink>
      </div>
    </div>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <dt className="text-xs text-paper-3">{label}</dt>
      <dd className="tnum mt-1 text-3xl font-semibold tracking-tight">{value}</dd>
      <dd className="text-xs text-paper-3">{detail}</dd>
    </div>
  );
}

function ConnectionState({ state, updatedAt }: { state: ChannelState; updatedAt?: string }) {
  const fmt = useFormat();
  const label = state === 'live' ? 'Live' : state === 'reconnecting' ? 'Reconnecting' : state === 'forbidden' ? 'No access' : state === 'offline' ? 'Offline' : 'Connecting';
  return (
    <span className="flex items-center gap-2 text-xs text-paper-2" role="status" title={updatedAt ? `Last synced ${fmt.f(updatedAt, 'HH:mm:ss')}` : undefined}>
      {state === 'live' ? <LiveDot /> : state === 'reconnecting' || state === 'connecting' ? <DoorOpen className="size-3.5 animate-pulse text-warn" /> : <WifiOff className="size-3.5 text-bad" />}
      <span>{label}</span>
      {updatedAt && <span className="tnum hidden text-paper-3 sm:inline">· {fmt.f(updatedAt, 'HH:mm:ss')}</span>}
    </span>
  );
}
