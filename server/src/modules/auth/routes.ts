import { Router } from 'express';
import {
  ChangePasswordSchema,
  LoginSchema,
  ProfileUpdateSchema,
  SignupSchema,
  type SessionDTO,
  type StaffEventRef,
  type UserDTO,
} from '@campusflow/shared';
import { Event, Session, User, type IUser } from '../../models';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { AppError, conflict, unauthorized } from '../../lib/errors';
import { parse, requireUser } from '../../lib/http';
import { eventAccess, staffEventFilter } from '../../lib/access';
import { audit } from '../../lib/audit';
import { createSession, destroySession, requireAuth, type AuthUser } from '../../middleware/auth';
import { authLimiter } from '../../middleware/security';
import { getInstitution } from '../institution/service';

export function userDTO(u: Omit<IUser, 'passwordHash'>): UserDTO {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department ?? null,
    rollNumber: u.rollNumber ?? null,
    phone: u.phone ?? null,
    organizations: (u.organizations ?? []).map(String),
    claimed: u.claimed,
  };
}

export async function sessionDTO(user: AuthUser | undefined): Promise<SessionDTO> {
  if (!user) return { user: null, access: { isAdmin: false, canOrganize: false, staffEvents: [] } };
  const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const events =
    user.role === 'admin'
      ? []
      : await Event.find({ ...staffEventFilter(user), status: { $ne: 'cancelled' }, endsAt: { $gte: recent } })
          .sort({ startsAt: 1 })
          .limit(50)
          .lean();
  const staffEvents: StaffEventRef[] = events.map((e) => {
    const access = eventAccess(user, e);
    return {
      eventId: String(e._id),
      title: e.title,
      slug: e.slug,
      role: access.via === 'checkin' ? 'checkin' : access.via === 'manager' ? 'manager' : 'owner',
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
    };
  });
  return {
    user: userDTO(user),
    access: { isAdmin: user.role === 'admin', canOrganize: user.role === 'admin' || user.role === 'organizer', staffEvents },
  };
}

async function validateDepartment(code: string | undefined) {
  if (!code) return;
  const inst = await getInstitution();
  if (!inst.departments.some((d) => d.code === code)) {
    throw new AppError(400, 'validation_failed', 'Unknown department', { fields: { department: 'Choose a department from the list' } });
  }
}

export const authRouter = Router();

authRouter.get('/auth/session', async (req, res) => {
  res.json(await sessionDTO(req.user));
});

authRouter.post('/auth/signup', authLimiter, async (req, res) => {
  const input = parse(SignupSchema, req.body);
  await validateDepartment(input.department);
  const passwordHash = await hashPassword(input.password);
  const existing = await User.findOne({ email: input.email });
  let user;
  if (existing && existing.claimed) {
    throw conflict('An account with this email already exists. Sign in instead.', { fields: { email: 'Already registered' } }, 'email_taken');
  } else if (existing) {
    // Participants imported by an organizer can claim their account by signing up.
    // NOTE: without email verification this trusts the email address; see README limitations.
    existing.passwordHash = passwordHash;
    existing.claimed = true;
    existing.name = input.name || existing.name;
    existing.department = existing.department ?? input.department ?? null;
    existing.rollNumber = existing.rollNumber ?? input.rollNumber ?? null;
    existing.phone = existing.phone ?? (input.phone || null);
    await existing.save();
    user = existing;
    await audit({ actor: user._id, action: 'user.claimed', entityType: 'User', entityId: user._id, summary: `${user.email} claimed an imported account` });
  } else {
    user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'participant',
      department: input.department ?? null,
      rollNumber: input.rollNumber ?? null,
      phone: input.phone || null,
      claimed: true,
    });
  }
  await createSession(res, user._id, req.get('user-agent') ?? '');
  const fresh = await User.findById(user._id).lean<AuthUser>();
  res.status(201).json(await sessionDTO(fresh!));
});

authRouter.post('/auth/login', authLimiter, async (req, res) => {
  const input = parse(LoginSchema, req.body);
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  const ok = await verifyPassword(input.password, user?.claimed ? user.passwordHash : null);
  if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
  user.lastLoginAt = new Date();
  await user.save();
  await createSession(res, user._id, req.get('user-agent') ?? '');
  const fresh = await User.findById(user._id).lean<AuthUser>();
  res.json(await sessionDTO(fresh!));
});

authRouter.post('/auth/logout', async (req, res) => {
  await destroySession(req, res);
  res.status(204).end();
});

authRouter.patch('/auth/me', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const input = parse(ProfileUpdateSchema, req.body);
  await validateDepartment(input.department);
  const updated = await User.findByIdAndUpdate(
    user._id,
    {
      $set: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.department !== undefined ? { department: input.department || null } : {}),
        ...(input.rollNumber !== undefined ? { rollNumber: input.rollNumber || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      },
    },
    { new: true },
  ).lean<AuthUser>();
  res.json(await sessionDTO(updated!));
});

authRouter.post('/auth/password', requireAuth, authLimiter, async (req, res) => {
  const user = requireUser(req);
  const input = parse(ChangePasswordSchema, req.body);
  const doc = await User.findById(user._id).select('+passwordHash');
  if (!doc || !(await verifyPassword(input.currentPassword, doc.passwordHash))) throw unauthorized('Current password is incorrect');
  doc.passwordHash = await hashPassword(input.newPassword);
  await doc.save();
  // Sign out every other session.
  await Session.deleteMany({ user: user._id, _id: { $ne: req.sessionId } });
  await audit({ actor: user._id, action: 'user.password_changed', entityType: 'User', entityId: user._id, summary: 'Password changed; other sessions revoked' });
  res.status(204).end();
});
