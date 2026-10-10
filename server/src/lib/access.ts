import type { FilterQuery, HydratedDocument, Types } from 'mongoose';
import type { StaffRole } from '@campusflow/shared';
import { Event, type IEvent } from '../models';
import { forbidden, notFound } from './errors';
import { oid } from './http';
import type { AuthUser } from '../middleware/auth';

export type AccessVia = 'admin' | 'owner' | 'organization' | StaffRole;

export interface EventAccess {
  canManage: boolean;
  canCheckIn: boolean;
  via: AccessVia | null;
}

const NONE: EventAccess = { canManage: false, canCheckIn: false, via: null };

type AccessFields = Pick<IEvent, 'createdBy' | 'organization' | 'staff'>;

/**
 * Event-scoped authorisation. Every privileged route resolves access through this function,
 * so a user cannot reach another organizer's records by changing an id in a request.
 *  - platform admins manage everything
 *  - the creator of an event manages it
 *  - organizers manage events of organizations they belong to
 *  - explicit staff assignments grant `manager` or `checkin` rights on one event
 */
export function eventAccess(user: AuthUser | undefined, event: AccessFields): EventAccess {
  if (!user) return NONE;
  if (user.role === 'admin') return { canManage: true, canCheckIn: true, via: 'admin' };
  if (event.createdBy && String(event.createdBy) === String(user._id)) return { canManage: true, canCheckIn: true, via: 'owner' };
  if (user.role === 'organizer' && user.organizations.some((o) => String(o) === String(event.organization))) {
    return { canManage: true, canCheckIn: true, via: 'organization' };
  }
  const staff = event.staff?.find((s) => String(s.user) === String(user._id));
  if (staff?.role === 'manager') return { canManage: true, canCheckIn: true, via: 'manager' };
  if (staff?.role === 'checkin') return { canManage: false, canCheckIn: true, via: 'checkin' };
  return NONE;
}

/**
 * Load an event and assert the caller's capability. Unpublished events the caller cannot
 * manage are reported as 404 so their existence is not revealed.
 */
export async function loadEventFor(
  user: AuthUser | undefined,
  eventId: unknown,
  need: 'view' | 'manage' | 'checkin',
): Promise<{ event: HydratedDocument<IEvent>; access: EventAccess }> {
  const event = await Event.findById(oid(eventId, 'Event'));
  if (!event) throw notFound('Event');
  const access = eventAccess(user, event);
  const publiclyVisible = event.status === 'published' || event.status === 'completed' || event.status === 'cancelled';
  if (need === 'view') {
    if (!publiclyVisible && !access.canManage && !access.canCheckIn) throw notFound('Event');
  } else if (need === 'manage' && !access.canManage) {
    throw publiclyVisible || access.canCheckIn ? forbidden('Only this event’s organizers can do that') : notFound('Event');
  } else if (need === 'checkin' && !access.canCheckIn) {
    throw publiclyVisible ? forbidden('You are not assigned to check-in for this event') : notFound('Event');
  }
  return { event, access };
}

/** Mongo filter selecting events the user may manage. */
export function managedEventFilter(user: AuthUser): FilterQuery<IEvent> {
  if (user.role === 'admin') return {};
  const or: FilterQuery<IEvent>[] = [
    { createdBy: user._id },
    { staff: { $elemMatch: { user: user._id, role: 'manager' } } },
  ];
  if (user.role === 'organizer' && user.organizations.length) or.push({ organization: { $in: user.organizations } });
  return { $or: or };
}

/** Mongo filter selecting events where the user may at least run check-in. */
export function staffEventFilter(user: AuthUser): FilterQuery<IEvent> {
  if (user.role === 'admin') return {};
  const or: FilterQuery<IEvent>[] = [{ createdBy: user._id }, { 'staff.user': user._id }];
  if (user.role === 'organizer' && user.organizations.length) or.push({ organization: { $in: user.organizations } });
  return { $or: or };
}

export async function managedEventIds(user: AuthUser): Promise<Types.ObjectId[]> {
  const rows = await Event.find(managedEventFilter(user)).select('_id').lean();
  return rows.map((r) => r._id);
}

export function canOrganize(user: AuthUser | undefined): boolean {
  return Boolean(user && (user.role === 'admin' || user.role === 'organizer'));
}
