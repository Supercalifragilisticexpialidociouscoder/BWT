import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowDown, ArrowRight, X } from 'lucide-react';
import clsx from 'clsx';
import { useInstitutionRequired } from '../../lib/institution';
import { useFormat } from '../../lib/format';
import { supportsWebGL, usePrefersReducedMotion } from '../../lib/motion';
import { useSession } from '../../lib/session';
import { FORM_MEANING } from '../../lib/categories';
import { LANE } from '../../three/layout';
import { LandscapeFallback } from '../../three/LandscapeFallback';
import type { Anchor } from '../../three/Universe';
import { FormGlyph } from '../../components/CategoryMark';
import { LiveDot } from '../../components/ui/Status';
import { Directory, useDirectoryFilters } from './Directory';
import { useUniverse, type UniverseState } from './universe/useUniverse';
import { TimeRail } from './universe/TimeRail';
import { EventPanel } from './universe/EventPanel';

const Universe = lazy(() => import('../../three/Universe'));

/** If the 3D scene throws, keep the 2D landscape instead of breaking the page. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function useLowPower() {
  const [low] = useState(() => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || window.innerWidth < 768;
  });
  return low;
}

export function HomePage() {
  const inst = useInstitutionRequired();
  const fmt = useFormat();
  const { hasWorkspace } = useSession();
  const reduced = usePrefersReducedMotion();
  const lowPower = useLowPower();
  const [params] = useSearchParams();
  const { filters, set } = useDirectoryFilters();
  const category = filters.category;
  const setCategory = useCallback((slug: string | null) => set({ category: slug }), [set]);
  const u = useUniverse(inst.timezone, category, setCategory);

  // WebGL is an enhancement. The 2D landscape renders first and stays if 3D is unavailable.
  const [webgl] = useState(() => params.get('webgl') !== 'off' && supportsWebGL());
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const use3d = webgl && !sceneFailed;
  const show2d = !use3d || !sceneReady;

  // Scroll progress drives the camera without React re-renders.
  const hero = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = hero.current?.offsetHeight ?? 1;
        const p = Math.min(Math.max(window.scrollY / h, 0), 1);
        progress.current = p;
        if (layer.current) {
          layer.current.style.opacity = String(1 - p * 0.75);
          if (!reduced) layer.current.style.transform = `translate3d(0, ${(p * 14).toFixed(1)}vh, 0)`;
        }
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const anchors = useRef(new Map<string, Anchor>());
  const anchorRef = (key: string, pos: [number, number, number]) => (el: HTMLElement | null) => {
    if (el) anchors.current.set(key, { pos, el });
    else anchors.current.delete(key);
  };

  const live = u.events.filter((e) => new Date(e.startsAt).getTime() <= Date.now() && new Date(e.endsAt).getTime() > Date.now());
  const nextUp = u.layout.nodes.filter((n) => (!category || n.category === category) && new Date(n.endsAt).getTime() > Date.now()).slice(0, 5);
  const hovered = u.layout.nodes.find((n) => n.id === u.hoveredId && n.id !== u.selected?.id);
  const selected = u.selected && u.selectedEvent ? { node: u.selected, event: u.selectedEvent } : null;
  const pool = u.layout.nodes.filter((n) => !category || n.category === category);
  const position = selected ? `${pool.findIndex((n) => n.id === selected.node.id) + 1}/${pool.length}` : '';

  return (
    <main id="main">
      <section ref={hero} className="grain relative flex h-[calc(100svh-var(--demo-strip-h,0px))] min-h-[640px] flex-col overflow-hidden" aria-labelledby="hero-title">
        <div className="relative min-h-0 flex-1">
          {/* ------------------------------------------------ the stage */}
          <div ref={layer} className="absolute inset-0 will-change-transform">
            <div className={clsx('absolute inset-0 transition-opacity duration-[var(--dur-cinematic)]', !show2d && 'pointer-events-none opacity-0')}>
              <LandscapeFallback
                layout={u.layout}
                selectedId={u.selected?.id ?? null}
                hoveredId={u.hoveredId}
                category={category}
                spanDays={u.spanDays}
                centerDay={u.centerDay}
                onHover={u.setHovered}
                onSelect={u.select}
              />
            </div>
            {use3d && u.status === 'ready' && (
              <SceneBoundary onError={() => setSceneFailed(true)}>
                <Suspense fallback={null}>
                  <div className={clsx('absolute inset-0 transition-opacity duration-[var(--dur-cinematic)]', sceneReady ? 'opacity-100' : 'opacity-0')}>
                    <Universe
                      layout={u.layout}
                      selectedId={u.selected?.id ?? null}
                      hoveredId={u.hoveredId}
                      category={category}
                      view={{ centerDay: u.centerDay, spanDays: u.spanDays }}
                      onHover={u.setHovered}
                      onSelect={u.select}
                      progress={progress}
                      reduced={reduced}
                      lowPower={lowPower}
                      anchors={anchors}
                      onReady={() => setSceneReady(true)}
                      onFail={() => setSceneFailed(true)}
                    />
                  </div>
                </Suspense>
              </SceneBoundary>
            )}
            {use3d && sceneReady && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                {u.layout.lanes.map((l) => (
                  <span
                    key={l.slug}
                    ref={anchorRef(`lane:${l.slug}`, [u.layout.minX - 0.15, 0, l.z])}
                    className={clsx(
                      'kicker absolute left-0 top-0 inline-flex -translate-x-full -translate-y-1/2 items-center gap-1.5 whitespace-nowrap pr-2 !text-[10px] text-paper-3 transition-opacity duration-300',
                      (category && category !== l.slug) || u.selected ? 'opacity-30' : 'opacity-100',
                    )}
                  >
                    <FormGlyph form={l.form} className="size-3" /> {l.name}
                  </span>
                ))}
                {u.layout.weeks.map((w) => (
                  <span
                    key={w.x}
                    ref={anchorRef(`week:${w.x}`, [w.x, 0, u.layout.maxZ + LANE * 0.9])}
                    className={clsx('kicker absolute left-0 top-0 -translate-x-1/2 whitespace-nowrap !text-[10px]', w.day === 0 ? 'text-signal' : 'text-paper-3')}
                  >
                    {w.label}
                  </span>
                ))}
                {hovered && (
                  <span key={hovered.id} ref={anchorRef(`hover:${hovered.id}`, [hovered.x, hovered.h + 0.45, hovered.z])} className="absolute left-0 top-0" style={{ visibility: 'hidden' }}>
                    <span className="block -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[3px] border border-line-strong bg-ink-950/90 px-2.5 py-1.5 text-center">
                      <span className="block text-[13px] text-paper">{hovered.title}</span>
                      <span className="block text-[11px] text-paper-3">
                        {fmt.dateTime(hovered.startsAt)} · {hovered.categoryName}
                      </span>
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Legibility scrims: strong behind text, clear over the landscape. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(12_11_10/0.9)_0%,rgb(12_11_10/0.5)_34%,transparent_56%)] max-md:bg-[linear-gradient(180deg,rgb(12_11_10/0.95)_0%,rgb(12_11_10/0.55)_42%,transparent_62%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-950/80 to-transparent" />

          {/* Keyboard layer: the landscape is operable without a pointer. */}
          <div
            tabIndex={0}
            role="application"
            aria-roledescription="event landscape"
            aria-label="Event landscape. Left and right arrows move between events in date order, up and down change category, Enter opens the selected event, Escape returns to the overview, T jumps to today."
            onKeyDown={u.onKeyDown}
            className="pointer-events-none absolute inset-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-signal/70"
          />
          <p className="sr-only" aria-live="polite">
            {u.announcement}
          </p>

          {/* ------------------------------------------------ editorial copy */}
          <div
            className={clsx(
              'pointer-events-none relative z-10 mx-auto flex h-full max-w-[1500px] flex-col px-[var(--gutter)] pt-24 transition-opacity duration-[var(--dur-panel)] md:justify-end md:pb-10 md:pt-0',
              selected && 'opacity-0 md:opacity-[0.18] lg:opacity-[0.22]',
            )}
          >
            <div className="pointer-events-auto max-w-[40rem]">
              <p className="kicker mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-paper-2">
                {live.length > 0 && (
                  <button type="button" onClick={() => u.select(live[0]!.id)} className="inline-flex items-center gap-2 text-paper hover:text-signal">
                    <LiveDot /> {live.length === 1 ? `${live[0]!.title} is on now` : `${live.length} events on now`}
                  </button>
                )}
                <span>{u.status === 'ready' ? `${u.total} upcoming · ${inst.shortName}` : inst.name}</span>
              </p>
              <h1 id="hero-title" className="display-xl text-paper max-md:!text-[clamp(2.6rem,12vw,3.6rem)]">
                Campus events,
                <br />
                <span className="italic-accent text-signal">end to end.</span>
              </h1>
              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-paper-2 max-md:hidden">
                Every published event on one field of time. Find one, register alone or with your team, carry a single ticket in. Organizers run payments, rooms and check-in from the same system.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3 max-md:mt-5">
                <a href="#discover" className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-signal px-5 text-[15px] font-medium text-signal-ink transition-colors hover:bg-signal-2">
                  Event directory <ArrowDown className="size-4" aria-hidden />
                </a>
                <Link
                  to={hasWorkspace ? '/workspace' : '/login?next=/workspace'}
                  className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] border border-line-strong px-4 text-[15px] text-paper transition-colors hover:border-paper-3"
                >
                  For organizers <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
              <p className="mt-6 hidden text-[12px] text-paper-3 md:block">Select a beacon — or focus the landscape and use the arrow keys — to inspect an event.</p>
            </div>
          </div>

          {/* ------------------------------------------------ right column: index or selection */}
          <div className="pointer-events-none absolute inset-y-0 right-[var(--gutter)] z-20 hidden w-[19rem] flex-col justify-end pb-6 pt-20 lg:flex xl:w-[23rem]">
            {selected ? <EventPanel event={selected.event} node={selected.node} onClose={() => u.select(null)} onStep={u.step} onKeyDown={u.onKeyDown} position={position} /> : <NextUp u={u} category={category} setCategory={setCategory} nodes={nextUp} />}
          </div>

          {/* Phones & tablets: the selected event opens as a sheet over the stage. */}
          {selected && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex max-h-[78%] flex-col justify-end lg:hidden">
              <EventPanel event={selected.event} node={selected.node} onClose={() => u.select(null)} onStep={u.step} onKeyDown={u.onKeyDown} position={position} />
            </div>
          )}

          {u.status === 'ready' && u.events.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center px-6 md:justify-end md:pr-[12%]">
              <div className="max-w-xs border-l border-signal pl-5">
                <p className="display-sm">Nothing published yet.</p>
                <p className="mt-2 text-sm text-paper-2">When organizers publish events they appear here, positioned by date. The directory below stays current.</p>
                {hasWorkspace && (
                  <Link to="/workspace/events/new" className="mt-3 inline-block text-sm text-signal underline underline-offset-4">
                    Create an event
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

        <TimeRail u={u} tz={inst.timezone} />
      </section>

      <section id="discover" className="relative z-20 scroll-mt-0 bg-ink-950">
        <Directory />
      </section>

      <OrganizerBand hasWorkspace={hasWorkspace} />
    </main>
  );
}

function NextUp({ u, nodes, category, setCategory }: { u: UniverseState; nodes: UniverseState['layout']['nodes']; category: string | null; setCategory: (s: string | null) => void }) {
  const fmt = useFormat();
  const forms = [...new Set(u.layout.nodes.map((n) => n.form))];
  return (
    <div className="pointer-events-auto">
      <div className="mb-2 flex items-center justify-between">
        <p className="kicker text-paper-3">Next up{category ? ` · ${u.layout.lanes.find((l) => l.slug === category)?.name}` : ''}</p>
        {category && (
          <button type="button" className="kicker inline-flex items-center gap-1 text-paper-3 hover:text-paper" onClick={() => setCategory(null)}>
            <X className="size-3" /> all
          </button>
        )}
      </div>
      <ol className="divide-y divide-line border-y border-line bg-ink-950/70">
        {nodes.map((n, i) => (
          <li key={n.id} className={clsx(i >= 4 && 'max-xl:hidden')}>
            <button
              type="button"
              onClick={() => u.select(n.id)}
              onMouseEnter={() => u.setHovered(n.id)}
              onMouseLeave={() => u.setHovered(null)}
              onFocus={() => u.setHovered(n.id)}
              onBlur={() => u.setHovered(null)}
              className={clsx('group grid w-full grid-cols-[44px_1fr_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors', u.hoveredId === n.id ? 'bg-ink-850' : 'hover:bg-ink-900')}
            >
              <span className="text-center">
                <span className="block font-display text-[22px] leading-none" style={{ fontWeight: 340 }}>
                  {fmt.dayNum(n.startsAt)}
                </span>
                <span className="kicker !text-[9px] text-paper-3">{fmt.month(n.startsAt)}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-paper">{n.title}</span>
                <span className="block truncate text-xs text-paper-3">
                  {n.live ? <span className="text-signal">On now</span> : fmt.time(n.startsAt)} · {n.mode === 'team' ? 'Team' : 'Solo'} · {n.registrations} registered
                </span>
              </span>
              <FormGlyph form={n.form} className={clsx('size-3.5', n.live ? 'text-signal' : 'text-paper-3 group-hover:text-paper')} />
            </button>
          </li>
        ))}
        {u.status === 'ready' && nodes.length === 0 && <li className="px-3 py-4 text-sm text-paper-3">Nothing coming up in this category.</li>}
        {u.status === 'loading' && <li className="px-3 py-4 text-sm text-paper-3">Loading…</li>}
      </ol>
      <div className="mt-3 hidden flex-wrap gap-1.5 xl:flex" role="group" aria-label="Focus a category">
        {u.layout.lanes.map((l) => (
          <button
            key={l.slug}
            type="button"
            aria-pressed={category === l.slug}
            onClick={() => setCategory(category === l.slug ? null : l.slug)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors',
              category === l.slug ? 'border-signal bg-signal text-signal-ink' : 'border-line bg-ink-950/60 text-paper-3 hover:text-paper',
            )}
          >
            <FormGlyph form={l.form} className="size-3" /> {l.name}
          </button>
        ))}
      </div>
      <details className="mt-3 hidden text-[11px] text-paper-3 xl:block">
        <summary className="cursor-pointer select-none hover:text-paper-2">How to read the landscape</summary>
        <div className="mt-2 space-y-1.5 border-l border-line pl-3 leading-relaxed">
          <p>
            Time runs away from you; <span className="text-signal">the lit line is now</span>. Rows are categories, height is how many have registered.
          </p>
          <p>Ring at the base: team event · dot: solo. Amber cap: full. Dim: registration closed. Lime: on now or selected.</p>
          <ul className="grid grid-cols-1 gap-1">
            {forms.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <FormGlyph form={f} className="size-3 text-paper-2" /> {FORM_MEANING[f]}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}

function OrganizerBand({ hasWorkspace }: { hasWorkspace: boolean }) {
  const steps = [
    ['Publish', 'Set dates, capacity, team sizes and fees. Book a room — clashes are caught before they happen.'],
    ['Verify', 'Match payment references against your statement. Verified teams get tickets automatically.'],
    ['Admit', 'Scan tickets at the door with a phone. Duplicate entries are refused; the live count updates everywhere.'],
  ];
  return (
    <section aria-labelledby="org-h" className="mx-auto mt-24 max-w-[1400px] px-[var(--gutter)]">
      <div className="grid gap-10 border-t border-line pt-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <p className="kicker text-paper-3">For organizers</p>
          <h2 id="org-h" className="display-lg mt-3">
            The same events, <span className="italic-accent">from the other side.</span>
          </h2>
          <Link to={hasWorkspace ? '/workspace' : '/login?next=/workspace'} className="mt-6 inline-flex items-center gap-2 text-sm text-paper underline decoration-signal underline-offset-[6px]">
            Open the workspace <ArrowRight className="size-4" />
          </Link>
        </div>
        <ol className="grid gap-px bg-line sm:grid-cols-3">
          {steps.map(([title, body], i) => (
            <li key={title} className="bg-ink-950 p-5 sm:pt-2">
              <p className="tnum font-mono text-xs text-paper-3">{String(i + 1).padStart(2, '0')}</p>
              <p className="display-sm mt-3">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-paper-2">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
