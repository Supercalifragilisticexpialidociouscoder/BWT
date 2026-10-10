import { z } from 'zod';
import {
  ALLOCATION_STATUSES,
  DOCUMENT_FORMATS,
  DOCUMENT_SCOPES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  EVENT_STATUSES,
  FEE_BASIS,
  IMPORT_FIELDS,
  ORGANIZATION_KINDS,
  REGISTRATION_MODES,
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
  PARTICIPATION_FILTERS,
  STAFF_ROLES,
  USER_ROLES,
  VENUE_KINDS,
} from './constants';
import { isValidTimeZone } from './time';

/* ------------------------------------------------------------------ primitives */

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid identifier');

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const passwordField = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'Password is too long');

export const isoDateTime = z.iso.datetime({ offset: true, error: 'Enter a valid date and time' });

const optionalText = (max: number) => z.string().trim().max(max).optional().default('');

export const rollNumberField = z
  .string()
  .trim()
  .toUpperCase()
  .max(32, 'Roll number is too long')
  .regex(/^[A-Z0-9/-]*$/, 'Use letters, digits, “/” or “-” only');

export const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{7,16}$/, 'Enter a valid phone number');

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Use lowercase letters, digits and dashes');

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm');

/* ------------------------------------------------------------------ auth */

export const ProfileFieldsSchema = z.object({
  department: z.string().trim().max(40).optional(),
  rollNumber: rollNumberField.optional(),
  phone: phoneField.optional().or(z.literal('')),
});

export const SignupSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(80),
    email: emailField,
    password: passwordField,
  })
  .extend(ProfileFieldsSchema.shape);
export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const ProfileUpdateSchema = z
  .object({ name: z.string().trim().min(2).max(80).optional() })
  .extend(ProfileFieldsSchema.shape);

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordField,
});

/* ------------------------------------------------------------------ institution */

export const InstitutionUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  shortName: z.string().trim().min(2).max(24),
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA timezone'),
  departments: z
    .array(z.object({ code: z.string().trim().toUpperCase().min(1).max(16), name: z.string().trim().min(2).max(80) }))
    .max(80),
  categories: z.array(z.object({ slug, name: z.string().trim().min(2).max(40) })).min(1).max(40),
  defaults: z.object({
    teamSizeMin: z.number().int().min(1).max(50),
    teamSizeMax: z.number().int().min(1).max(50),
    currency: z.string().length(3).toUpperCase(),
    checkInOpensMinutesBefore: z.number().int().min(0).max(1440),
  }),
  requirements: z.object({
    rollNumber: z.boolean(),
    department: z.boolean(),
    phone: z.boolean(),
  }),
  branding: z.object({
    tagline: z.string().trim().max(140),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour like #FF5A1F'),
  }),
});
export type InstitutionUpdateInput = z.infer<typeof InstitutionUpdateSchema>;

export const OrganizationInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(ORGANIZATION_KINDS),
  description: optionalText(500),
});

export const UserAdminUpdateSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  organizations: z.array(objectId).max(20).optional(),
});

/* ------------------------------------------------------------------ events */

export const ScheduleItemSchema = z.object({
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  title: z.string().trim().min(2).max(100),
  location: optionalText(100),
});

export const EventInputSchema = z
  .object({
    title: z.string().trim().min(3, 'Title needs at least 3 characters').max(120),
    organization: objectId,
    category: slug,
    summary: z.string().trim().min(10, 'Write a one-line summary (10+ characters)').max(280),
    description: optionalText(8000),
    eligibility: optionalText(1000),
    rules: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    registrationOpensAt: isoDateTime.nullable().default(null),
    registrationDeadline: isoDateTime,
    mode: z.enum(REGISTRATION_MODES),
    teamSize: z.object({
      min: z.number().int().min(1).max(50),
      max: z.number().int().min(1).max(50),
    }),
    capacity: z.number().int().positive('Capacity must be positive').max(100000).nullable(),
    fee: z.object({
      amount: z.number().int().min(0).max(100_000_00),
      currency: z.string().length(3).toUpperCase().default('INR'),
      basis: z.enum(FEE_BASIS).default('per_registration'),
    }),
    paymentInstructions: optionalText(1000),
    requiresApproval: z.boolean().default(false),
    allowedDepartments: z.array(z.string().trim().toUpperCase().max(16)).max(80).default([]),
    expectedAttendance: z.number().int().positive().max(100000).nullable().default(null),
    requiredFacilities: z.array(slug).max(20).default([]),
    checkInOpensMinutesBefore: z.number().int().min(0).max(1440).default(120),
    schedule: z.array(ScheduleItemSchema).max(50).default([]),
  })
  .superRefine((e, ctx) => {
    const start = Date.parse(e.startsAt);
    const end = Date.parse(e.endsAt);
    const deadline = Date.parse(e.registrationDeadline);
    if (!(end > start)) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be after start' });
    if (deadline > end) {
      ctx.addIssue({ code: 'custom', path: ['registrationDeadline'], message: 'Deadline must be before the event ends' });
    }
    if (e.registrationOpensAt && Date.parse(e.registrationOpensAt) >= deadline) {
      ctx.addIssue({ code: 'custom', path: ['registrationOpensAt'], message: 'Registration must open before the deadline' });
    }
    if (e.mode === 'team') {
      if (e.teamSize.min > e.teamSize.max) {
        ctx.addIssue({ code: 'custom', path: ['teamSize', 'min'], message: 'Minimum cannot exceed maximum' });
      }
      if (e.teamSize.max < 2) {
        ctx.addIssue({ code: 'custom', path: ['teamSize', 'max'], message: 'Team events need a maximum of at least 2' });
      }
    }
    e.schedule.forEach((item, i) => {
      const s = Date.parse(item.startsAt);
      const f = Date.parse(item.endsAt);
      if (!(f > s)) ctx.addIssue({ code: 'custom', path: ['schedule', i, 'endsAt'], message: 'Ends before it starts' });
      if (s < start || f > end) {
        ctx.addIssue({ code: 'custom', path: ['schedule', i, 'startsAt'], message: 'Outside the event window' });
      }
    });
  });
export type EventInput = z.input<typeof EventInputSchema>;
export type EventInputParsed = z.output<typeof EventInputSchema>;

export const EventStatusChangeSchema = z.object({
  status: z.enum(EVENT_STATUSES),
});

export const StaffAssignmentSchema = z.object({
  staff: z
    .array(z.object({ email: emailField, role: z.enum(STAFF_ROLES) }))
    .max(100),
});

export const EventListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  mode: z.enum(REGISTRATION_MODES).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  availability: z.enum(['open', 'all']).optional(),
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

/* ------------------------------------------------------------------ registrations & teams */

export const RegisterIndividualSchema = z.object({ profile: ProfileFieldsSchema.default({}) });

export const CreateTeamSchema = z.object({
  name: z.string().trim().min(2, 'Team name needs at least 2 characters').max(60),
  profile: ProfileFieldsSchema.default({}),
});

export const teamCodeField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/, 'Team codes are 8 characters, e.g. K7QF-4XM2'));

export const JoinTeamSchema = z.object({ code: teamCodeField, profile: ProfileFieldsSchema.default({}) });

export const RenameTeamSchema = z.object({ name: z.string().trim().min(2).max(60) });
export const TransferLeaderSchema = z.object({ userId: objectId });

export const PaymentSubmitSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(4, 'Enter the transaction reference (UTR)')
    .max(64)
    .regex(/^[A-Za-z0-9/_-]+$/, 'Use letters, digits, “/”, “_” or “-”'),
  payerName: optionalText(80),
  note: optionalText(300),
});

export const PaymentDecisionSchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    note: optionalText(300),
  })
  .refine((v) => v.decision === 'verified' || v.note.length >= 3, {
    path: ['note'],
    message: 'Explain why the payment is rejected',
  });

export const PaymentRefundSchema = z.object({ note: z.string().trim().min(3, 'Record how the refund was made').max(300) });

export const ReviewDecisionSchema = z
  .object({ decision: z.enum(['approve', 'reject']), note: optionalText(300) })
  .refine((v) => v.decision === 'approve' || v.note.length >= 3, {
    path: ['note'],
    message: 'Explain why the registration is rejected',
  });

export const CancelRegistrationSchema = z.object({ reason: optionalText(300) });

export const RegistrationListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(REGISTRATION_STATUSES).optional(),
  payment: z.enum(PAYMENT_STATUSES).optional(),
  paymentStage: z.enum(['awaiting_reference', 'awaiting_verification']).optional(),
  participation: z.enum(PARTICIPATION_FILTERS).optional(),
  sort: z.enum(['createdAt', '-createdAt', 'code', '-code', 'name', '-name', 'status', '-status']).default('-createdAt'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/* ------------------------------------------------------------------ documents & participation approval */

export const requirementKeyField = z.string().regex(/^[a-z0-9]{8}$/, 'Unknown document requirement');

export const DocumentRequirementInputSchema = z.object({
  /** Present for requirements that already exist; the server assigns keys to new ones. */
  key: requirementKeyField.optional(),
  type: z.enum(DOCUMENT_TYPES),
  name: z.string().trim().min(3, 'Name the document').max(120, 'Keep the name under 120 characters'),
  description: optionalText(1500),
  required: z.boolean().default(true),
  appliesTo: z.enum(DOCUMENT_SCOPES).default('each_member'),
  deadline: isoDateTime.nullable().default(null),
  formats: z
    .array(z.enum(DOCUMENT_FORMATS))
    .min(1, 'Accept at least one file format')
    .transform((list) => [...new Set(list)]),
  reviewRequired: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type DocumentRequirementInput = z.infer<typeof DocumentRequirementInputSchema>;

export const DocumentConfigSchema = z
  .object({
    /** Organizers explicitly approve each registration's participation after checking documents. */
    approvalRequired: z.boolean(),
    /** Scanners refuse entry until participation is approved. */
    checkInRequiresApproval: z.boolean(),
    requirements: z.array(DocumentRequirementInputSchema).max(10, 'Up to 10 document requirements per event'),
  })
  .refine((v) => !v.checkInRequiresApproval || v.approvalRequired, {
    path: ['checkInRequiresApproval'],
    message: 'Check-in can only wait for an approval organizers actually give — turn on participation approval first',
  })
  .refine((v) => new Set(v.requirements.filter((r) => r.key).map((r) => r.key)).size === v.requirements.filter((r) => r.key).length, {
    path: ['requirements'],
    message: 'A requirement appears twice',
  });
export type DocumentConfigInput = z.infer<typeof DocumentConfigSchema>;

export const DocumentReviewSchema = z
  .object({
    action: z.enum(['approve', 'request_changes', 'reject', 'comment']),
    note: optionalText(1000),
    /** The version the reviewer opened. A newer upload makes the decision stale (409). */
    version: z.number().int().min(1),
    /** The status the reviewer saw. Someone else deciding first makes the decision stale (409). */
    expectedStatus: z.enum(DOCUMENT_STATUSES),
  })
  .refine((v) => v.action === 'approve' || v.note.length >= 3, {
    path: ['note'],
    message: 'Tell the participant what needs to change',
  });
export type DocumentReviewInput = z.infer<typeof DocumentReviewSchema>;

export const ParticipationDecisionSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'reopen']),
    note: optionalText(500),
    /** The `participation.rev` the organizer was looking at; a change since then makes the decision stale (409). */
    rev: z.number().int().min(0),
  })
  .refine((v) => v.action !== 'reject' || v.note.length >= 3, {
    path: ['note'],
    message: 'Explain why participation is not approved',
  });

/* ------------------------------------------------------------------ check-in */

export const CheckInSchema = z
  .object({
    token: z.string().trim().max(200).optional(),
    ticketId: objectId.optional(),
  })
  .refine((v) => Boolean(v.token) !== Boolean(v.ticketId), { message: 'Provide either a scanned token or a ticket' });

export const VoidCheckInSchema = z.object({ reason: z.string().trim().min(5, 'Explain the correction').max(300) });

export const LookupQuerySchema = z.object({ q: z.string().trim().min(2).max(80) });

/* ------------------------------------------------------------------ venues */

export const VenueInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  building: z.string().trim().min(1).max(60),
  roomCode: z.string().trim().max(24).default(''),
  kind: z.enum(VENUE_KINDS),
  capacity: z.number().int().positive().max(100000),
  facilities: z.array(slug).max(30).default([]),
  accessibility: z
    .object({ stepFree: z.boolean().default(false), notes: optionalText(300) })
    .default({ stepFree: false, notes: '' }),
  availability: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      opensAt: hhmm,
      closesAt: hhmm,
    })
    .refine((a) => a.opensAt < a.closesAt, { path: ['closesAt'], message: 'Closing time must be after opening time' })
    .nullable()
    .default(null),
  turnoverMinutes: z.number().int().min(0).max(240).default(30),
  active: z.boolean().default(true),
});
export type VenueInput = z.input<typeof VenueInputSchema>;

export const AllocateVenueSchema = z.object({
  venueId: objectId,
  status: z.enum(ALLOCATION_STATUSES).default('confirmed'),
});

export const SuggestVenueSchema = z.object({
  expectedAttendance: z.number().int().positive().max(100000).optional(),
  requiredFacilities: z.array(slug).max(20).optional(),
});

export const PlanAllocationsSchema = z.object({ eventIds: z.array(objectId).min(1).max(100) });

export const RangeQuerySchema = z.object({ from: isoDateTime, to: isoDateTime }).refine(
  (r) => Date.parse(r.to) > Date.parse(r.from) && Date.parse(r.to) - Date.parse(r.from) <= 1000 * 60 * 60 * 24 * 200,
  { message: 'Range must be positive and at most 200 days' },
);

/* ------------------------------------------------------------------ imports */

export const ImportMappingSchema = z.object({
  mapping: z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200).nullable()),
  options: z
    .object({
      layout: z.enum(['auto', 'per_participant', 'per_registration']).default('auto'),
      treatPaidAsVerified: z.boolean().default(false),
    })
    .default({ layout: 'auto', treatPaidAsVerified: false }),
  decisions: z.record(z.string().max(80), z.string().max(80)).default({}),
});
export type ImportMappingInput = z.input<typeof ImportMappingSchema>;
