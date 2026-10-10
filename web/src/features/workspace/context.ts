import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { WorkspaceEventDTO } from '@campusflow/shared';
import { api } from '../../lib/api';

const LAST_KEY = 'cf.workspace.event';

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
function writeLast(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* storage unavailable: the URL still carries the selection */
  }
}

export function useWorkspaceEvents() {
  return useQuery({ queryKey: ['workspace', 'events'], queryFn: () => api<WorkspaceEventDTO[]>('/workspace/events'), staleTime: 20_000 });
}

/** Default event: the one happening now, else the next upcoming, else the most recent. */
export function defaultEvent(events: WorkspaceEventDTO[], manageOnly = false): WorkspaceEventDTO | undefined {
  const list = events.filter((e) => e.status !== 'cancelled' && (!manageOnly || e.access !== 'checkin'));
  const now = Date.now();
  const live = list.find((e) => new Date(e.startsAt).getTime() <= now && new Date(e.endsAt).getTime() > now);
  if (live) return live;
  const upcoming = list.filter((e) => new Date(e.startsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return upcoming[0] ?? list[0];
}

/**
 * The event a workspace page is scoped to. Kept in `?event=` so views are linkable,
 * remembered per browser as a convenience.
 */
export function useWorkspaceEvent(options: { manageOnly?: boolean } = {}) {
  const events = useWorkspaceEvents();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('event');
  const list = useMemo(() => (events.data ?? []).filter((e) => !options.manageOnly || e.access !== 'checkin'), [events.data, options.manageOnly]);
  const selected = useMemo(() => {
    if (!list.length) return undefined;
    return list.find((e) => e.id === fromUrl) ?? list.find((e) => e.id === readLast()) ?? defaultEvent(list, options.manageOnly);
  }, [list, fromUrl, options.manageOnly]);

  useEffect(() => {
    if (selected) writeLast(selected.id);
    if (selected && fromUrl !== selected.id) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('event', selected.id);
          return next;
        },
        { replace: true },
      );
    }
  }, [selected, fromUrl, setParams]);

  const select = useCallback(
    (id: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('event', id);
          next.delete('page');
          return next;
        },
        { replace: false },
      ),
    [setParams],
  );

  return { events: list, event: selected, select, isPending: events.isPending, error: events.error };
}
