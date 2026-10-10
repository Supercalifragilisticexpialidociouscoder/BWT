import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionDTO } from '@campusflow/shared';
import { api } from './api';

export const sessionKey = ['session'] as const;

export function useSession() {
  const q = useQuery({ queryKey: sessionKey, queryFn: () => api<SessionDTO>('/auth/session'), staleTime: 60_000 });
  const s = q.data;
  return {
    ...q,
    user: s?.user ?? null,
    access: s?.access ?? { isAdmin: false, canOrganize: false, staffEvents: [] },
    /** True for organizers, admins, and anyone holding a staff assignment. */
    hasWorkspace: Boolean(s?.user && (s.access.canOrganize || s.access.staffEvents.length > 0)),
    managesAny: Boolean(s?.user && (s.access.canOrganize || s.access.staffEvents.some((e) => e.role !== 'checkin'))),
  };
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    await qc.invalidateQueries({ queryKey: sessionKey });
  };
}
