/**
 * Demonstration dataset.
 *
 *   npm run seed            (wipes the CampusFlow collections in MONGODB_URI, then seeds)
 *
 * Every record created here is flagged `isDemo: true` and the UI labels it as sample data.
 * People are fictional; emails use the reserved example.edu / campusflow.demo domains.
 * Event dates are relative to the moment the seed runs, so one event is always in
 * progress and the live check-in dashboard has something to show. Randomness uses a fixed
 * seed, so the same data is produced every run (apart from those relative dates).
 */
import mongoose, { type Types } from 'mongoose';
import { formatInZone, zonedInputToUtc } from '@campusflow/shared';
import { env } from '../config/env';
import { connectDb } from '../db/connect';
import { hashPassword } from '../lib/crypto';
import {
  ALL_MODELS,
  CheckIn,
  Event,
  Institution,
  Organization,
  PaymentRecord,
  Registration,
  Team,
  TeamMembership,
  Ticket,
  User,
  Venue,
  VenueAllocation,
  type IEvent,
} from '../models';
import { issueTickets, recomputeRegistration } from '../modules/registrations/service';
import { randomCode } from '../lib/crypto';
import { seedRegistrationDocuments, type DemoOutcome } from './documents';

const TZ = 'Asia/Kolkata';
export const DEMO_PASSWORD = 'campusflow-demo';

/* ---------------------------------------------------------------- deterministic randomness */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261010);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

/* ---------------------------------------------------------------- time helpers (IST wall clock) */
const now = new Date();
const todayKey = formatInZone(now, TZ, 'yyyy-MM-dd');
function day(offset: number, hhmm: string): Date {
  const base = new Date(zonedInputToUtc(`${todayKey}T12:00`, TZ).getTime() + offset * 24 * 60 * 60 * 1000);
  return zonedInputToUtc(`${formatInZone(base, TZ, 'yyyy-MM-dd')}T${hhmm}`, TZ);
}
const minutes = (n: number) => n * 60_000;

/* ---------------------------------------------------------------- fictional people */
const FIRST = ['Aarav', 'Ananya', 'Rohan', 'Sneha', 'Karthik', 'Divya', 'Vikram', 'Harini', 'Sai', 'Keerthi', 'Arjun', 'Pooja', 'Nikhil', 'Meera', 'Varun', 'Lavanya', 'Siddharth', 'Bhavana', 'Rahul', 'Tejaswini', 'Manish', 'Shruti', 'Abhinav', 'Ishita', 'Pranav', 'Nandini', 'Yash', 'Akhila', 'Charan', 'Sowmya', 'Tarun', 'Ritika', 'Kiran', 'Deepika', 'Aditya', 'Swathi', 'Gautham', 'Mounika', 'Rishi', 'Hema'];
const LAST = ['Reddy', 'Rao', 'Sharma', 'Naidu', 'Kumar', 'Varma', 'Iyer', 'Patel', 'Goud', 'Chowdary', 'Menon', 'Nair', 'Gupta', 'Kulkarni', 'Yadav', 'Joshi', 'Pillai', 'Shetty', 'Das', 'Mishra'];
const DEPTS = ['CSE', 'CSM', 'CSD', 'CSC', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL'];
const TEAM_WORDS_A = ['Null', 'Binary', 'Quantum', 'Silent', 'Pixel', 'Async', 'Lambda', 'Kernel', 'Vector', 'Recursive', 'Stack', 'Neural', 'Cobalt', 'Orbit', 'Static', 'Prime', 'Echo', 'Byte', 'Lunar', 'Crimson'];
const TEAM_WORDS_B = ['Pointers', 'Bandits', 'Coders', 'Owls', 'Forge', 'Ninjas', 'Circuit', 'Sprinters', 'Wizards', 'Collective', 'Crew', 'Syndicate', 'Mavericks', 'Labs', 'Squad', 'Builders', 'Riders', 'Engine', 'Hackers', 'Society'];

async function main() {
  if (env.isProd && !process.argv.includes('--force')) {
    console.error('Refusing to seed a production environment. Pass --force if you really mean it.');
    process.exit(1);
  }
  const conn = await connectDb();
  console.log(`Seeding demonstration data into “${conn.connection.name}” …`);
  for (const m of ALL_MODELS) await (m as unknown as mongoose.Model<unknown>).deleteMany({});

  /* ------------------------------------------------------------ institution & organizations */
  const inst = await Institution.create({
    name: 'Malla Reddy Technical Campus',
    shortName: 'MRTC',
    timezone: TZ,
    departments: [
      { code: 'CSE', name: 'Computer Science & Engineering' },
      { code: 'CSM', name: 'CSE (Artificial Intelligence & Machine Learning)' },
      { code: 'CSD', name: 'CSE (Data Science)' },
      { code: 'CSC', name: 'CSE (Cyber Security)' },
      { code: 'IT', name: 'Information Technology' },
      { code: 'ECE', name: 'Electronics & Communication Engineering' },
      { code: 'EEE', name: 'Electrical & Electronics Engineering' },
      { code: 'MECH', name: 'Mechanical Engineering' },
      { code: 'CIVIL', name: 'Civil Engineering' },
      { code: 'MBA', name: 'Business Administration' },
    ],
    categories: [
      { slug: 'hackathon', name: 'Hackathon' },
      { slug: 'workshop', name: 'Workshop' },
      { slug: 'seminar', name: 'Seminar' },
      { slug: 'competition', name: 'Competition' },
      { slug: 'project-expo', name: 'Project Expo' },
      { slug: 'cultural', name: 'Cultural' },
      { slug: 'sports', name: 'Sports' },
      { slug: 'club-meetup', name: 'Club Meetup' },
      { slug: 'conference', name: 'Conference' },
    ],
    defaults: { teamSizeMin: 2, teamSizeMax: 4, currency: 'INR', checkInOpensMinutesBefore: 120 },
    requirements: { rollNumber: true, department: true, phone: false },
    branding: { tagline: 'Campus events, end to end.', accent: '#FF5A1F' },
    isDemo: true,
  });

  const orgDefs = [
    ['Club Infin8', 'club', 'Student technology club running hackathons, coding sprints and build nights.'],
    ['Department of CSE', 'department', 'Academic events, workshops and seminars from the Computer Science department.'],
    ['Cultural Committee', 'committee', 'Music, dance and theatre across the campus calendar.'],
    ['Sports Council', 'committee', 'Inter-department tournaments and fitness events.'],
    ['Robotics Society', 'club', 'Hardware, embedded systems and robotics builds.'],
  ] as const;
  const orgs: Record<string, Types.ObjectId> = {};
  for (const [name, kind, description] of orgDefs) {
    const o = await Organization.create({
      institution: inst._id,
      name,
      kind,
      description,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      isDemo: true,
    });
    orgs[name] = o._id;
  }

  /* ------------------------------------------------------------ venues */
  const venueDefs = [
    ['Main Auditorium', 'Block A', 'A-AUD', 'auditorium', 600, ['projector', 'sound_system', 'microphones', 'stage', 'air_conditioning', 'livestream', 'wifi'], true, { days: [1, 2, 3, 4, 5, 6], opensAt: '08:00', closesAt: '21:00' }, 60],
    ['Seminar Hall 1', 'Block B', 'B-SH1', 'seminar_hall', 180, ['projector', 'sound_system', 'microphones', 'air_conditioning', 'wifi'], true, { days: [1, 2, 3, 4, 5, 6], opensAt: '08:00', closesAt: '20:00' }, 30],
    ['Seminar Hall 2', 'Block C', 'C-SH2', 'seminar_hall', 120, ['projector', 'microphones', 'wifi', 'air_conditioning'], false, { days: [1, 2, 3, 4, 5, 6], opensAt: '08:00', closesAt: '20:00' }, 30],
    ['CSE Lab 3', 'Block B', 'B-304', 'laboratory', 66, ['computers', 'projector', 'wifi', 'power_outlets', 'air_conditioning'], false, { days: [1, 2, 3, 4, 5, 6], opensAt: '08:00', closesAt: '22:00' }, 30],
    ['Innovation Lab', 'Block D', 'D-101', 'laboratory', 110, ['power_outlets', 'wifi', 'whiteboard', 'projector', 'air_conditioning'], true, null, 30],
    ['Conference Room', 'Admin Block', 'ADM-CR', 'conference_room', 30, ['projector', 'wifi', 'air_conditioning', 'whiteboard'], true, { days: [0, 1, 2, 3, 4, 5, 6], opensAt: '09:00', closesAt: '19:00' }, 15],
    ['Classroom B-204', 'Block B', 'B-204', 'classroom', 60, ['projector', 'whiteboard'], false, { days: [1, 2, 3, 4, 5, 6], opensAt: '08:00', closesAt: '18:00' }, 15],
    ['Open Air Theatre', 'Campus Grounds', 'OAT', 'open_ground', 800, ['sound_system', 'stage', 'floodlights'], true, { days: [0, 1, 2, 3, 4, 5, 6], opensAt: '16:00', closesAt: '22:30' }, 90],
    ['Sports Ground', 'Campus Grounds', 'GRD', 'open_ground', 1000, ['floodlights'], true, { days: [0, 1, 2, 3, 4, 5, 6], opensAt: '06:00', closesAt: '19:00' }, 30],
  ] as const;
  const venues: Record<string, Types.ObjectId> = {};
  for (const [name, building, roomCode, kind, capacity, facilities, stepFree, availability, turnover] of venueDefs) {
    const v = await Venue.create({
      institution: inst._id,
      name,
      building,
      roomCode,
      kind,
      capacity,
      facilities: [...facilities],
      accessibility: { stepFree, notes: stepFree ? 'Step-free entrance' : 'Stairs only; ask for assistance' },
      availability,
      turnoverMinutes: turnover,
      isDemo: true,
    });
    venues[name] = v._id;
  }

  /* ------------------------------------------------------------ people */
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mkUser = (data: Record<string, unknown>) => User.create({ passwordHash, claimed: true, isDemo: true, ...data });

  const admin = await mkUser({ name: 'Platform Admin', email: 'admin@campusflow.demo', role: 'admin' });
  const head = await mkUser({ name: 'Aarav Reddy', email: 'head.infin8@campusflow.demo', role: 'organizer', organizations: [orgs['Club Infin8']], department: 'CSM', rollNumber: '23DM1A6601' });
  const faculty = await mkUser({ name: 'Dr. Lakshmi Prasad', email: 'faculty.cse@campusflow.demo', role: 'organizer', organizations: [orgs['Department of CSE'], orgs['Club Infin8']], department: 'CSE' });
  const cultural = await mkUser({ name: 'Meghana Rao', email: 'cultural@campusflow.demo', role: 'organizer', organizations: [orgs['Cultural Committee'], orgs['Sports Council']], department: 'ECE', rollNumber: '23DM1A0412' });
  const robotics = await mkUser({ name: 'Varun Iyer', email: 'robotics@campusflow.demo', role: 'organizer', organizations: [orgs['Robotics Society']], department: 'EEE', rollNumber: '23DM1A0233' });
  const volunteer = await mkUser({ name: 'Rohit Varma', email: 'volunteer@campusflow.demo', role: 'participant', department: 'IT', rollNumber: '24DM1A1219' });
  const student = await mkUser({ name: 'Sneha Kulkarni', email: 'student@campusflow.demo', role: 'participant', department: 'CSE', rollNumber: '24DM1A0547', phone: '+91 90000 00047' });

  const participants: Types.ObjectId[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < 170; i++) {
    let first: string, last: string;
    do {
      first = pick(FIRST);
      last = pick(LAST);
    } while (usedNames.has(`${first} ${last}`) && usedNames.size < FIRST.length * LAST.length);
    usedNames.add(`${first} ${last}`);
    const dept = pick(DEPTS);
    const u = await User.create({
      name: `${first} ${last}`,
      email: `${first}.${last}.${String(i + 1).padStart(3, '0')}@student.example.edu`.toLowerCase(),
      role: 'participant',
      department: dept,
      rollNumber: `24DM${String(DEPTS.indexOf(dept) + 1).padStart(2, '0')}A${String(i + 1).padStart(3, '0')}`,
      passwordHash,
      claimed: true,
      isDemo: true,
    });
    participants.push(u._id);
  }
  let cursor = 0;
  const nextPeople = (n: number) => {
    const out = participants.slice(cursor, cursor + n);
    cursor += n;
    if (cursor >= participants.length) cursor = 0;
    return out;
  };

  /* ------------------------------------------------------------ events */
  const mkEvent = async (data: Partial<IEvent> & Pick<IEvent, 'title' | 'category' | 'startsAt' | 'endsAt' | 'registrationDeadline' | 'mode'>) => {
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const prefix = data.title.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
    return Event.create({
      institution: inst._id,
      createdBy: head._id,
      slug,
      codePrefix: `${prefix}${randomCode(2)}`,
      summary: '',
      status: 'published',
      publishedAt: new Date(now.getTime() - 20 * 24 * 3600_000),
      isDemo: true,
      teamSize: { min: 1, max: 1 },
      fee: { amount: 0, currency: 'INR', basis: 'per_registration' },
      checkInOpensMinutesBefore: 120,
      ...data,
    });
  };

  // Live now: started ~3 hours ago, ends in ~9 hours.
  const liveStart = new Date(Math.floor((now.getTime() - minutes(180)) / minutes(30)) * minutes(30));
  const hackDay = await mkEvent({
    title: 'Infin8 Hack Day',
    category: 'hackathon',
    organization: orgs['Club Infin8']!,
    createdBy: head._id,
    summary: 'Twelve hours, one problem statement per track, teams of two to four. Build something that works by sundown.',
    description:
      'Infin8 Hack Day is a full-day build sprint for students across all years. Problem statements are released at the opening session in three tracks — campus operations, accessibility and civic data.\n\nBring a laptop and a charger. Wi-Fi, power and mentors are provided in the Innovation Lab. Judging happens in the final hour; each team gets a five-minute demo slot.',
    eligibility: 'Open to undergraduate students of all departments. Every team member must register on CAMPUSFLOW with their roll number.',
    rules: [
      'Teams of 2–4 members; members may belong to different departments.',
      'All code must be written during the event. Open-source libraries are allowed.',
      'Each team presents a working demo; slides alone are not judged.',
      'The team leader submits the payment reference; the ₹400 fee is per team.',
      'Carry your college ID along with your CAMPUSFLOW ticket for entry.',
    ],
    startsAt: liveStart,
    endsAt: new Date(liveStart.getTime() + minutes(12 * 60)),
    registrationOpensAt: new Date(liveStart.getTime() - 21 * 24 * 3600_000),
    registrationDeadline: new Date(liveStart.getTime() - 24 * 3600_000),
    mode: 'team',
    teamSize: { min: 2, max: 4 },
    capacity: 30,
    fee: { amount: 40000, currency: 'INR', basis: 'per_registration' },
    paymentInstructions: 'Pay ₹400 per team by UPI to the club treasurer (demo UPI ID: infin8@demo) and submit the UTR number here. Payments are verified by the organizers within a day.',
    expectedAttendance: 100,
    requiredFacilities: ['power_outlets', 'wifi'],
    staff: [
      { user: volunteer._id, role: 'checkin', addedBy: head._id, addedAt: now },
      { user: faculty._id, role: 'manager', addedBy: head._id, addedAt: now },
    ],
    schedule: [
      { startsAt: liveStart, endsAt: new Date(liveStart.getTime() + minutes(60)), title: 'Check-in & breakfast', location: 'Innovation Lab foyer' },
      { startsAt: new Date(liveStart.getTime() + minutes(60)), endsAt: new Date(liveStart.getTime() + minutes(90)), title: 'Opening & problem statements', location: 'Innovation Lab' },
      { startsAt: new Date(liveStart.getTime() + minutes(90)), endsAt: new Date(liveStart.getTime() + minutes(600)), title: 'Build time', location: 'Innovation Lab' },
      { startsAt: new Date(liveStart.getTime() + minutes(600)), endsAt: new Date(liveStart.getTime() + minutes(690)), title: 'Demos & judging', location: 'Innovation Lab' },
      { startsAt: new Date(liveStart.getTime() + minutes(690)), endsAt: new Date(liveStart.getTime() + minutes(720)), title: 'Results', location: 'Innovation Lab' },
    ],
  });

  const workshop = await mkEvent({
    title: 'Build Your First Web App',
    category: 'workshop',
    organization: orgs['Department of CSE']!,
    createdBy: faculty._id,
    summary: 'A hands-on, three-hour introduction to HTML, CSS and a little JavaScript. You leave with a page you built and deployed.',
    description: 'Designed for first and second years with no web experience. Lab machines are provided; bring nothing but curiosity. We build a personal page step by step and publish it before the session ends.',
    eligibility: 'First- and second-year students. No prior experience needed.',
    rules: ['Arrive ten minutes early to get a lab seat.', 'Seats are allocated on a first-registered basis.'],
    startsAt: day(6, '10:00'),
    endsAt: day(6, '13:00'),
    registrationDeadline: day(5, '18:00'),
    mode: 'individual',
    capacity: 60,
    requiredFacilities: ['computers', 'projector'],
    expectedAttendance: 60,
  });

  const expo = await mkEvent({
    title: 'Project Expo 2026',
    category: 'project-expo',
    organization: orgs['Department of CSE']!,
    createdBy: faculty._id,
    summary: 'Show the project you have been building all semester. Stalls, faculty judges and an open floor for juniors to walk through.',
    description: 'Each team gets a stall with power and a display table. Abstracts are reviewed by the faculty coordinators before a stall is confirmed, so registrations stay pending until approved.',
    eligibility: 'Teams of 1–3 students with a working prototype. Abstract review required.',
    rules: ['One stall per team.', 'Prototypes must be demonstrable on the day.', 'Approval is based on the abstract submitted at registration.'],
    startsAt: day(16, '09:30'),
    endsAt: day(16, '16:30'),
    registrationDeadline: day(12, '23:59'),
    mode: 'team',
    teamSize: { min: 1, max: 3 },
    capacity: 50,
    requiresApproval: true,
    requiredFacilities: ['stage', 'sound_system'],
    expectedAttendance: 300,
  });

  const culturalNight = await mkEvent({
    title: 'Rhythm — Cultural Night',
    category: 'cultural',
    organization: orgs['Cultural Committee']!,
    createdBy: cultural._id,
    summary: 'An evening of music, dance and theatre under the open sky. Register to perform or simply to attend.',
    description: 'Performances run from 18:00. Seating is open; entry is by ticket so the committee can plan seating and food stalls.',
    eligibility: 'All students and staff.',
    rules: ['Entry by CAMPUSFLOW ticket only.', 'No outside food in the seating area.'],
    startsAt: day(23, '17:30'),
    endsAt: day(23, '21:30'),
    registrationDeadline: day(22, '20:00'),
    mode: 'individual',
    capacity: 500,
    requiredFacilities: ['stage', 'sound_system'],
    expectedAttendance: 500,
  });

  const seminar = await mkEvent({
    title: 'Careers in Embedded Systems',
    category: 'seminar',
    organization: orgs['Robotics Society']!,
    createdBy: robotics._id,
    summary: 'Two alumni working in automotive and IoT firmware talk about what the job is actually like, followed by open Q&A.',
    description: 'A ninety-minute talk and thirty minutes of questions. Useful for ECE, EEE and CSE students considering firmware roles.',
    eligibility: 'Open to all departments.',
    rules: [],
    startsAt: day(9, '14:00'),
    endsAt: day(9, '16:00'),
    registrationDeadline: day(9, '12:00'),
    mode: 'individual',
    capacity: 120,
    requiredFacilities: ['projector', 'microphones'],
    expectedAttendance: 100,
  });

  const cricket = await mkEvent({
    title: 'Inter-department Cricket Cup',
    category: 'sports',
    organization: orgs['Sports Council']!,
    createdBy: cultural._id,
    summary: 'Department squads of 11 to 15 players, T10 format, one long Saturday of cricket.',
    description: 'Each department may enter one or more squads. Matches are T10; the schedule is published after registration closes.',
    eligibility: 'Students of any year. Squads may mix years but not departments.',
    rules: ['Squads of 11–15 players.', '₹500 entry per squad, paid by the captain.', 'Bring your own kit; balls are provided.'],
    startsAt: day(30, '07:00'),
    endsAt: day(30, '18:00'),
    registrationDeadline: day(25, '20:00'),
    mode: 'team',
    teamSize: { min: 11, max: 15 },
    capacity: 12,
    fee: { amount: 50000, currency: 'INR', basis: 'per_registration' },
    paymentInstructions: 'Pay ₹500 per squad (demo UPI ID: sports@demo) and submit the UTR here.',
    requiredFacilities: ['floodlights'],
    expectedAttendance: 180,
  });

  const meetup = await mkEvent({
    title: 'Robotics Society Build Night',
    category: 'club-meetup',
    organization: orgs['Robotics Society']!,
    createdBy: robotics._id,
    summary: 'Monthly build night: bring a half-finished robot or join one. Soldering stations and spare parts on the table.',
    description: 'Small group, hands-on. Capacity is limited by the number of workstations.',
    eligibility: 'Society members and anyone curious.',
    rules: [],
    startsAt: day(12, '16:00'),
    endsAt: day(12, '18:30'),
    registrationDeadline: day(12, '12:00'),
    mode: 'individual',
    capacity: 25,
    requiredFacilities: ['projector'],
    expectedAttendance: 25,
  });

  // Collects documents and approves participation before entry (see seed/documents.ts).
  const buildathon = await mkEvent({
    title: 'Infin8 Overnight Buildathon',
    category: 'hackathon',
    organization: orgs['Club Infin8']!,
    createdBy: head._id,
    summary: 'Eighteen hours on campus, overnight, in teams of two to four. Every participant’s documents are checked before entry.',
    description:
      'An overnight build on campus from Friday evening to Saturday noon. Because it runs overnight, the club collects a permission letter and a parent or guardian undertaking from every participant, and only participants whose participation is approved are admitted at the gate.\n\nThis is a demonstration event: its document requirements show how CAMPUSFLOW collects and reviews documents. They are not an official institutional process, and the sample files carry no real signatures.',
    eligibility: 'Undergraduate students of all departments.',
    rules: ['Every member uploads their own documents.', 'Entry only after the organizers approve participation.'],
    startsAt: day(10, '18:00'),
    endsAt: day(11, '12:00'),
    registrationDeadline: day(7, '23:59'),
    mode: 'team',
    teamSize: { min: 2, max: 4 },
    capacity: 20,
    requiredFacilities: ['computers', 'wifi', 'power_outlets'],
    expectedAttendance: 60,
    participation: { approvalRequired: true, checkInRequiresApproval: true },
    documentRequirements: [
      {
        key: 'demoperm',
        type: 'permission_letter',
        name: 'Participation permission letter',
        description: 'A letter from your Head of Department permitting you to stay on campus overnight for this event, in your department’s own letter format.',
        required: true,
        appliesTo: 'each_member',
        deadline: day(8, '18:00'),
        formats: ['pdf'],
        reviewRequired: true,
        active: true,
        template: null,
        createdAt: now,
      },
      {
        key: 'demogrdn',
        type: 'guardian_undertaking',
        name: 'Parent / guardian undertaking',
        description: 'Signed by your parent or guardian, on the form your institution provides. A scan or clear photo is fine.',
        required: true,
        appliesTo: 'each_member',
        deadline: day(8, '18:00'),
        formats: ['pdf', 'jpg', 'png'],
        reviewRequired: true,
        active: true,
        template: null,
        createdAt: now,
      },
    ],
  });

  const sprint = await mkEvent({
    title: 'Code Sprint: Autumn Round',
    category: 'competition',
    organization: orgs['Club Infin8']!,
    createdBy: head._id,
    summary: 'Four hours, six problems, individual ranking. The autumn round of the Infin8 competitive programming series.',
    description: 'Problems range from warm-up to hard. Ranked by problems solved, then total time.',
    eligibility: 'All students.',
    rules: ['Individual participation.', 'Any language supported by the judge.', '₹100 per participant.'],
    startsAt: day(-20, '10:00'),
    endsAt: day(-20, '14:00'),
    registrationOpensAt: day(-40, '09:00'),
    registrationDeadline: day(-21, '20:00'),
    mode: 'individual',
    capacity: 60,
    fee: { amount: 10000, currency: 'INR', basis: 'per_participant' },
    paymentInstructions: 'Pay ₹100 by UPI (demo UPI ID: infin8@demo) and submit the UTR.',
    requiredFacilities: ['projector'],
    expectedAttendance: 60,
  });

  await mkEvent({
    title: 'Design Sprint Workshop',
    category: 'workshop',
    organization: orgs['Club Infin8']!,
    createdBy: head._id,
    status: 'draft',
    publishedAt: null,
    summary: 'A one-day product design sprint: map, sketch, decide, prototype and test with real users.',
    description: 'Draft — venue and facilitator still to be confirmed.',
    startsAt: day(2, '10:00'),
    endsAt: day(2, '17:00'),
    registrationDeadline: day(1, '20:00'),
    mode: 'team',
    teamSize: { min: 3, max: 5 },
    capacity: 10,
  });

  const bootcamp = await mkEvent({
    title: 'Data Science Bootcamp',
    category: 'workshop',
    organization: orgs['Department of CSE']!,
    createdBy: faculty._id,
    summary: 'Two sessions on pandas, plotting and a first model. Registration opens in a few days.',
    description: 'Bring a laptop with Python installed. Notebooks are shared at the start of the session.',
    eligibility: 'Second year and above.',
    rules: ['Laptop required.'],
    startsAt: day(19, '09:30'),
    endsAt: day(19, '16:30'),
    registrationOpensAt: day(3, '09:00'),
    registrationDeadline: day(17, '20:00'),
    mode: 'individual',
    capacity: 150,
    fee: { amount: 20000, currency: 'INR', basis: 'per_participant' },
    paymentInstructions: 'Pay ₹200 by UPI (demo UPI ID: csedept@demo) and submit the UTR.',
    requiredFacilities: ['projector', 'wifi', 'power_outlets'],
    expectedAttendance: 120,
  });

  /* ------------------------------------------------------------ venue bookings (non-overlapping) */
  const book = (event: IEvent, venue: string) =>
    VenueAllocation.create({ event: event._id, venue: venues[venue], startsAt: event.startsAt, endsAt: event.endsAt, status: 'confirmed', reason: 'Booked by the organizer', allocatedBy: event.createdBy, isDemo: true });
  await book(hackDay, 'Innovation Lab');
  await book(workshop, 'CSE Lab 3');
  await book(expo, 'Main Auditorium');
  await book(culturalNight, 'Open Air Theatre');
  await book(cricket, 'Sports Ground');
  await book(meetup, 'Conference Room');
  await book(sprint, 'Classroom B-204');
  await book(buildathon, 'Innovation Lab');
  await book(bootcamp, 'Seminar Hall 1');
  // The seminar intentionally has no venue yet: the overview flags it and the planner can propose one.

  /* ------------------------------------------------------------ registrations */
  const createdAtFor = (event: IEvent, i: number, total: number) => {
    const rawOpens = (event.registrationOpensAt ?? new Date(event.startsAt.getTime() - 25 * 24 * 3600_000)).getTime();
    const opens = new Date(Math.min(rawOpens, now.getTime() - 10 * 24 * 3600_000));
    const close = new Date(Math.min(event.registrationDeadline.getTime(), now.getTime() - minutes(30)));
    const span = Math.max(close.getTime() - opens.getTime(), minutes(60));
    // Registrations cluster early and just before the deadline, like real campaigns.
    const t = i / Math.max(total - 1, 1);
    const shaped = t < 0.5 ? Math.pow(t * 2, 0.6) / 2 : 0.5 + Math.pow((t - 0.5) * 2, 1.8) / 2;
    return new Date(opens.getTime() + shaped * span * 0.98 + rand() * minutes(90));
  };

  async function bump(event: IEvent) {
    const e = await Event.findOneAndUpdate({ _id: event._id }, { $inc: { 'counters.registrationSeq': 1, 'counters.activeRegistrations': 1 } }, { new: true }).lean();
    return `${e!.codePrefix}-${String(e!.counters.registrationSeq).padStart(4, '0')}`;
  }

  async function individual(event: IEvent, userId: Types.ObjectId, createdAt: Date, payment?: { reference?: string; verified?: boolean }) {
    const reg = await Registration.create({
      event: event._id,
      code: await bump(event),
      kind: 'individual',
      status: 'pending',
      user: userId,
      activeKey: `${event._id}:${userId}`,
      isDemo: true,
    });
    const required = event.fee.amount > 0;
    await PaymentRecord.create({
      registration: reg._id,
      event: event._id,
      required,
      status: !required ? 'not_required' : payment?.verified ? 'verified' : 'pending',
      amountDue: event.fee.amount,
      currency: 'INR',
      reference: payment?.reference ?? null,
      referenceKey: payment?.reference ?? null,
      submittedAt: payment?.reference ? createdAt : null,
      decidedAt: payment?.verified ? new Date(createdAt.getTime() + 6 * 3600_000) : null,
      decidedBy: payment?.verified ? event.createdBy : null,
      history: [{ status: required ? 'pending' : 'not_required', at: createdAt, by: null, note: 'Registration created' }],
    });
    // createdAt is immutable through Mongoose timestamps; back-date via the driver.
    await Registration.collection.updateOne({ _id: reg._id }, { $set: { createdAt, updatedAt: createdAt } });
    await recomputeRegistration(reg._id);
    return reg;
  }

  async function team(
    event: IEvent,
    name: string,
    members: Types.ObjectId[],
    createdAt: Date,
    opts: { reference?: string; verified?: boolean; approved?: boolean } = {},
  ) {
    const t = await Team.create({
      event: event._id,
      name,
      nameKey: name.toLowerCase(),
      code: randomCode(8),
      codeExpiresAt: event.registrationDeadline,
      leader: members[0],
      memberCount: members.length,
      isDemo: true,
    });
    for (const [i, m] of members.entries()) {
      await TeamMembership.create({ team: t._id, event: event._id, user: m, role: i === 0 ? 'leader' : 'member', joinedAt: new Date(createdAt.getTime() + i * minutes(40)) });
    }
    const reg = await Registration.create({
      event: event._id,
      code: await bump(event),
      kind: 'team',
      status: 'pending',
      user: members[0],
      team: t._id,
      approval: opts.approved ? { approved: true, decidedAt: new Date(createdAt.getTime() + 24 * 3600_000), decidedBy: event.createdBy, note: null } : undefined,
      isDemo: true,
    });
    t.registration = reg._id;
    await t.save();
    const required = event.fee.amount > 0;
    await PaymentRecord.create({
      registration: reg._id,
      event: event._id,
      required,
      status: !required ? 'not_required' : opts.verified ? 'verified' : 'pending',
      amountDue: event.fee.amount,
      currency: 'INR',
      reference: opts.reference ?? null,
      referenceKey: opts.reference ?? null,
      submittedAt: opts.reference ? new Date(createdAt.getTime() + 3 * 3600_000) : null,
      decidedAt: opts.verified ? new Date(createdAt.getTime() + 20 * 3600_000) : null,
      decidedBy: opts.verified ? (event.staff.find((s) => s.role === 'manager')?.user ?? event.createdBy) : null,
      history: [{ status: required ? 'pending' : 'not_required', at: createdAt, by: null, note: 'Registration created' }],
    });
    // createdAt is immutable through Mongoose timestamps; back-date via the driver.
    await Registration.collection.updateOne({ _id: reg._id }, { $set: { createdAt, updatedAt: createdAt } });
    await recomputeRegistration(reg._id);
    return reg;
  }

  const utr = () => `${int(3, 5)}${String(int(10000000000, 99999999999))}`;

  // Hack Day: 18 teams in varied states.
  const teamNames = new Set<string>();
  const teamName = () => {
    let n: string;
    do n = `${pick(TEAM_WORDS_A)} ${pick(TEAM_WORDS_B)}`;
    while (teamNames.has(n));
    teamNames.add(n);
    return n;
  };
  const hackTotal = 18;
  for (let i = 0; i < hackTotal; i++) {
    const at = createdAtFor(hackDay, i, hackTotal);
    if (i === 3) {
      // The demo participant's team — confirmed, not yet checked in, ready to scan.
      teamNames.add('Null Pointers');
      await team(hackDay, 'Null Pointers', [student._id, ...nextPeople(3)], at, { reference: utr(), verified: true });
      continue;
    }
    const size = pick([2, 3, 3, 4, 4, 4]);
    if (i === 16) await team(hackDay, teamName(), nextPeople(1), at); // incomplete
    else if (i === 15) await team(hackDay, teamName(), nextPeople(size), at); // awaiting reference
    else if (i === 13 || i === 14) await team(hackDay, teamName(), nextPeople(size), at, { reference: utr() }); // awaiting verification
    else await team(hackDay, teamName(), nextPeople(size), at, { reference: utr(), verified: true });
  }

  // Workshop: 41 individual registrations, free.
  for (let i = 0; i < 41; i++) await individual(workshop, nextPeople(1)[0]!, createdAtFor(workshop, i, 41));

  // Expo: 12 teams, 7 approved.
  for (let i = 0; i < 12; i++) await team(expo, teamName(), nextPeople(int(1, 3)), createdAtFor(expo, i, 12), { approved: i < 7 });

  // Cultural night: 64 attendees.
  for (let i = 0; i < 64; i++) await individual(culturalNight, nextPeople(1)[0]!, createdAtFor(culturalNight, i, 64));

  // Seminar: 23.
  for (let i = 0; i < 23; i++) await individual(seminar, nextPeople(1)[0]!, createdAtFor(seminar, i, 23));

  // Cricket: 3 squads still forming.
  for (let i = 0; i < 3; i++) await team(cricket, `${pick(DEPTS)} ${pick(['Strikers', 'XI', 'Royals'])} ${i + 1}`, nextPeople(int(5, 9)), createdAtFor(cricket, i, 3));

  // Build night: 24 of 25 seats.
  for (let i = 0; i < 24; i++) await individual(meetup, nextPeople(1)[0]!, createdAtFor(meetup, i, 24));

  // Overnight buildathon: six teams across every document and approval state. The demo
  // participant leads "Night Owls" (one document approved, one sent back for changes).
  const buildPlans: { name: string; size: number; plan: DemoOutcome[][]; approve?: boolean }[] = [
    { name: 'Night Owls', size: 3, plan: [['approved', 'changes_requested'], ['submitted', 'submitted'], ['missing', 'missing']] },
    { name: teamName(), size: 3, plan: [['approved', 'approved'], ['approved', 'approved'], ['approved', 'approved']], approve: true },
    { name: teamName(), size: 2, plan: [['approved', 'approved'], ['approved', 'approved']] },
    { name: teamName(), size: 4, plan: [['submitted', 'submitted'], ['submitted', 'approved'], ['approved', 'submitted'], ['submitted', 'submitted']] },
    { name: teamName(), size: 2, plan: [['rejected', 'approved'], ['approved', 'approved']] },
    { name: teamName(), size: 3, plan: [['submitted', 'missing'], ['missing', 'missing'], ['missing', 'missing']] },
  ];
  for (const [i, p] of buildPlans.entries()) {
    const members = i === 0 ? [student._id, ...nextPeople(p.size - 1)] : nextPeople(p.size);
    teamNames.add(p.name);
    const reg = await team(buildathon, p.name, members, createdAtFor(buildathon, i, buildPlans.length));
    await seedRegistrationDocuments({ event: buildathon, registrationId: reg._id, reviewer: head._id, plan: p.plan, approveParticipation: p.approve, now });
  }

  // Past code sprint: 48 paid & verified, 3 never paid.
  const sprintRegs = [];
  for (let i = 0; i < 51; i++) {
    sprintRegs.push(await individual(sprint, nextPeople(1)[0]!, createdAtFor(sprint, i, 51), i < 48 ? { reference: utr(), verified: true } : {}));
  }

  /* ------------------------------------------------------------ attendance */
  async function checkIn(eventId: Types.ObjectId, ticketId: Types.ObjectId, at: Date, staff: Types.ObjectId) {
    const t = await Ticket.findById(ticketId).lean();
    if (!t) return;
    await CheckIn.create({ event: eventId, ticket: t._id, registration: t.registration, user: t.user, team: t.team, staff, method: rand() < 0.88 ? 'qr' : 'manual', at, active: true, isDemo: true });
    await Ticket.updateOne({ _id: t._id }, { $set: { status: 'checked_in', checkedInAt: at } });
  }

  // Hack Day: most teams arriving over the first ~90 minutes; a few partial, a few absent.
  const hackRegs = await Registration.find({ event: hackDay._id, status: 'confirmed' }).lean();
  for (const reg of hackRegs) {
    if (String(reg.user) === String(student._id)) continue; // keep the demo ticket unscanned
    const tickets = await Ticket.find({ registration: reg._id, live: true }).lean();
    const roll = rand();
    const arriving = roll < 0.15 ? 0 : roll < 0.35 ? Math.max(1, tickets.length - 1) : tickets.length;
    const base = liveStart.getTime() - minutes(30) + rand() * minutes(100);
    for (const tk of tickets.slice(0, arriving)) {
      const at = new Date(Math.min(base + rand() * minutes(12), now.getTime() - minutes(2)));
      await checkIn(hackDay._id, tk._id, at, rand() < 0.7 ? volunteer._id : head._id);
    }
  }

  // Code sprint (past): 39 of 48 attended.
  const sprintTickets = await Ticket.find({ event: sprint._id, live: true }).lean();
  for (const [i, tk] of sprintTickets.entries()) {
    if (i >= 39) break;
    await checkIn(sprint._id, tk._id, new Date(sprint.startsAt.getTime() - minutes(40) + rand() * minutes(55)), head._id);
  }

  // Make sure every confirmed registration holds its tickets (idempotent).
  for (const reg of await Registration.find({ status: 'confirmed' }).lean()) await issueTickets(reg);

  const counts = {
    users: await User.countDocuments(),
    events: await Event.countDocuments(),
    registrations: await Registration.countDocuments(),
    teams: await Team.countDocuments(),
    tickets: await Ticket.countDocuments({ live: true }),
    checkIns: await CheckIn.countDocuments(),
  };
  console.log('Seeded:', counts);
  console.log(`\nDemo accounts (password “${DEMO_PASSWORD}”):`);
  const accounts: [string, string][] = [
    ['Platform admin', admin.email],
    ['Organizer — Club Infin8 head', head.email],
    ['Organizer — faculty coordinator', faculty.email],
    ['Organizer — cultural committee', cultural.email],
    ['Check-in volunteer (Hack Day)', volunteer.email],
    ['Participant with a Hack Day ticket', student.email],
  ];
  for (const [role, email] of accounts) console.log(`  ${role.padEnd(36)} ${email}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
