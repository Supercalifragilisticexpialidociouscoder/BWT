import { memo, useMemo, type ReactElement } from 'react';
import clsx from 'clsx';
import { useFormat } from '../lib/format';

/**
 * Deterministic, category-specific poster art. Seeded from the event slug so the same
 * event always renders the same composition. Used when no cover photo is uploaded.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAPER = '#f2ece2';
const SIGNAL = '#c9f03c';
const W = 300;
const H = 400;

type Motif = (r: () => number) => ReactElement;

const motifs: Record<string, Motif> = {
  hackathon: (r) => {
    const cells: ReactElement[] = [];
    const size = 20;
    for (let y = 0; y < H / size; y++) {
      for (let x = 0; x < W / size; x++) {
        const v = r();
        if (v < 0.2) cells.push(<rect key={`${x}-${y}`} x={x * size + 4} y={y * size + 4} width={size - 8} height={size - 8} fill={PAPER} opacity={0.08 + v * 0.6} />);
        else if (v > 0.985) cells.push(<rect key={`${x}-${y}`} x={x * size + 4} y={y * size + 4} width={size - 8} height={size - 8} fill={SIGNAL} />);
      }
    }
    return <g>{cells}<path d={`M0 ${H * 0.72} L${W} ${H * 0.38}`} stroke={SIGNAL} strokeWidth={1.2} opacity={0.9} /></g>;
  },
  workshop: (r) => {
    const accent = Math.floor(r() * 14);
    return (
      <g>
        {Array.from({ length: 16 }, (_, i) => {
          const w = 40 + r() * 220;
          return <rect key={i} x={24} y={36 + i * 21} width={w} height={7} rx={1} fill={i === accent ? SIGNAL : PAPER} opacity={i === accent ? 1 : 0.1 + r() * 0.25} />;
        })}
      </g>
    );
  },
  seminar: (r) => {
    const cx = 60 + r() * 180;
    const cy = 90 + r() * 140;
    const accent = 3 + Math.floor(r() * 5);
    return (
      <g fill="none">
        {Array.from({ length: 18 }, (_, i) => (
          <circle key={i} cx={cx} cy={cy} r={14 + i * 21} stroke={i === accent ? SIGNAL : PAPER} strokeWidth={i === accent ? 1.6 : 1} opacity={i === accent ? 1 : Math.max(0.05, 0.4 - i * 0.02)} />
        ))}
        <circle cx={cx} cy={cy} r={5} fill={SIGNAL} />
      </g>
    );
  },
  competition: (r) => {
    const off = r() * 20;
    return (
      <g>
        {Array.from({ length: 40 }, (_, i) => (
          <line key={i} x1={-200 + i * 14 + off} y1={H} x2={i * 14 + off} y2={0} stroke={PAPER} strokeWidth={1} opacity={0.06 + (i % 5 === 0 ? 0.18 : 0)} />
        ))}
        <path d={`M${60 + r() * 40} 120 l70 70 l-70 70`} fill="none" stroke={SIGNAL} strokeWidth={3} />
        <path d={`M${120 + r() * 40} 120 l70 70 l-70 70`} fill="none" stroke={PAPER} strokeWidth={1.5} opacity={0.6} />
      </g>
    );
  },
  'project-expo': (r) => {
    const items: ReactElement[] = [];
    const s = 26;
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 7; col++) {
        if (r() > 0.42) continue;
        const x = col * s * 1.73 + (row % 2) * s * 0.866 - 10;
        const y = row * s * 1.5 - 10;
        const hot = r() > 0.95;
        items.push(
          <path
            key={`${row}-${col}`}
            d={`M${x} ${y + s * 0.5} l${s * 0.866} ${-s * 0.5} l${s * 0.866} ${s * 0.5} l0 ${s} l${-s * 0.866} ${s * 0.5} l${-s * 0.866} ${-s * 0.5} z M${x} ${y + s * 0.5} l${s * 0.866} ${s * 0.5} l${s * 0.866} ${-s * 0.5} M${x + s * 0.866} ${y + s} l0 ${s}`}
            fill="none"
            stroke={hot ? SIGNAL : PAPER}
            strokeWidth={hot ? 1.5 : 0.8}
            opacity={hot ? 1 : 0.18 + r() * 0.2}
          />,
        );
      }
    }
    return <g>{items}</g>;
  },
  cultural: (r) => {
    const accent = Math.floor(r() * 10);
    return (
      <g fill="none">
        {Array.from({ length: 12 }, (_, i) => {
          const amp = 8 + r() * 30;
          const freq = 0.015 + r() * 0.02;
          const phase = r() * Math.PI * 2;
          const y0 = 50 + i * 28;
          let d = `M0 ${y0}`;
          for (let x = 0; x <= W; x += 6) d += ` L${x} ${(y0 + Math.sin(x * freq + phase) * amp).toFixed(1)}`;
          return <path key={i} d={d} stroke={i === accent ? SIGNAL : PAPER} strokeWidth={i === accent ? 2 : 1} opacity={i === accent ? 1 : 0.12 + r() * 0.3} />;
        })}
      </g>
    );
  },
  sports: (r) => {
    const cx = W * (0.3 + r() * 0.4);
    const accent = 2 + Math.floor(r() * 4);
    return (
      <g fill="none">
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x={cx - 40 - i * 18} y={70 - i * 18} width={80 + i * 36} height={260 + i * 36} rx={40 + i * 18} stroke={i === accent ? SIGNAL : PAPER} strokeWidth={i === accent ? 2 : 1} opacity={i === accent ? 1 : 0.1 + i * 0.03} />
        ))}
      </g>
    );
  },
  'club-meetup': (r) => {
    const pts = Array.from({ length: 22 }, () => [20 + r() * 260, 30 + r() * 340] as const);
    const lines: ReactElement[] = [];
    pts.forEach((p, i) => {
      const q = pts[(i * 7 + 3) % pts.length]!;
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 140) lines.push(<line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={PAPER} strokeWidth={0.8} opacity={0.25} />);
    });
    return (
      <g>
        {lines}
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === 4 ? 6 : 1.5 + r() * 3} fill={i === 4 ? SIGNAL : PAPER} opacity={i === 4 ? 1 : 0.5} />
        ))}
      </g>
    );
  },
};

const fallback: Motif = (r) => (
  <g fill="none">
    {Array.from({ length: 22 }, (_, i) => (
      <line key={i} x1={0} y1={H * 0.45 + i * i * 0.9} x2={W} y2={H * 0.45 + i * i * 0.9} stroke={PAPER} opacity={0.08 + i * 0.012} />
    ))}
    <circle cx={W * (0.3 + r() * 0.4)} cy={H * 0.36} r={46} stroke={SIGNAL} strokeWidth={2} />
  </g>
);

export interface PosterEvent {
  slug: string;
  title: string;
  category: string;
  categoryName?: string;
  startsAt: string;
  coverUrl: string | null;
}

export const EventPoster = memo(function EventPoster({
  event,
  className,
  showDate = true,
  showCategory = true,
  size = 'md',
}: {
  event: PosterEvent;
  className?: string;
  showDate?: boolean;
  showCategory?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const fmt = useFormat();
  const art = useMemo(() => {
    const r = rng(hash(event.slug));
    return (motifs[event.category] ?? fallback)(r);
  }, [event.slug, event.category]);

  return (
    <div className={clsx('relative isolate overflow-hidden bg-ink-850', className)}>
      {event.coverUrl ? (
        <img
          src={event.coverUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover [filter:saturate(0.85)_contrast(1.05)]"
        />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
          <rect width={W} height={H} fill="#191815" />
          {art}
        </svg>
      )}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/10 to-transparent" />
      {showCategory && (
        <span className={clsx('kicker absolute left-3 top-3 text-paper/80', size === 'sm' && '!text-[9px] left-2 top-2')}>
          {event.categoryName ?? event.category}
        </span>
      )}
      {showDate && (
        <div className={clsx('absolute bottom-0 left-0 flex items-end gap-2 text-paper', size === 'sm' ? 'p-2' : size === 'lg' ? 'p-6' : 'p-4')}>
          <span
            className={clsx('font-display leading-[0.8] tracking-tight [font-variation-settings:"opsz"_144]', size === 'sm' ? 'text-3xl' : size === 'lg' ? 'text-8xl' : 'text-6xl')}
            style={{ fontWeight: 330 }}
          >
            {fmt.dayNum(event.startsAt)}
          </span>
          <span className={clsx('kicker pb-1 text-paper-2', size === 'sm' && '!text-[9px] pb-0.5')}>
            {fmt.month(event.startsAt)}
            <br />
            {fmt.weekday(event.startsAt)}
          </span>
        </div>
      )}
    </div>
  );
});
