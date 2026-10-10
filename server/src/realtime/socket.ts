import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { Event, User } from '../models';
import { eventAccess } from '../lib/access';
import { logger } from '../lib/logger';
import { SESSION_COOKIE, parseCookieHeader, resolveSession, type AuthUser } from '../middleware/auth';
import { attachIo, eventRoom, sessionRoom } from './bus';

type Ack = (res: { ok: boolean; error?: string }) => void;

/**
 * Real-time channel for live operations.
 *  - The handshake is authenticated with the same httpOnly session cookie as the API.
 *  - Foreign origins are refused (cross-site WebSocket hijacking).
 *  - Joining an event room requires check-in or management rights on that event,
 *    re-evaluated against the database on every subscribe.
 * Messages are invalidation hints; clients re-read authoritative state over HTTP,
 * including after every reconnect.
 */
export function initRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.webOrigins, credentials: true },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || env.webOrigins.includes(origin));
    },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookieHeader(socket.handshake.headers.cookie);
      const resolved = await resolveSession(cookies[SESSION_COOKIE]);
      if (!resolved) return next(new Error('unauthorized'));
      socket.data.userId = String(resolved.user._id);
      socket.data.sessionId = String(resolved.session._id);
      next();
    } catch (err) {
      logger.error('socket auth failed', { err });
      next(new Error('unavailable'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(sessionRoom(socket.data.sessionId as string));
    socket.on('subscribe', async (payload: { eventId?: unknown }, ack?: Ack) => {
      try {
        const eventId = typeof payload?.eventId === 'string' ? payload.eventId : '';
        if (!/^[a-f0-9]{24}$/i.test(eventId)) return ack?.({ ok: false, error: 'invalid_event' });
        const [user, event] = await Promise.all([
          User.findById(socket.data.userId).lean<AuthUser>(),
          Event.findById(new Types.ObjectId(eventId)).select('createdBy organization staff').lean(),
        ]);
        if (!user || !event || !eventAccess(user, event).canCheckIn) return ack?.({ ok: false, error: 'forbidden' });
        await socket.join(eventRoom(eventId));
        ack?.({ ok: true });
      } catch (err) {
        logger.error('socket subscribe failed', { err });
        ack?.({ ok: false, error: 'unavailable' });
      }
    });
    socket.on('unsubscribe', async (payload: { eventId?: unknown }) => {
      if (typeof payload?.eventId === 'string') await socket.leave(eventRoom(payload.eventId));
    });
  });

  attachIo(io);
  return io;
}
