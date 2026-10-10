import type { Server } from 'socket.io';

/**
 * Thin indirection so services can publish without importing Socket.IO setup.
 * Services call `publish` only after the database write has succeeded; clients treat
 * messages as invalidation hints and re-read authoritative state over HTTP.
 */
let io: Server | null = null;

export function attachIo(server: Server | null) {
  io = server;
}

export const eventRoom = (eventId: string) => `event:${eventId}`;

export type RealtimeMessage =
  | { type: 'checkin.created'; checkInId: string; at: string; participantName: string; teamName: string | null; method: string }
  | { type: 'checkin.voided'; checkInId: string }
  | { type: 'registration.changed'; registrationId: string; status: string }
  | { type: 'payment.changed'; registrationId: string; status: string };

export function publish(eventId: string, message: RealtimeMessage) {
  io?.to(eventRoom(eventId)).emit('event:update', { eventId, ...message, sentAt: new Date().toISOString() });
}
