import type { Form } from '../lib/categories';
import type { Layout, Node } from './layout';

/**
 * 2D rendering of the same landscape — used when WebGL is unavailable or fails, and as the
 * placeholder while the 3D scene loads. Same encoding and the same interactions: x = date,
 * rows = categories, height = registrations, shape = category form.
 */
const PAPER = '#f2ece2';
const SIGNAL = '#c9f03c';
const WARN = '#f2b441';

function Shape({ form, x, y, r, fill }: { form: Form; x: number; y: number; r: number; fill: string }) {
  const stroke = { stroke: fill, strokeWidth: 1.6, fill: 'none' };
  switch (form) {
    case 'module':
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...stroke} />;
    case 'layers':
      return (
        <g fill={fill}>
          {[-0.7, 0, 0.7].map((d) => (
            <rect key={d} x={x - r * 1.2} y={y + d * r - 1.2} width={r * 2.4} height={2.4} />
          ))}
        </g>
      );
    case 'cluster':
      return (
        <g {...stroke}>
          <rect x={x - r * 0.45} y={y - r * 1.1} width={r * 0.9} height={r * 0.9} />
          <rect x={x - r * 1.1} y={y + r * 0.1} width={r * 0.9} height={r * 0.9} />
          <rect x={x + r * 0.2} y={y + r * 0.1} width={r * 0.9} height={r * 0.9} />
        </g>
      );
    case 'ring':
      return <circle cx={x} cy={y} r={r} {...stroke} strokeWidth={2.2} />;
    case 'signal':
      return (
        <g fill={fill}>
          <rect x={x - 1.2} y={y - r * 0.3} width={2.4} height={r * 1.5} />
          <circle cx={x} cy={y - r * 0.8} r={r * 0.4} />
        </g>
      );
    case 'vector':
      return <path d={`M${x - r} ${y - r} L${x + r * 1.2} ${y} L${x - r} ${y + r} Z`} {...stroke} />;
    case 'constellation':
      return (
        <g fill={fill}>
          <path d={`M${x - r} ${y + r * 0.6} L${x} ${y - r} L${x + r} ${y + r * 0.4}`} stroke={fill} strokeWidth={1} fill="none" />
          <circle cx={x - r} cy={y + r * 0.6} r={2.2} />
          <circle cx={x} cy={y - r} r={2.2} />
          <circle cx={x + r} cy={y + r * 0.4} r={2.2} />
        </g>
      );
    case 'assembly':
      return <path d={`M${x} ${y - r * 1.2} L${x + r * 1.2} ${y} L${x} ${y + r * 1.2} L${x - r * 1.2} ${y} Z`} {...stroke} />;
    default:
      return <circle cx={x} cy={y} r={r * 0.75} fill={fill} />;
  }
}

export function LandscapeFallback({
  layout,
  selectedId,
  hoveredId,
  category,
  spanDays,
  centerDay,
  onHover,
  onSelect,
}: {
  layout: Layout;
  selectedId: string | null;
  hoveredId: string | null;
  category: string | null;
  spanDays: number;
  centerDay: number;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string | null) => void;
}) {
  const W = 1000;
  const H = 600;
  const lanes = Math.max(layout.lanes.length, 1);
  // Window of days in view, following the same time framing as the 3D camera.
  const fromX = (centerDay - 1) * 0.62;
  const toX = fromX + (spanDays + 2) * 0.62;
  const px = (x: number, z: number) => 360 + ((x - fromX) / (toX - fromX)) * 560 - (z - layout.minZ) * 22;
  const py = (z: number, h = 0) => 500 - ((layout.maxZ - z) / Math.max(layout.maxZ - layout.minZ, 1)) * (lanes > 1 ? 240 : 0) - h * 44;
  const visible = (n: Node) => n.x >= fromX - 0.5 && n.x <= toX + 0.5;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" role="presentation">
      <rect width={W} height={H} fill="#0c0b0a" onClick={() => selectedId && onSelect?.(null)} />
      {layout.lanes.map((l) => (
        <line key={l.slug} x1={px(fromX, l.z)} y1={py(l.z)} x2={px(toX, l.z)} y2={py(l.z)} stroke={PAPER} strokeOpacity={category && category !== l.slug ? 0.05 : 0.15} />
      ))}
      {layout.weeks
        .filter((w) => w.x >= fromX && w.x <= toX)
        .map((w) => (
          <line key={w.x} x1={px(w.x, layout.maxZ)} y1={py(layout.maxZ)} x2={px(w.x, layout.minZ)} y2={py(layout.minZ)} stroke={PAPER} strokeOpacity={0.09} />
        ))}
      {layout.todayX >= fromX && <line x1={px(layout.todayX, layout.maxZ)} y1={py(layout.maxZ) + 8} x2={px(layout.todayX, layout.minZ)} y2={py(layout.minZ)} stroke={SIGNAL} strokeWidth={1.5} />}
      {layout.nodes.filter(visible).map((n) => {
        const isSel = n.id === selectedId;
        const isHover = n.id === hoveredId;
        const dim = (category !== null && n.category !== category) || (selectedId !== null && !isSel);
        const lit = isSel || isHover || (n.live && !selectedId);
        const opacity = dim ? 0.18 : n.state === 'closed' || n.state === 'ended' || n.state === 'cancelled' ? 0.5 : 1;
        const x = px(n.x, n.z);
        const top = py(n.z, n.h);
        const fill = lit ? SIGNAL : PAPER;
        return (
          <g
            key={n.id}
            opacity={isSel || isHover ? 1 : opacity}
            onMouseEnter={() => onHover?.(n.id)}
            onMouseLeave={() => onHover?.(null)}
            onClick={() => onSelect?.(isSel ? null : n.id)}
            style={{ cursor: 'pointer' }}
          >
            <rect x={x - 14} y={top - 16} width={28} height={py(n.z) - top + 22} fill="transparent" />
            <line x1={x} y1={py(n.z)} x2={x} y2={top} stroke={fill} strokeOpacity={0.6} />
            {n.mode === 'team' ? <circle cx={x} cy={py(n.z)} r={4} stroke={fill} fill="none" /> : <circle cx={x} cy={py(n.z)} r={2.5} fill={fill} />}
            <Shape form={n.form} x={x} y={top} r={isSel ? 9 : 6.5} fill={fill} />
            {n.state === 'full' && <rect x={x - 9} y={top - 16} width={18} height={2} fill={WARN} />}
            {isSel && <circle cx={x} cy={py(n.z)} r={12} stroke={SIGNAL} fill="none" />}
          </g>
        );
      })}
    </svg>
  );
}
