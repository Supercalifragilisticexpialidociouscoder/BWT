import { Router } from 'express';
import {
  AllocateVenueSchema,
  PlanAllocationsSchema,
  RangeQuerySchema,
  SuggestVenueSchema,
  VenueInputSchema,
} from '@campusflow/shared';
import { Event, Venue, VenueAllocation } from '../../models';
import { audit } from '../../lib/audit';
import { forbidden, notFound } from '../../lib/errors';
import { oid, parse, requireUser } from '../../lib/http';
import { canOrganize, eventAccess, loadEventFor } from '../../lib/access';
import { requireAuth, requireRole } from '../../middleware/auth';
import { getInstitution } from '../institution/service';
import { eventDetailDTO } from '../events/service';
import {
  allocateManually,
  bookVenue,
  calendar,
  createVenue,
  loadBookings,
  planForEvents,
  suggestForEvent,
  updateVenue,
  venueDTO,
} from './service';

export const venuesRouter = Router();

venuesRouter.get('/venues', requireAuth, async (req, res) => {
  const user = requireUser(req);
  if (!canOrganize(user)) {
    const assigned = await Event.exists({ 'staff.user': user._id });
    if (!assigned) throw forbidden();
  }
  const inst = await getInstitution();
  const venues = await Venue.find({ institution: inst._id }).sort({ building: 1, name: 1 }).lean();
  res.json(venues.map(venueDTO));
});

venuesRouter.post('/venues', requireRole('admin'), async (req, res) => {
  const user = requireUser(req);
  const input = parse(VenueInputSchema, req.body);
  const venue = await createVenue(user, input);
  res.status(201).json(venueDTO(venue.toObject()));
});

venuesRouter.put('/venues/:id', requireRole('admin'), async (req, res) => {
  const user = requireUser(req);
  const venue = await Venue.findById(oid(req.params.id, 'Venue'));
  if (!venue) throw notFound('Venue');
  const input = parse(VenueInputSchema, req.body);
  const updated = await updateVenue(user, venue, input);
  res.json(venueDTO(updated.toObject()));
});

venuesRouter.get('/venues/:id/schedule', requireAuth, async (req, res) => {
  const range = parse(RangeQuerySchema, req.query);
  const venue = await Venue.findById(oid(req.params.id, 'Venue')).lean();
  if (!venue) throw notFound('Venue');
  const bookings = await loadBookings(new Date(range.from), new Date(range.to), [venue._id]);
  res.json({ venue: venueDTO(venue), bookings });
});

/** Calendar is visible to everyone for published events; organizers also see their drafts. */
venuesRouter.get('/calendar', async (req, res) => {
  const range = parse(RangeQuerySchema, { from: req.query.from, to: req.query.to });
  const venueId = typeof req.query.venue === 'string' && req.query.venue ? oid(req.query.venue, 'Venue') : undefined;
  res.json(await calendar(req.user, new Date(range.from), new Date(range.to), venueId));
});

venuesRouter.post('/events/:id/allocations', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const input = parse(AllocateVenueSchema, req.body);
  const result = await allocateManually(user, event, oid(input.venueId, 'Venue'), input.status);
  res.status(201).json({ warnings: result.warnings, event: await eventDetailDTO(event.toObject(), user) });
});

venuesRouter.post('/events/:id/allocations/suggest', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const input = parse(SuggestVenueSchema, req.body ?? {});
  res.json(await suggestForEvent(event.toObject(), input));
});

venuesRouter.post('/allocations/plan', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { eventIds } = parse(PlanAllocationsSchema, req.body);
  const events = [];
  for (const id of eventIds) {
    const { event } = await loadEventFor(user, id, 'manage');
    if (event.status !== 'cancelled') events.push(event.toObject());
  }
  if (!events.length) {
    res.json([]);
    return;
  }
  res.json(await planForEvents(user, events));
});

async function loadAllocationForManager(user: ReturnType<typeof requireUser>, id: unknown) {
  const allocation = await VenueAllocation.findById(oid(id, 'Allocation')).lean();
  if (!allocation) throw notFound('Allocation');
  const event = await Event.findById(allocation.event).lean();
  if (!event || !eventAccess(user, event).canManage) throw notFound('Allocation');
  return { allocation, event };
}

venuesRouter.post('/allocations/:id/confirm', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { allocation, event } = await loadAllocationForManager(user, req.params.id);
  // Re-check conflicts at approval time; proposals can go stale.
  await bookVenue({
    event,
    venueId: allocation.venue,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    status: 'confirmed',
    actor: user._id,
    reason: allocation.reason,
  });
  await VenueAllocation.deleteMany({ event: event._id, status: 'proposed', _id: { $ne: allocation._id } });
  await audit({ actor: user._id, action: 'venue.confirmed', entityType: 'VenueAllocation', entityId: allocation._id, event: event._id, summary: `Venue proposal approved for “${event.title}”` });
  res.json(await eventDetailDTO((await Event.findById(event._id).lean())!, user));
});

venuesRouter.delete('/allocations/:id', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { allocation, event } = await loadAllocationForManager(user, req.params.id);
  await VenueAllocation.deleteOne({ _id: allocation._id });
  await Venue.updateOne({ _id: allocation.venue }, { $inc: { bookingVersion: 1 } });
  await audit({ actor: user._id, action: 'venue.released', entityType: 'VenueAllocation', entityId: allocation._id, event: event._id, summary: `Venue released for “${event.title}”` });
  res.json(await eventDetailDTO(event, user));
});
