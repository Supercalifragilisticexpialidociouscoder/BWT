import mongoose, { type Types } from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { connectDb } from '../src/db/connect';
import { hashPassword } from '../src/lib/crypto';
import { invalidateInstitutionCache } from '../src/modules/institution/service';
import { Institution, Organization, User, Venue } from '../src/models';

export const PASSWORD = 'correct-horse-battery';

export async function setupDb() {
  await connectDb();
  await mongoose.connection.dropDatabase();
  // Re-create indexes after the drop: the uniqueness guarantees under test depend on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  invalidateInstitutionCache();
}

export async function teardownDb() {
  await mongoose.disconnect();
}

export interface World {
  app: Express;
  orgA: Types.ObjectId;
  orgB: Types.ObjectId;
  venues: Record<string, Types.ObjectId>;
}

/** Minimal configured institution with two clubs, people in every role and a few venues. */
export async function seedWorld(): Promise<World> {
  const inst = await Institution.create({
    name: 'Test Institute of Technology',
    shortName: 'TIT',
    timezone: 'Asia/Kolkata',
    departments: [
      { code: 'CSE', name: 'Computer Science' },
      { code: 'ECE', name: 'Electronics' },
    ],
    categories: [
      { slug: 'hackathon', name: 'Hackathon' },
      { slug: 'workshop', name: 'Workshop' },
    ],
    defaults: { teamSizeMin: 2, teamSizeMax: 4, currency: 'INR', checkInOpensMinutesBefore: 120 },
    requirements: { rollNumber: true, department: true, phone: false },
    branding: { tagline: '', accent: '#C9F03C' },
  });
  const orgA = await Organization.create({ institution: inst._id, name: 'Club A', slug: 'club-a', kind: 'club' });
  const orgB = await Organization.create({ institution: inst._id, name: 'Club B', slug: 'club-b', kind: 'club' });
  const passwordHash = await hashPassword(PASSWORD);
  const mk = (email: string, extra: Record<string, unknown> = {}) =>
    User.create({ name: email.split('@')[0], email, passwordHash, role: 'participant', department: 'CSE', rollNumber: email.toUpperCase().slice(0, 10).replace(/[^A-Z0-9]/g, ''), ...extra });
  await mk('admin@test.dev', { role: 'admin' });
  await mk('orga@test.dev', { role: 'organizer', organizations: [orgA._id] });
  await mk('orgb@test.dev', { role: 'organizer', organizations: [orgB._id] });
  await mk('volunteer@test.dev');
  for (let i = 1; i <= 12; i++) await mk(`p${i}@test.dev`, { rollNumber: `24TEST${String(i).padStart(3, '0')}` });
  await mk('ece@test.dev', { department: 'ECE', rollNumber: '24ECE001' });
  await mk('noroll@test.dev', { rollNumber: null });

  const venues: Record<string, Types.ObjectId> = {};
  for (const [name, capacity, facilities, availability] of [
    ['Lab', 60, ['computers', 'wifi', 'power_outlets'], null],
    ['Hall', 200, ['projector', 'microphones', 'wifi'], null],
    ['Room', 40, ['projector'], { days: [1, 2, 3, 4, 5], opensAt: '09:00', closesAt: '17:00' }],
  ] as const) {
    const v = await Venue.create({ institution: inst._id, name, building: 'Main', kind: 'classroom', capacity, facilities: [...facilities], availability, turnoverMinutes: 30 });
    venues[name] = v._id;
  }
  invalidateInstitutionCache();
  return { app: createApp(), orgA: orgA._id, orgB: orgB._id, venues };
}

export type Agent = ReturnType<typeof request.agent> & { cookie: string };

/** A signed-in client that sends the CSRF header on every request. */
export async function login(app: Express, email: string): Promise<Agent> {
  const agent = request.agent(app) as Agent;
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'campusflow').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const raw = res.headers['set-cookie'] as unknown as string[] | string;
  const list = Array.isArray(raw) ? raw : [raw];
  agent.cookie = list.map((c) => c.split(';')[0]).join('; ');
  return agent;
}

export const H = { 'X-Requested-With': 'campusflow' } as const;

export function iso(offsetMinutes: number) {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

export function eventInput(organization: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Hack Day',
    organization: String(organization),
    category: 'hackathon',
    summary: 'A day of building things together.',
    description: 'Long description',
    eligibility: '',
    rules: ['Be kind'],
    startsAt: iso(60),
    endsAt: iso(60 * 8),
    registrationOpensAt: null,
    registrationDeadline: iso(30),
    mode: 'team',
    teamSize: { min: 2, max: 3 },
    capacity: 10,
    fee: { amount: 40000, currency: 'INR', basis: 'per_registration' },
    paymentInstructions: 'Pay by UPI',
    requiresApproval: false,
    allowedDepartments: [],
    expectedAttendance: 30,
    requiredFacilities: [],
    checkInOpensMinutesBefore: 120,
    schedule: [],
    ...overrides,
  };
}

/** Create and publish an event as the given organizer; returns its id. */
export async function publishedEvent(agent: Agent, organization: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  const created = await agent.post('/api/events').set(H).send(eventInput(organization, overrides));
  if (created.status !== 201) throw new Error(`create failed ${created.status} ${JSON.stringify(created.body)}`);
  const pub = await agent.post(`/api/events/${created.body.id}/status`).set(H).send({ status: 'published' });
  if (pub.status !== 200) throw new Error(`publish failed ${pub.status} ${JSON.stringify(pub.body)}`);
  return created.body.id as string;
}
