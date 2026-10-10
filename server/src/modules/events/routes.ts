import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { Types, type FilterQuery } from 'mongoose';
import {
  EventInputSchema,
  EventListQuerySchema,
  EventStatusChangeSchema,
  StaffAssignmentSchema,
  type AuditEntryDTO,
  type Page,
  type EventSummaryDTO,
  type WorkspaceEventDTO,
} from '@campusflow/shared';
import { env } from '../../config/env';
import { AuditLog, CheckIn, Event, PaymentRecord, Registration, Ticket, User, type IEvent } from '../../models';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { escapeRegex, parse, requireUser } from '../../lib/http';
import { eventAccess, loadEventFor, staffEventFilter } from '../../lib/access';
import { audit } from '../../lib/audit';
import { requireAuth } from '../../middleware/auth';
import { overview } from '../reports/service';
import {
  buildSummaryContext,
  changeEventStatus,
  createEvent,
  eventDetailDTO,
  eventSummaryDTO,
  setEventStaff,
  updateEvent,
} from './service';

export const eventsRouter = Router();

/* ---------------------------------------------------------------- public discovery */

eventsRouter.get('/events', async (req, res) => {
  const q = parse(EventListQuerySchema, req.query);
  const now = new Date();
  const filter: FilterQuery<IEvent> = {};
  if (q.when === 'past') Object.assign(filter, { status: { $in: ['published', 'completed'] }, endsAt: { $lt: now } });
  else if (q.when === 'upcoming') Object.assign(filter, { status: 'published', endsAt: { $gte: now } });
  else Object.assign(filter, { status: { $in: ['published', 'completed'] } });
  if (q.category) filter.category = q.category;
  if (q.mode) filter.mode = q.mode;
  if (q.from || q.to) {
    filter.startsAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lt: new Date(q.to) } : {}) };
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ title: rx }, { summary: rx }, { category: rx }];
  }
  if (q.availability === 'open') {
    Object.assign(filter, {
      registrationDeadline: { $gte: now },
      $and: [
        { $or: [{ registrationOpensAt: null }, { registrationOpensAt: { $lte: now } }] },
        { $expr: { $or: [{ $eq: ['$capacity', null] }, { $lt: ['$counters.activeRegistrations', '$capacity'] }] } },
      ],
    });
  }
  const [events, total] = await Promise.all([
    Event.find(filter)
      .sort(q.when === 'past' ? { startsAt: -1 } : { startsAt: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Event.countDocuments(filter),
  ]);
  const ctx = await buildSummaryContext(events);
  const body: Page<EventSummaryDTO> = { items: events.map((e) => eventSummaryDTO(e, ctx, now)), page: q.page, pageSize: q.pageSize, total };
  res.json(body);
});

eventsRouter.get('/events/:ref', async (req, res) => {
  const ref = req.params.ref;
  const event = /^[a-f0-9]{24}$/i.test(ref) ? await Event.findById(ref).lean() : await Event.findOne({ slug: ref.toLowerCase() }).lean();
  if (!event) throw notFound('Event');
  const access = eventAccess(req.user, event);
  if (event.status === 'draft' && !access.canManage && !access.canCheckIn) throw notFound('Event');
  res.json(await eventDetailDTO(event, req.user));
});

/* ---------------------------------------------------------------- management */

eventsRouter.post('/events', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const input = parse(EventInputSchema, req.body);
  const event = await createEvent(user, input);
  res.status(201).json(await eventDetailDTO(event.toObject(), user));
});

eventsRouter.put('/events/:id', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const input = parse(EventInputSchema, req.body);
  const updated = await updateEvent(user, event, input);
  res.json(await eventDetailDTO(updated.toObject(), user));
});

eventsRouter.post('/events/:id/status', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const { status } = parse(EventStatusChangeSchema, req.body);
  const updated = await changeEventStatus(user, event, status);
  res.json(await eventDetailDTO(updated.toObject(), user));
});

eventsRouter.put('/events/:id/staff', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const { staff } = parse(StaffAssignmentSchema, req.body);
  const updated = await setEventStaff(user, event, staff);
  res.json(await eventDetailDTO(updated.toObject(), user));
});

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_TYPES),
});

/** Check magic bytes so a renamed file cannot masquerade as an image. */
function sniffImage(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

eventsRouter.post('/events/:id/cover', requireAuth, coverUpload.single('cover'), async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  if (!req.file) throw badRequest('Attach a JPEG, PNG or WebP image under 3 MB');
  const type = sniffImage(req.file.buffer);
  if (!type) throw badRequest('That file is not a valid JPEG, PNG or WebP image');
  const dir = path.resolve(env.UPLOAD_DIR, 'covers');
  await mkdir(dir, { recursive: true });
  const name = `${event._id}-${randomBytes(6).toString('hex')}${IMAGE_TYPES[type]}`;
  await writeFile(path.join(dir, name), req.file.buffer);
  const previous = event.coverPath;
  event.coverPath = `covers/${name}`;
  await event.save();
  if (previous) await unlink(path.resolve(env.UPLOAD_DIR, previous)).catch(() => undefined);
  await audit({ actor: user._id, action: 'event.cover_updated', entityType: 'Event', entityId: event._id, event: event._id, summary: 'Cover image replaced' });
  res.json(await eventDetailDTO(event.toObject(), user));
});

eventsRouter.delete('/events/:id/cover', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  if (event.coverPath) await unlink(path.resolve(env.UPLOAD_DIR, event.coverPath)).catch(() => undefined);
  event.coverPath = null;
  await event.save();
  res.json(await eventDetailDTO(event.toObject(), user));
});

eventsRouter.get('/events/:id/audit', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const rows = await AuditLog.find({ event: event._id }).sort({ at: -1 }).limit(200).lean();
  const actors = await User.find({ _id: { $in: rows.map((r) => r.actor).filter(Boolean) } }).select('name').lean();
  const byId = new Map(actors.map((a) => [String(a._id), a.name]));
  const out: AuditEntryDTO[] = rows.map((r) => ({
    id: String(r._id),
    at: r.at.toISOString(),
    actor: r.actor ? { id: String(r.actor), name: byId.get(String(r.actor)) ?? 'Unknown' } : null,
    action: r.action,
    entityType: r.entityType,
    entityId: String(r.entityId),
    summary: r.summary,
    meta: r.meta ?? {},
  }));
  res.json(out);
});

/* ---------------------------------------------------------------- workspace */

eventsRouter.get('/workspace/events', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const events = await Event.find(staffEventFilter(user)).sort({ startsAt: -1 }).limit(300).lean();
  if (!events.length && user.role === 'participant') {
    res.json([]);
    return;
  }
  const ids = events.map((e) => e._id);
  const [regs, confirmed, tickets, pending, checkins] = await Promise.all([
    Registration.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { event: { $in: ids }, status: { $nin: ['cancelled', 'rejected'] } } }, { $group: { _id: '$event', n: { $sum: 1 } } }]),
    Registration.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { event: { $in: ids }, status: 'confirmed' } }, { $group: { _id: '$event', n: { $sum: 1 } } }]),
    Ticket.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { event: { $in: ids }, live: true } }, { $group: { _id: '$event', n: { $sum: 1 } } }]),
    PaymentRecord.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { event: { $in: ids }, status: 'pending', required: true, reference: { $ne: null } } },
      { $group: { _id: '$event', n: { $sum: 1 } } },
    ]),
    CheckIn.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { event: { $in: ids }, active: true } }, { $group: { _id: '$event', n: { $sum: 1 } } }]),
  ]);
  const m = (rows: { _id: Types.ObjectId; n: number }[]) => new Map(rows.map((r) => [String(r._id), r.n]));
  const [mr, mc, mt, mp, mk] = [m(regs), m(confirmed), m(tickets), m(pending), m(checkins)];
  const ctx = await buildSummaryContext(events);
  const out: WorkspaceEventDTO[] = events.map((e) => {
    const access = eventAccess(user, e);
    const id = String(e._id);
    return {
      ...eventSummaryDTO(e, ctx),
      counts: { registrations: mr.get(id) ?? 0, confirmed: mc.get(id) ?? 0, participants: mt.get(id) ?? 0, pendingPayments: mp.get(id) ?? 0, checkedIn: mk.get(id) ?? 0 },
      access: access.via === 'checkin' || access.via === 'manager' ? access.via : access.via === 'admin' ? 'admin' : access.via === 'organization' ? 'organization' : 'owner',
      usesDocuments: Boolean(e.participation?.approvalRequired || e.documentRequirements?.some((r) => r.active)),
    };
  });
  res.json(out);
});

eventsRouter.get('/workspace/overview', requireAuth, async (req, res) => {
  const user = requireUser(req);
  if (typeof req.query.event === 'string' && req.query.event) {
    const { event } = await loadEventFor(user, req.query.event, 'manage');
    res.json(await overview(user, event.toObject()));
    return;
  }
  if (user.role === 'participant') {
    const managesAny = await Event.exists({ staff: { $elemMatch: { user: user._id, role: 'manager' } } });
    if (!managesAny) throw forbidden('The organizer overview is for event organizers');
  }
  res.json(await overview(user));
});
