import type { EventSummaryDTO } from '@campusflow/shared';
import { categoryForm, type Form } from '../lib/categories';

/**
 * Spatial layout of the event landscape, shared by the WebGL scene and the 2D fallback:
 *   x — start time (one unit per DAY, today's midnight at 0, institution timezone)
 *   z — category lane
 *   h — beacon height ∝ √(active registrations), so the tallest is the busiest
 * Placement depends only on the data, so it is stable as the dataset changes.
 */
export const DAY = 0.62;
export const LANE = 1.25;
const DAY_MS = 86_400_000;

export type NodeState = 'live' | 'open' | 'full' | 'not_yet_open' | 'closed' | 'ended' | 'cancelled';

export interface Node {
  id: string;
  index: number; // chronological order
  slug: string;
  title: string;
  category: string;
  categoryName: string;
  form: Form;
  mode: 'individual' | 'team';
  startsAt: string;
  endsAt: string;
  registrations: number;
  state: NodeState;
  live: boolean;
  isDemo: boolean;
  x: number;
  z: number;
  h: number;
  lane: number;
  day: number;
}

export interface Layout {
  nodes: Node[];
  lanes: { slug: string; name: string; z: number; form: Form; count: number }[];
  todayX: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  startOfToday: number;
  weeks: { x: number; day: number; label: string }[];
}

function stateOf(e: EventSummaryDTO, now: number): NodeState {
  const live = new Date(e.startsAt).getTime() <= now && new Date(e.endsAt).getTime() > now && e.status !== 'cancelled';
  if (live) return 'live';
  switch (e.registrationState) {
    case 'open':
      return 'open';
    case 'full':
      return 'full';
    case 'not_yet_open':
      return 'not_yet_open';
    case 'cancelled':
      return 'cancelled';
    case 'ended':
      return 'ended';
    default:
      return 'closed';
  }
}

export function buildLayout(events: EventSummaryDTO[], now: number, startOfToday: number, formatWeek: (d: Date) => string): Layout {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  // Lanes in a stable order (alphabetical by category) so filtering never reshuffles rows.
  const cats = new Map<string, { slug: string; name: string; count: number }>();
  for (const e of [...sorted].sort((a, b) => a.category.localeCompare(b.category))) {
    const c = cats.get(e.category) ?? { slug: e.category, name: e.categoryName, count: 0 };
    c.count++;
    cats.set(e.category, c);
  }
  const laneList = [...cats.values()];
  const laneZ = (i: number) => (i - (laneList.length - 1) / 2) * LANE;
  const maxReg = Math.max(1, ...events.map((e) => e.activeRegistrations));

  const slots = new Map<string, number>();
  const nodes: Node[] = sorted.map((e, index) => {
    const start = new Date(e.startsAt).getTime();
    const day = Math.max(-1, (start - startOfToday) / DAY_MS);
    const lane = laneList.findIndex((c) => c.slug === e.category);
    // Events in the same lane within ~2 hours of each other share a slot: fan them out
    // across the lane deterministically (in chronological order) so beacons never overlap.
    const slotKey = `${lane}:${Math.round(day * 12)}`;
    const k = slots.get(slotKey) ?? 0;
    slots.set(slotKey, k + 1);
    const spread = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.min(0.42, 0.16 * Math.ceil(k / 2));
    const state = stateOf(e, now);
    return {
      id: e.id,
      index,
      slug: e.slug,
      title: e.title,
      category: e.category,
      categoryName: e.categoryName,
      form: categoryForm(e.category, e.categoryName),
      mode: e.mode,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      registrations: e.activeRegistrations,
      state,
      live: state === 'live',
      isDemo: e.isDemo,
      x: day * DAY,
      z: laneZ(lane) + spread,
      h: 0.45 + Math.sqrt(e.activeRegistrations / maxReg) * 2.4,
      lane,
      day,
    };
  });

  const xs = nodes.map((n) => n.x);
  const minX = Math.min(-1 * DAY, ...xs);
  const maxX = Math.max(21 * DAY, ...xs);
  const weeks: Layout['weeks'] = [];
  for (let d = 0; d * DAY <= maxX + DAY; d += 7) {
    weeks.push({ x: d * DAY, day: d, label: d === 0 ? 'Today' : formatWeek(new Date(startOfToday + d * DAY_MS)) });
  }
  return {
    nodes,
    lanes: laneList.map((c, i) => ({ ...c, z: laneZ(i), form: categoryForm(c.slug, c.name) })),
    todayX: ((now - startOfToday) / DAY_MS) * DAY,
    minX,
    maxX,
    minZ: laneList.length ? laneZ(0) : -LANE / 2,
    maxZ: laneList.length ? laneZ(laneList.length - 1) : LANE / 2,
    startOfToday,
    weeks,
  };
}

export const STATE_LABEL: Record<NodeState, string> = {
  live: 'Happening now',
  open: 'Registration open',
  full: 'Full',
  not_yet_open: 'Opens soon',
  closed: 'Registration closed',
  ended: 'Ended',
  cancelled: 'Cancelled',
};
