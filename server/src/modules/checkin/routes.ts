import { Router } from 'express';
import { CheckInSchema, LookupQuerySchema, VoidCheckInSchema } from '@campusflow/shared';
import { Event } from '../../models';
import { notFound } from '../../lib/errors';
import { oid, parse, requireUser } from '../../lib/http';
import { eventAccess, loadEventFor } from '../../lib/access';
import { requireAuth } from '../../middleware/auth';
import { checkInLimiter } from '../../middleware/security';
import { checkInRows, ensureCheckInBelongs, liveStats, lookupTickets, performCheckIn, voidCheckIn } from './service';

export const checkinRouter = Router();

checkinRouter.post('/events/:id/checkins', requireAuth, checkInLimiter, async (req, res) => {
  const staff = requireUser(req);
  const { event } = await loadEventFor(staff, req.params.id, 'checkin');
  const input = parse(CheckInSchema, req.body);
  const result = await performCheckIn({
    event: event.toObject(),
    staff,
    token: input.token,
    ticketId: input.ticketId ? oid(input.ticketId, 'Ticket') : undefined,
  });
  res.status(result.httpStatus).json(result.body);
});

checkinRouter.get('/events/:id/checkins', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'checkin');
  const includeVoided = req.query.include === 'voided';
  res.json(await checkInRows({ event: event._id, ...(includeVoided ? {} : { active: true }) }, 500));
});

checkinRouter.post('/checkins/:id/void', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const record = await ensureCheckInBelongs(oid(req.params.id, 'Check-in'));
  const event = await Event.findById(record.event).lean();
  if (!event || !eventAccess(user, event).canManage) throw notFound('Check-in');
  const { reason } = parse(VoidCheckInSchema, req.body);
  await voidCheckIn(user, record._id, reason);
  const [row] = await checkInRows({ _id: record._id }, 1);
  res.json(row);
});

checkinRouter.get('/events/:id/lookup', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'checkin');
  const { q } = parse(LookupQuerySchema, req.query);
  res.json(await lookupTickets(event._id, q));
});

checkinRouter.get('/events/:id/live', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'checkin');
  res.json(await liveStats(event.toObject()));
});
