import type { InstitutionDTO, OrganizationDTO } from '@campusflow/shared';
import { Institution, Organization, type IInstitution, type IOrganization } from '../../models';
import { AppError } from '../../lib/errors';

let cache: { value: IInstitution; at: number } | null = null;
const CACHE_MS = 30_000;

/** The deployment's institution configuration (single-institution deployments). */
export async function getInstitution(): Promise<IInstitution> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const doc = await Institution.findOne().sort({ createdAt: 1 }).lean();
  if (!doc) {
    throw new AppError(503, 'not_configured', 'No institution is configured yet. Run `npm run seed` or create one.');
  }
  cache = { value: doc, at: Date.now() };
  return doc;
}

export function invalidateInstitutionCache() {
  cache = null;
}

export function institutionDTO(i: IInstitution): InstitutionDTO {
  return {
    id: String(i._id),
    name: i.name,
    shortName: i.shortName,
    timezone: i.timezone,
    departments: i.departments.map((d) => ({ code: d.code, name: d.name })),
    categories: i.categories.map((c) => ({ slug: c.slug, name: c.name })),
    defaults: { ...i.defaults },
    requirements: { ...i.requirements },
    branding: { ...i.branding },
    isDemo: i.isDemo,
  };
}

export function organizationDTO(o: IOrganization): OrganizationDTO {
  return { id: String(o._id), name: o.name, slug: o.slug, kind: o.kind, description: o.description };
}

export function categoryName(inst: IInstitution, slug: string): string {
  return inst.categories.find((c) => c.slug === slug)?.name ?? slug;
}

export async function listOrganizations(): Promise<IOrganization[]> {
  return Organization.find().sort({ name: 1 }).lean();
}
