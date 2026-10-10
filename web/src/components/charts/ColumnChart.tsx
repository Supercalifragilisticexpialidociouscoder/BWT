import { useId, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';

export interface Datum {
  key: string;
  /** Short axis label (shown sparsely). */
  label: string;
  /** Full label for tooltip and table. */
  fullLabel?: string;
  value: number;
}

function niceMax(v: number): number {
  if (v <= 4) return Math.max(4, Math.ceil(v));
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Single-series column chart. Marks carry the colour; all text uses text tokens.
 * The most recent column is drawn in the accent (current period). Every column is
 * focusable and has a tooltip; a data table is always available below.
 */
export function ColumnChart({
  data,
  title,
  unit,
  height = 180,
  labelEvery,
  highlightLast = true,
  className,
}: {
  data: Datum[];
  title: string;
  unit: string;
  height?: number;
  labelEvery?: number;
  highlightLast?: boolean;
  className?: string;
}) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
  const ticks = [0, max / 2, max];
  const W = 640;
  const H = height;
  const padL = 28;
  const padB = 22;
  const plotW = W - padL;
  const plotH = H - padB - 8;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(2, slot - 2));
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / 6));
  const total = data.reduce((a, d) => a + d.value, 0);

  const y = (v: number) => 8 + plotH - (v / max) * plotH;
  const barPath = (x: number, v: number) => {
    const top = y(v);
    const h = 8 + plotH - top;
    if (h <= 0) return '';
    const r = Math.min(4, h, barW / 2);
    // Rounded data-end, square at the baseline.
    return `M${x},${8 + plotH} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${8 + plotH} Z`;
  };

  const activeDatum = active !== null ? data[active] : null;

  return (
    <figure className={clsx('relative', className)} aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="sr-only">
        {title}: {total} {unit} in total.
      </figcaption>
      <div ref={wrap} className="relative" onPointerLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full overflow-visible" role="group" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-paper-3 text-[10px]">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + i * slot + (slot - barW) / 2;
            const isLast = highlightLast && i === data.length - 1;
            const isActive = active === i;
            return (
              <g
                key={d.key}
                tabIndex={0}
                role="img"
                aria-label={`${d.fullLabel ?? d.label}: ${d.value} ${unit}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none [&:focus-visible>rect:first-child]:stroke-signal"
              >
                {/* Hit target covers the whole slot, not just the painted bar. */}
                <rect x={padL + i * slot} y={0} width={slot} height={H - padB} fill="transparent" stroke="transparent" strokeWidth={1.5} rx={3} />
                <path
                  d={barPath(x, d.value)}
                  fill={isLast ? 'var(--color-signal)' : 'var(--color-paper-2)'}
                  opacity={isActive || active === null ? (isLast ? 1 : 0.55) : 0.3}
                  className="transition-opacity duration-150"
                />
                {d.value === 0 && <line x1={x} x2={x + barW} y1={8 + plotH} y2={8 + plotH} stroke="var(--color-paper-3)" strokeWidth={1} opacity={0.6} />}
                {i % every === 0 && (
                  <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fill-paper-3 text-[10px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {activeDatum && active !== null && (
          <div
            role="presentation"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-[var(--radius-sm)] border border-line-strong bg-ink-850 px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `${((padL + active * slot + slot / 2) / W) * 100}%`, top: `${(y(activeDatum.value) / H) * 100}%` }}
          >
            <span className="tnum font-semibold text-paper">{activeDatum.value}</span> <span className="text-paper-3">{unit}</span>
            <span className="block text-paper-2">{activeDatum.fullLabel ?? activeDatum.label}</span>
          </div>
        )}
      </div>
      <button type="button" onClick={() => setShowTable((v) => !v)} className="mt-2 text-[11.5px] text-paper-3 underline decoration-line-strong underline-offset-4 hover:text-paper">
        {showTable ? 'Hide data table' : 'Show as table'}
      </button>
      {showTable && (
        <div className="mt-2 max-h-56 overflow-auto rounded-[var(--radius-sm)] border border-line">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-ink-850 text-paper-3">
              <tr>
                <th className="px-3 py-1.5 font-medium">Period</th>
                <th className="px-3 py-1.5 text-right font-medium">{unit}</th>
              </tr>
            </thead>
            <tbody className="tnum divide-y divide-line">
              {data.map((d) => (
                <tr key={d.key}>
                  <td className="px-3 py-1 text-paper-2">{d.fullLabel ?? d.label}</td>
                  <td className="px-3 py-1 text-right text-paper">{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
