import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { formatInZone, zonedInputToUtc, type EventSummaryDTO, type Page } from '@campusflow/shared';
import { api } from '../../../lib/api';
import { buildLayout, STATE_LABEL, type Layout, type Node } from '../../../three/layout';

export const SPANS = [
  { days: 14, label: '2 wk' },
  { days: 28, label: '4 wk' },
  { days: 90, label: '3 mo' },
] as const;

const PAGE = 60;

export interface UniverseState {
  events: EventSummaryDTO[];
  total: number;
  status: 'loading' | 'error' | 'ready';
  refetch: () => void;
  layout: Layout;
  selected: Node | null;
  selectedEvent: EventSummaryDTO | null;
  hoveredId: string | null;
  setHovered: (id: string | null) => void;
  select: (id: string | null) => void;
  step: (dir: 1 | -1) => void;
  centerDay: number;
  spanDays: number;
  setSpan: (days: number) => void;
  shiftWindow: (dir: 1 | -1) => void;
  goToday: () => void;
  goToDate: (yyyyMmDd: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  announcement: string;
}

/**
 * Everything the homepage stage needs: the real event list, its spatial layout, the
 * selection, the time window being viewed, and keyboard navigation. Shared by the WebGL
 * scene, the 2D fallback, the time rail and the panel so they always agree.
 */
export function useUniverse(tz: string, category: string | null, setCategory: (slug: string | null) => void): UniverseState {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['events', 'landscape'],
    queryFn: () => api<Page<EventSummaryDTO>>('/events', { query: { pageSize: PAGE, when: 'upcoming' } }),
    staleTime: 60_000,
  });
  const events = useMemo(() => q.data?.items ?? [], [q.data]);

  const layout = useMemo(() => {
    const now = Date.now();
    const dayStart = zonedInputToUtc(`${formatInZone(now, tz, 'yyyy-MM-dd')}T00:00`, tz).getTime();
    return buildLayout(events, now, dayStart, (d) => formatInZone(d, tz, 'd MMM'));
  }, [events, tz]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHovered] = useState<string | null>(null);
  const [centerDay, setCenterDay] = useState(0);
  const [spanDays, setSpanDays] = useState<number>(28);

  const selected = layout.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedEvent = selected ? (events.find((e) => e.id === selected.id) ?? null) : null;

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const node = layout.nodes.find((n) => n.id === id);
      // Keep the time window around the selection so "back to overview" lands nearby.
      if (node) setCenterDay((c) => (node.day < c || node.day > c + spanDays * 0.8 ? Math.max(0, Math.floor(node.day) - 2) : c));
    },
    [layout, spanDays],
  );

  const pool = useCallback(() => layout.nodes.filter((n) => !category || n.category === category), [layout, category]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const list = pool();
      if (!list.length) return;
      const current = list.findIndex((n) => n.id === selectedId);
      let next: Node | undefined;
      if (current >= 0) next = list[current + dir];
      else next = dir === 1 ? (list.find((n) => n.day >= centerDay - 0.5) ?? list[list.length - 1]) : [...list].reverse().find((n) => n.day < centerDay + spanDays) ?? list[0];
      if (next) select(next.id);
    },
    [pool, selectedId, centerDay, spanDays, select],
  );

  const goToday = useCallback(() => {
    setSelectedId(null);
    setCenterDay(0);
  }, []);

  const goToDate = useCallback(
    (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
      const ms = zonedInputToUtc(`${value}T00:00`, tz).getTime();
      const day = Math.round((ms - layout.startOfToday) / 86_400_000);
      setSelectedId(null);
      setCenterDay(Math.max(0, day));
    },
    [tz, layout.startOfToday],
  );

  const shiftWindow = useCallback(
    (dir: 1 | -1) => {
      setSelectedId(null);
      setCenterDay((c) => Math.max(0, c + dir * Math.max(7, Math.round(spanDays / 2))));
    },
    [spanDays],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const lanes = layout.lanes.map((l) => l.slug);
      switch (e.key) {
        case 'ArrowRight':
          step(1);
          break;
        case 'ArrowLeft':
          step(-1);
          break;
        case 'ArrowDown':
        case 'ArrowUp': {
          if (!lanes.length) return;
          const i = category ? lanes.indexOf(category) : -1;
          const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
          setSelectedId(null);
          setCategory(next < 0 || next >= lanes.length ? null : lanes[next]!);
          break;
        }
        case 'Enter':
          if (selected) navigate(`/events/${selected.slug}`);
          else step(1);
          break;
        case 'Escape':
          if (!selectedId) return;
          setSelectedId(null);
          break;
        case 'Home':
        case 't':
        case 'T':
          goToday();
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [layout.lanes, step, category, setCategory, selected, selectedId, navigate, goToday],
  );

  const announcement = selected
    ? `${selected.title}. ${selected.categoryName}. ${formatInZone(selected.startsAt, tz, 'EEEE d MMMM, HH:mm')}. ${STATE_LABEL[selected.state]}. Press Enter to open, Escape to return.`
    : category
      ? `Showing ${layout.lanes.find((l) => l.slug === category)?.name ?? category} events.`
      : '';

  return {
    events,
    total: q.data?.total ?? 0,
    status: q.isError ? 'error' : q.isPending ? 'loading' : 'ready',
    refetch: () => void q.refetch(),
    layout,
    selected,
    selectedEvent,
    hoveredId,
    setHovered,
    select,
    step,
    centerDay,
    spanDays,
    setSpan: (d) => {
      setSpanDays(d);
      setSelectedId(null);
    },
    shiftWindow,
    goToday,
    goToDate,
    onKeyDown,
    announcement,
  };
}
