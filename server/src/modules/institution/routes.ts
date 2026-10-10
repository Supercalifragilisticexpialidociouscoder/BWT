import { Router } from 'express';
import {
  InstitutionUpdateSchema,
  OrganizationInputSchema,
  UserAdminUpdateSchema,
} from '@campusflow/shared';
import { Event, Institution, Organization, User } from '../../models';
import { audit } from '../../lib/audit';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors';
import { escapeRegex, oid, parse, requireUser } from '../../lib/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { userDTO } from '../auth/routes';
import { slugify } from '../events/service';
import {
  getInstitution,
  institutionDTO,
  invalidateInstitutionCache,
  listOrganizations,
  organizationDTO,
} from './service';

export const institutionRouter = Router();

institutionRouter.get('/institution', async (_req, res) => {
  res.json(institutionDTO(await getInstitution()));
});

institutionRouter.put('/institution', requireRole('admin'), async (req, res) => {
  const user = requireUser(req);
  const input = parse(InstitutionUpdateSchema, req.body);
  const fields: Record<string, string> = {};
  if (input.defaults.teamSizeMin > input.defaults.teamSizeMax) fields['defaults.teamSizeMin'] = 'Cannot exceed the maximum';
  const dupDept = input.departments.map((d) => d.code).find((c, i, a) => a.indexOf(c) !== i);
  if (dupDept) fields.departments = `Department code ${dupDept} is listed twice`;
  const dupCat = input.categories.map((c) => c.slug).find((c, i, a) => a.indexOf(c) !== i);
  if (dupCat) fields.categories = `Category ${dupCat} is listed twice`;
  if (Object.keys(fields).length) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields });

  const current = await getInstitution();
  const removed = current.categories.map((c) => c.slug).filter((s) => !input.categories.some((c) => c.slug === s));
  if (removed.length) {
    const used = await Event.distinct('category', { category: { $in: removed } });
    if (used.length) {
      throw conflict(`Categories in use by events cannot be removed: ${used.join(', ')}`, { fields: { categories: `In use: ${used.join(', ')}` } });
    }
  }
  await Institution.updateOne({ _id: current._id }, { $set: input });
  invalidateInstitutionCache();
  await audit({ actor: user._id, action: 'institution.updated', entityType: 'Institution', entityId: current._id, summary: 'Institution settings updated' });
  res.json(institutionDTO(await getInstitution()));
});

institutionRouter.get('/organizations', async (_req, res) => {
  res.json((await listOrganizations()).map(organizationDTO));
});

institutionRouter.post('/organizations', requireRole('admin'), async (req, res) => {
  const user = requireUser(req);
  const input = parse(OrganizationInputSchema, req.body);
  const inst = await getInstitution();
  let slug = slugify(input.name);
  if (await Organization.exists({ slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const org = await Organization.create({ ...input, slug, institution: inst._id });
  await audit({ actor: user._id, action: 'organization.created', entityType: 'Organization', entityId: org._id, summary: `Added ${org.name}` });
  res.status(201).json(organizationDTO(org.toObject()));
});

institutionRouter.put('/organizations/:id', requireRole('admin'), async (req, res) => {
  const user = requireUser(req);
  const input = parse(OrganizationInputSchema, req.body);
  const org = await Organization.findByIdAndUpdate(oid(req.params.id, 'Organization'), { $set: input }, { new: true }).lean();
  if (!org) throw notFound('Organization');
  await audit({ actor: user._id, action: 'organization.updated', entityType: 'Organization', entityId: org._id, summary: `Updated ${org.name}` });
  res.json(organizationDTO(org));
});

/** People directory. Admins see everything; organizers may look people up to assign event staff. */
institutionRouter.get('/users', requireAuth, async (req, res) => {
  const user = requireUser(req);
  if (user.role !== 'admin' && user.role !== 'organizer') throw forbidden();
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  if (user.role === 'organizer' && q.length < 3) {
    res.json({ items: [], page: 1, pageSize: 20, total: 0 });
    return;
  }
  const rx = q ? new RegExp(escapeRegex(q), 'i') : null;
  const filter = rx ? { $or: [{ name: rx }, { email: rx }, { rollNumber: rx }] } : {};
  const pageSize = user.role === 'admin' ? 50 : 10;
  const [items, total] = await Promise.all([
    User.find(filter).sort({ name: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    User.countDocuments(filter),
  ]);
  res.json({
    items: items.map((u) =>
      user.role === 'admin' ? userDTO(u) : { ...userDTO(u), phone: null, rollNumber: null, organizations: [] },
    ),
    page,
    pageSize,
    total,
  });
});

institutionRouter.patch('/users/:id', requireRole('admin'), async (req, res) => {
  const actor = requireUser(req);
  const input = parse(UserAdminUpdateSchema, req.body);
  const id = oid(req.params.id, 'User');
  if (String(id) === String(actor._id) && input.role && input.role !== 'admin') {
    throw conflict('You cannot remove your own administrator role');
  }
  if (input.organizations?.length) {
    const count = await Organization.countDocuments({ _id: { $in: input.organizations } });
    if (count !== input.organizations.length) throw new AppError(400, 'validation_failed', 'Unknown organization', { fields: { organizations: 'Unknown organization' } });
  }
  const updated = await User.findByIdAndUpdate(id, { $set: input }, { new: true }).lean();
  if (!updated) throw notFound('User');
  await audit({ actor: actor._id, action: 'user.access_changed', entityType: 'User', entityId: id, summary: `${updated.email}: role ${updated.role}`, meta: input });
  res.json(userDTO(updated));
});
