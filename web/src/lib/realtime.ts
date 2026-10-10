import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export type ChannelState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'forbidden';

export interface EventUpdate {
  eventId: string;
  type: 'checkin.created' | 'checkin.voided' | 'registration.changed' | 'payment.changed';
  sentAt: string;
  [k: string]: unknown;
}

let shared: Socket | null = null;
let users = 0;

function getSocket(): Socket {
  if (!shared) {
    shared = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 });
  }
  users++;
  return shared;
}

function releaseSocket() {
  users--;
  if (users <= 0 && shared) {
    shared.disconnect();
    shared = null;
    users = 0;
  }
}

/**
 * Subscribe to an event's live channel. `onUpdate` receives invalidation hints; `onResync`
 * fires after every (re)connection so callers refetch authoritative state from the API.
 */
export function useEventChannel(eventId: string | undefined, handlers: { onUpdate?: (u: EventUpdate) => void; onResync?: () => void }) {
  const [state, setState] = useState<ChannelState>('connecting');
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!eventId) return;
    const socket = getSocket();
    let disposed = false;

    const subscribe = () => {
      socket.emit('subscribe', { eventId }, (res: { ok: boolean; error?: string }) => {
        if (disposed) return;
        if (res?.ok) {
          setState('live');
          ref.current.onResync?.();
        } else setState(res?.error === 'forbidden' ? 'forbidden' : 'offline');
      });
    };
    const onConnect = () => subscribe();
    const onDisconnect = () => !disposed && setState('reconnecting');
    const onError = () => !disposed && setState((s) => (s === 'live' || s === 'reconnecting' ? 'reconnecting' : 'offline'));
    const onUpdate = (u: EventUpdate) => {
      if (u.eventId === eventId) ref.current.onUpdate?.(u);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);
    socket.on('event:update', onUpdate);
    if (socket.connected) subscribe();

    return () => {
      disposed = true;
      socket.emit('unsubscribe', { eventId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onError);
      socket.off('event:update', onUpdate);
      releaseSocket();
    };
  }, [eventId]);

  return state;
}
