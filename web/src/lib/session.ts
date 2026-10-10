import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { SessionDTO } from '@campusflow/shared';
import { api, errorMessage } from './api';
import { useToast } from '../components/ui/Toast';

export const sessionKey = ['session'] as const;

/** Client-side session state: the server's DTO, plus whether this browser ended it on purpose. */
type SessionState = SessionDTO & { endedHere?: boolean };

const SIGNED_OUT: SessionState = { user: null, access: { isAdmin: false, canOrganize: false, staffEvents: [] }, endedHere: true };

/** Query roots that carry no personal data. Everything else was fetched as a particular user. */
const ANONYMOUS_ROOTS = new Set<unknown>(['session', 'institution']);
const isPersonal = (q: { queryKey: readonly unknown[] }) => !ANONYMOUS_ROOTS.has(q.queryKey[0]);

/** Drop every cached response fetched as the previous user (event pages included — they embed `viewer`). */
export function forgetPersonalData(qc: QueryClient) {
  qc.removeQueries({ predicate: isPersonal });
}

/**
 * Mark the session as ended in this tab.
 *
 * `setQueryData` notifies every mounted `useSession` synchronously with the render cycle, so headers,
 * sidebars and `RequireAuth` all update at once. (Removing the session query instead — `qc.clear()` —
 * drops it without notifying anyone, which left the signed-in UI on screen after sign-out.)
 */
export async function endLocalSession(qc: QueryClient) {
  // A session refetch that started before logout must not land afterwards and resurrect the user.
  await qc.cancelQueries({ queryKey: sessionKey });
  qc.setQueryData<SessionState>(sessionKey, SIGNED_OUT);
  forgetPersonalData(qc);
}

const CHANNEL = 'campusflow-session';

export function useSession() {
  const q = useQuery<SessionState>({ queryKey: sessionKey, queryFn: () => api<SessionDTO>('/auth/session'), staleTime: 60_000 });
  const s = q.data;
  return {
    ...q,
    user: s?.user ?? null,
    access: s?.access ?? { isAdmin: false, canOrganize: false, staffEvents: [] },
    /** True right after the user signed out in this browser (as opposed to an expired session). */
    endedHere: Boolean(s?.endedHere),
    /** True for organizers, admins, and anyone holding a staff assignment. */
    hasWorkspace: Boolean(s?.user && (s.access.canOrganize || s.access.staffEvents.length > 0)),
    managesAny: Boolean(s?.user && (s.access.canOrganize || s.access.staffEvents.some((e) => e.role !== 'checkin'))),
  };
}

/**
 * Keeps the cache consistent with who is signed in. Mounted once, in App.
 *  - When the user changes for any reason (sign-out, expiry, a different account), personal data cached
 *    for the previous user is dropped.
 *  - A sign-out in another tab signs this tab out too (the cookie is shared, so its session is gone).
 */
export function useSessionGuard(userId: string | null | undefined) {
  const qc = useQueryClient();
  const previous = useRef(userId);
  useEffect(() => {
    if (previous.current !== undefined && previous.current !== userId) forgetPersonalData(qc);
    previous.current = userId;
  }, [qc, userId]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === 'signed-out' && qc.getQueryData<SessionState>(sessionKey)?.user) void endLocalSession(qc);
    };
    return () => channel.close();
  }, [qc]);
}

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    if (pending) return;
    setPending(true);
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (err) {
      // The server still holds the session, so don't pretend the user is signed out.
      setPending(false);
      toast({ tone: 'bad', title: 'Couldn’t sign out', body: errorMessage(err) });
      return;
    }
    await endLocalSession(qc);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage({ type: 'signed-out' });
      channel.close();
    }
    setPending(false);
    navigate('/', { replace: true });
    toast({ tone: 'info', title: 'Signed out' });
  };

  return { signOut, pending };
}
