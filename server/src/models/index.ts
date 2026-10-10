import mongoose, { Schema, model, type Types } from 'mongoose';
import {
  ALLOCATION_STATUSES,
  DOCUMENT_FORMATS,
  DOCUMENT_SCOPES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  EVENT_STATUSES,
  FEE_BASIS,
  ORGANIZATION_KINDS,
  PARTICIPATION_STATUSES,
  PAYMENT_STATUSES,
  REGISTRATION_MODES,
  REGISTRATION_STATUSES,
  STAFF_ROLES,
  TICKET_STATUSES,
  USER_ROLES,
  VENUE_KINDS,
  type AllocationStatus,
  type DocumentFormat,
  type DocumentHistoryAction,
  type DocumentScope,
  type DocumentStatus,
  type DocumentType,
  type EventStatus,
  type FeeBasis,
  type OrganizationKind,
  type ParticipationStatus,
  type PaymentStatus,
  type RegistrationMode,
  type RegistrationStatus,
  type StaffRole,
  type TicketStatus,
  type UserRole,
  type VenueKind,
} from '@campusflow/shared';

/**
 * Data model overview (see docs/DATA_MODEL.md for the relationship diagram):
 *
 *   Institution 1─* Organization 1─* Event
 *   Event 1─* Registration ─1 PaymentRecord
 *   Registration (team) 1─1 Team 1─* TeamMembership *─1 User
 *   Registration 1─* Ticket (one live ticket per participant per event)
 *   Ticket 1─* CheckIn (at most one *active* check-in per ticket)
 *   Event 1─* VenueAllocation *─1 Venue
 *   AuditLog references any entity; ImportBatch belongs to an Event.
 *
 * MongoDB here may run as a standalone server (no multi-document transactions), so
 * integrity guarantees come from unique / partial-unique indexes and conditional
 * single-document updates. Each guard is documented where it is used.
 */

mongoose.set('strictQuery', true);

type Id = Types.ObjectId;

/* ------------------------------------------------------------------ Institution */

export interface IInstitution {
  _id: Id;
  name: string;
  shortName: string;
  timezone: string;
  departments: { code: string; name: string }[];
  categories: { slug: string; name: string }[];
  defaults: { teamSizeMin: number; teamSizeMax: number; currency: string; checkInOpensMinutesBefore: number };
  requirements: { rollNumber: boolean; department: boolean; phone: boolean };
  branding: { tagline: string; accent: string };
  isDemo: boolean;
}

const InstitutionSchema = new Schema<IInstitution>(
  {
    name: { type: String, required: true },
    shortName: { type: String, required: true },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    departments: [{ _id: false, code: { type: String, required: true }, name: { type: String, required: true } }],
    categories: [{ _id: false, slug: { type: String, required: true }, name: { type: String, required: true } }],
    defaults: {
      teamSizeMin: { type: Number, default: 1 },
      teamSizeMax: { type: Number, default: 4 },
      currency: { type: String, default: 'INR' },
      checkInOpensMinutesBefore: { type: Number, default: 120 },
    },
    requirements: {
      rollNumber: { type: Boolean, default: true },
      department: { type: Boolean, default: true },
      phone: { type: Boolean, default: false },
    },
    branding: {
      tagline: { type: String, default: '' },
      accent: { type: String, default: '#FF5A1F' },
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Institution = model<IInstitution>('Institution', InstitutionSchema);

/* ------------------------------------------------------------------ Organization */

export interface IOrganization {
  _id: Id;
  institution: Id;
  name: string;
  slug: string;
  kind: OrganizationKind;
  description: string;
  isDemo: boolean;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    institution: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    kind: { type: String, enum: ORGANIZATION_KINDS, required: true },
    description: { type: String, default: '' },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Organization = model<IOrganization>('Organization', OrganizationSchema);

/* ------------------------------------------------------------------ User */

export interface IUser {
  _id: Id;
  name: string;
  email: string;
  passwordHash: string | null;
  role: UserRole;
  department: string | null;
  rollNumber: string | null;
  phone: string | null;
  organizations: Id[];
  /** False for participants created by an import who have not yet set a password. */
  claimed: boolean;
  isDemo: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null, select: false },
    role: { type: String, enum: USER_ROLES, default: 'participant' },
    department: { type: String, default: null },
    rollNumber: { type: String, default: null },
    phone: { type: String, default: null },
    organizations: [{ type: Schema.Types.ObjectId, ref: 'Organization' }],
    claimed: { type: Boolean, default: true },
    isDemo: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);
UserSchema.index({ rollNumber: 1 }, { sparse: true });

export const User = model<IUser>('User', UserSchema);

/* ------------------------------------------------------------------ Session */

export interface ISession {
  _id: Id;
  tokenHash: string;
  user: Id;
  expiresAt: Date;
  lastSeenAt: Date;
  userAgent: string;
}

const SessionSchema = new Schema<ISession>(
  {
    tokenHash: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true },
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<ISession>('Session', SessionSchema);

/* ------------------------------------------------------------------ Stored files */

/**
 * A privately stored upload. `storedName` is a random server-chosen name inside DOCUMENT_DIR,
 * never under the public /uploads mount; files are served only through authorized routes.
 */
export interface IStoredFile {
  storedName: string;
  /** Sanitised original name, used only as the download filename. */
  originalName: string;
  mime: string;
  size: number;
  sha256: string;
  uploadedBy: Id | null;
  uploadedAt: Date;
}

const StoredFileSchema = new Schema<IStoredFile>(
  {
    storedName: { type: String, required: true },
    originalName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

/* ------------------------------------------------------------------ Event */

export interface IDocumentRequirement {
  /** Stable server-assigned identifier (8 chars); submissions refer to it. */
  key: string;
  type: DocumentType;
  name: string;
  description: string;
  required: boolean;
  appliesTo: DocumentScope;
  deadline: Date | null;
  formats: DocumentFormat[];
  reviewRequired: boolean;
  /** Inactive requirements are hidden from participants; their submissions are kept. */
  active: boolean;
  template: IStoredFile | null;
  createdAt: Date;
}

export interface IScheduleItem {
  startsAt: Date;
  endsAt: Date;
  title: string;
  location: string;
}

export interface IStaffAssignment {
  user: Id;
  role: StaffRole;
  addedBy: Id | null;
  addedAt: Date;
}

export interface IEvent {
  _id: Id;
  institution: Id;
  organization: Id;
  createdBy: Id;
  title: string;
  slug: string;
  /** Short uppercase prefix used to build human registration codes (e.g. HACK-0042). */
  codePrefix: string;
  category: string;
  summary: string;
  description: string;
  eligibility: string;
  rules: string[];
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date | null;
  registrationDeadline: Date;
  mode: RegistrationMode;
  teamSize: { min: number; max: number };
  capacity: number | null;
  fee: { amount: number; currency: string; basis: FeeBasis };
  paymentInstructions: string;
  requiresApproval: boolean;
  allowedDepartments: string[];
  expectedAttendance: number | null;
  requiredFacilities: string[];
  checkInOpensMinutesBefore: number;
  schedule: IScheduleItem[];
  staff: IStaffAssignment[];
  documentRequirements: IDocumentRequirement[];
  participation: { approvalRequired: boolean; checkInRequiresApproval: boolean };
  status: EventStatus;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  finalizedAt: Date | null;
  finalReport: unknown;
  coverPath: string | null;
  counters: { registrationSeq: number; activeRegistrations: number };
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EventSchema = new Schema<IEvent>(
  {
    institution: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    codePrefix: { type: String, required: true },
    category: { type: String, required: true },
    summary: { type: String, required: true },
    description: { type: String, default: '' },
    eligibility: { type: String, default: '' },
    rules: [{ type: String }],
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    registrationOpensAt: { type: Date, default: null },
    registrationDeadline: { type: Date, required: true },
    mode: { type: String, enum: REGISTRATION_MODES, required: true },
    teamSize: { min: { type: Number, default: 1 }, max: { type: Number, default: 1 } },
    capacity: { type: Number, default: null },
    fee: {
      amount: { type: Number, default: 0 },
      currency: { type: String, default: 'INR' },
      basis: { type: String, enum: FEE_BASIS, default: 'per_registration' },
    },
    paymentInstructions: { type: String, default: '' },
    requiresApproval: { type: Boolean, default: false },
    allowedDepartments: [{ type: String }],
    expectedAttendance: { type: Number, default: null },
    requiredFacilities: [{ type: String }],
    checkInOpensMinutesBefore: { type: Number, default: 120 },
    schedule: [
      {
        _id: false,
        startsAt: { type: Date, required: true },
        endsAt: { type: Date, required: true },
        title: { type: String, required: true },
        location: { type: String, default: '' },
      },
    ],
    staff: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: STAFF_ROLES, required: true },
        addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        addedAt: { type: Date, default: () => new Date() },
      },
    ],
    documentRequirements: [
      {
        _id: false,
        key: { type: String, required: true },
        type: { type: String, enum: DOCUMENT_TYPES, required: true },
        name: { type: String, required: true },
        description: { type: String, default: '' },
        required: { type: Boolean, default: true },
        appliesTo: { type: String, enum: DOCUMENT_SCOPES, required: true },
        deadline: { type: Date, default: null },
        formats: [{ type: String, enum: DOCUMENT_FORMATS }],
        reviewRequired: { type: Boolean, default: true },
        active: { type: Boolean, default: true },
        template: { type: StoredFileSchema, default: null },
        createdAt: { type: Date, default: () => new Date() },
      },
    ],
    participation: {
      approvalRequired: { type: Boolean, default: false },
      checkInRequiresApproval: { type: Boolean, default: false },
    },
    status: { type: String, enum: EVENT_STATUSES, default: 'draft' },
    publishedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    finalizedAt: { type: Date, default: null },
    finalReport: { type: Schema.Types.Mixed, default: null },
    coverPath: { type: String, default: null },
    counters: {
      registrationSeq: { type: Number, default: 0 },
      activeRegistrations: { type: Number, default: 0 },
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
EventSchema.index({ status: 1, startsAt: 1 });
EventSchema.index({ 'staff.user': 1 });
EventSchema.index({ category: 1, startsAt: 1 });

export const Event = model<IEvent>('Event', EventSchema);

/* ------------------------------------------------------------------ Team & membership */

export interface ITeam {
  _id: Id;
  event: Id;
  registration: Id | null;
  name: string;
  /** Lower-cased name; unique among active teams of an event. */
  nameKey: string;
  code: string;
  codeExpiresAt: Date;
  leader: Id;
  memberCount: number;
  status: 'active' | 'disbanded';
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TeamSchema = new Schema<ITeam>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    registration: { type: Schema.Types.ObjectId, ref: 'Registration', default: null },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    codeExpiresAt: { type: Date, required: true },
    leader: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    memberCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'disbanded'], default: 'active' },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
TeamSchema.index({ event: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });

export const Team = model<ITeam>('Team', TeamSchema);

export interface ITeamMembership {
  _id: Id;
  team: Id;
  event: Id;
  user: Id;
  role: 'leader' | 'member';
  joinedAt: Date;
}

const TeamMembershipSchema = new Schema<ITeamMembership>({
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['leader', 'member'], required: true },
  joinedAt: { type: Date, default: () => new Date() },
});
/** A participant belongs to at most one team per event. */
TeamMembershipSchema.index({ event: 1, user: 1 }, { unique: true });
TeamMembershipSchema.index({ user: 1 });

export const TeamMembership = model<ITeamMembership>('TeamMembership', TeamMembershipSchema);

/* ------------------------------------------------------------------ Registration */

export interface IRegistration {
  _id: Id;
  event: Id;
  code: string;
  kind: RegistrationMode;
  status: RegistrationStatus;
  statusReason: string;
  /** Individual participant, or the team leader for team registrations. */
  user: Id;
  team: Id | null;
  /**
   * Present only while the registration is active (not cancelled/rejected). A unique sparse
   * index on it guarantees one active individual registration per participant per event.
   * It is removed with $unset (never set to null: sparse indexes still index nulls).
   */
  activeKey?: string;
  approval: { decidedAt: Date | null; decidedBy: Id | null; approved: boolean | null; note: string | null };
  participation: IParticipation;
  source: 'web' | 'import';
  externalId: string | null;
  importBatch: Id | null;
  cancelledAt: Date | null;
  cancelledBy: Id | null;
  cancelReason: string | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Participation approval (documents), separate from registration status. `status` and `counts`
 * are derived (modules/documents/status.ts) and stored so organizers can filter; every write that
 * affects them bumps `rev`, and the derived fields are only written if `rev` is unchanged since
 * they were computed — a late recomputation can never overwrite a newer one.
 */
export interface IParticipation {
  status: ParticipationStatus;
  rev: number;
  counts: { required: number; missing: number; awaitingReview: number; changesRequested: number; approved: number };
  readyForDecision: boolean;
  /**
   * The organizer's explicit decision. An approval records the exact document versions it covered;
   * it stops counting as soon as any of them is replaced or a new document becomes due.
   */
  decision: {
    value: 'approved' | 'rejected';
    by: Id;
    at: Date;
    note: string | null;
    snapshot: { slot: string; version: number }[];
  } | null;
}

const RegistrationSchema = new Schema<IRegistration>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    code: { type: String, required: true, unique: true },
    kind: { type: String, enum: REGISTRATION_MODES, required: true },
    status: { type: String, enum: REGISTRATION_STATUSES, required: true },
    statusReason: { type: String, default: '' },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    team: { type: Schema.Types.ObjectId, ref: 'Team', default: null, index: true },
    activeKey: { type: String, default: undefined },
    approval: {
      decidedAt: { type: Date, default: null },
      decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      approved: { type: Boolean, default: null },
      note: { type: String, default: null },
    },
    participation: {
      status: { type: String, enum: PARTICIPATION_STATUSES, default: 'not_required' },
      rev: { type: Number, default: 0 },
      counts: {
        required: { type: Number, default: 0 },
        missing: { type: Number, default: 0 },
        awaitingReview: { type: Number, default: 0 },
        changesRequested: { type: Number, default: 0 },
        approved: { type: Number, default: 0 },
      },
      readyForDecision: { type: Boolean, default: false },
      decision: {
        type: new Schema(
          {
            value: { type: String, enum: ['approved', 'rejected'], required: true },
            by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            at: { type: Date, required: true },
            note: { type: String, default: null },
            snapshot: [{ _id: false, slot: { type: String, required: true }, version: { type: Number, required: true } }],
          },
          { _id: false },
        ),
        default: null,
      },
    },
    source: { type: String, enum: ['web', 'import'], default: 'web' },
    externalId: { type: String, default: null },
    importBatch: { type: Schema.Types.ObjectId, ref: 'ImportBatch', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: null },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
RegistrationSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
RegistrationSchema.index({ event: 1, status: 1 });
RegistrationSchema.index({ event: 1, createdAt: -1 });
RegistrationSchema.index({ event: 1, 'participation.status': 1 });
RegistrationSchema.index(
  { event: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);

export const Registration = model<IRegistration>('Registration', RegistrationSchema);

/* ------------------------------------------------------------------ Participant documents */

export interface IDocumentHistoryEntry {
  action: DocumentHistoryAction;
  by: Id | null;
  at: Date;
  version: number;
  note: string | null;
}

/**
 * One document slot a registration owes (a requirement × the person or team it is about).
 * Replacing the file keeps the previous one in `previous`; history is append-only. `version`
 * increments on every upload, and reviews are conditional on the version the reviewer opened.
 */
export interface IParticipantDocument {
  _id: Id;
  event: Id;
  registration: Id;
  requirementKey: string;
  /** The person the document is about; null for team-level documents. */
  subject: Id | null;
  /** `<requirementKey>:<subjectId | team>` — unique per registration. */
  slot: string;
  status: DocumentStatus;
  version: number;
  file: IStoredFile;
  previous: (IStoredFile & { version: number; statusWhenReplaced: DocumentStatus })[];
  review: { by: Id; at: Date; note: string | null } | null;
  history: IDocumentHistoryEntry[];
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ParticipantDocumentSchema = new Schema<IParticipantDocument>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    registration: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
    requirementKey: { type: String, required: true },
    subject: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    slot: { type: String, required: true },
    status: { type: String, enum: DOCUMENT_STATUSES, required: true },
    version: { type: Number, required: true, min: 1 },
    file: { type: StoredFileSchema, required: true },
    previous: [
      new Schema(
        {
          storedName: String,
          originalName: String,
          mime: String,
          size: Number,
          sha256: String,
          uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          uploadedAt: Date,
          version: Number,
          statusWhenReplaced: { type: String, enum: DOCUMENT_STATUSES },
        },
        { _id: false },
      ),
    ],
    review: {
      type: new Schema(
        { by: { type: Schema.Types.ObjectId, ref: 'User', required: true }, at: { type: Date, required: true }, note: { type: String, default: null } },
        { _id: false },
      ),
      default: null,
    },
    history: [
      {
        _id: false,
        action: { type: String, required: true },
        by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        at: { type: Date, required: true },
        version: { type: Number, required: true },
        note: { type: String, default: null },
      },
    ],
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
/** One document per slot per registration: concurrent first uploads cannot create two. */
ParticipantDocumentSchema.index({ registration: 1, slot: 1 }, { unique: true });
ParticipantDocumentSchema.index({ event: 1, status: 1 });
ParticipantDocumentSchema.index({ event: 1, requirementKey: 1 });

export const ParticipantDocument = model<IParticipantDocument>('ParticipantDocument', ParticipantDocumentSchema);

/* ------------------------------------------------------------------ Payment */

export interface IPaymentHistory {
  status: PaymentStatus;
  at: Date;
  by: Id | null;
  note: string;
}

export interface IPaymentRecord {
  _id: Id;
  registration: Id;
  event: Id;
  required: boolean;
  status: PaymentStatus;
  amountDue: number;
  currency: string;
  reference: string | null;
  /** Normalised reference used to detect the same UTR quoted by several registrations. */
  referenceKey: string | null;
  payerName: string | null;
  participantNote: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decidedBy: Id | null;
  decisionNote: string | null;
  history: IPaymentHistory[];
  createdAt: Date;
  updatedAt: Date;
}

const PaymentRecordSchema = new Schema<IPaymentRecord>(
  {
    registration: { type: Schema.Types.ObjectId, ref: 'Registration', required: true, unique: true },
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    required: { type: Boolean, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, required: true },
    amountDue: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    reference: { type: String, default: null },
    referenceKey: { type: String, default: null },
    payerName: { type: String, default: null },
    participantNote: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, default: null },
    history: [
      {
        _id: false,
        status: { type: String, enum: PAYMENT_STATUSES, required: true },
        at: { type: Date, required: true },
        by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        note: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true },
);
PaymentRecordSchema.index({ event: 1, status: 1 });
PaymentRecordSchema.index({ event: 1, referenceKey: 1 });

export const PaymentRecord = model<IPaymentRecord>('PaymentRecord', PaymentRecordSchema);

/* ------------------------------------------------------------------ Ticket */

export interface ITicket {
  _id: Id;
  event: Id;
  registration: Id;
  user: Id;
  team: Id | null;
  shortCode: string;
  status: TicketStatus;
  /** True unless the ticket is void; backs the one-live-ticket-per-participant index. */
  live: boolean;
  checkedInAt: Date | null;
  issuedAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
}

const TicketSchema = new Schema<ITicket>({
  event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  registration: { type: Schema.Types.ObjectId, ref: 'Registration', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
  shortCode: { type: String, required: true },
  status: { type: String, enum: TICKET_STATUSES, default: 'active' },
  live: { type: Boolean, default: true },
  checkedInAt: { type: Date, default: null },
  issuedAt: { type: Date, default: () => new Date() },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, default: null },
});
TicketSchema.index({ event: 1, user: 1 }, { unique: true, partialFilterExpression: { live: true } });
TicketSchema.index({ event: 1, shortCode: 1 }, { unique: true });
TicketSchema.index({ event: 1, status: 1 });

export const Ticket = model<ITicket>('Ticket', TicketSchema);

/* ------------------------------------------------------------------ CheckIn */

export interface ICheckIn {
  _id: Id;
  event: Id;
  ticket: Id;
  registration: Id;
  user: Id;
  team: Id | null;
  staff: Id | null;
  method: 'qr' | 'manual' | 'import';
  at: Date;
  /** Only one active check-in may exist per ticket (partial unique index). Corrections set it false. */
  active: boolean;
  voidedAt: Date | null;
  voidedBy: Id | null;
  voidReason: string | null;
  isDemo: boolean;
}

const CheckInSchema = new Schema<ICheckIn>({
  event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  ticket: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
  registration: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
  staff: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  method: { type: String, enum: ['qr', 'manual', 'import'], required: true },
  at: { type: Date, required: true },
  active: { type: Boolean, default: true },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  voidReason: { type: String, default: null },
  isDemo: { type: Boolean, default: false },
});
CheckInSchema.index({ ticket: 1 }, { unique: true, partialFilterExpression: { active: true } });
CheckInSchema.index({ event: 1, at: -1 });
CheckInSchema.index({ event: 1, active: 1, team: 1 });

export const CheckIn = model<ICheckIn>('CheckIn', CheckInSchema);

/* ------------------------------------------------------------------ Venue */

export interface IVenue {
  _id: Id;
  institution: Id;
  name: string;
  building: string;
  roomCode: string;
  kind: VenueKind;
  capacity: number;
  facilities: string[];
  accessibility: { stepFree: boolean; notes: string };
  availability: { days: number[]; opensAt: string; closesAt: string } | null;
  turnoverMinutes: number;
  active: boolean;
  /** Incremented on every booking change; used as an optimistic lock to serialise bookings. */
  bookingVersion: number;
  isDemo: boolean;
}

const VenueSchema = new Schema<IVenue>(
  {
    institution: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    name: { type: String, required: true },
    building: { type: String, required: true },
    roomCode: { type: String, default: '' },
    kind: { type: String, enum: VENUE_KINDS, required: true },
    capacity: { type: Number, required: true },
    facilities: [{ type: String }],
    accessibility: { stepFree: { type: Boolean, default: false }, notes: { type: String, default: '' } },
    availability: {
      type: new Schema(
        { days: [{ type: Number }], opensAt: { type: String }, closesAt: { type: String } },
        { _id: false },
      ),
      default: null,
    },
    turnoverMinutes: { type: Number, default: 30 },
    active: { type: Boolean, default: true },
    bookingVersion: { type: Number, default: 0 },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
VenueSchema.index({ institution: 1, building: 1, name: 1 }, { unique: true });

export const Venue = model<IVenue>('Venue', VenueSchema);

export interface IVenueAllocation {
  _id: Id;
  event: Id;
  venue: Id;
  startsAt: Date;
  endsAt: Date;
  status: AllocationStatus;
  reason: string;
  allocatedBy: Id | null;
  isDemo: boolean;
  createdAt: Date;
}

const VenueAllocationSchema = new Schema<IVenueAllocation>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    venue: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ALLOCATION_STATUSES, required: true },
    reason: { type: String, default: '' },
    allocatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
VenueAllocationSchema.index({ venue: 1, startsAt: 1, endsAt: 1 });
VenueAllocationSchema.index({ event: 1, venue: 1 }, { unique: true });

export const VenueAllocation = model<IVenueAllocation>('VenueAllocation', VenueAllocationSchema);

/* ------------------------------------------------------------------ Audit */

export interface IAuditLog {
  _id: Id;
  actor: Id | null;
  action: string;
  entityType: string;
  entityId: Id;
  event: Id | null;
  summary: string;
  meta: Record<string, unknown>;
  at: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  event: { type: Schema.Types.ObjectId, ref: 'Event', default: null },
  summary: { type: String, required: true },
  meta: { type: Schema.Types.Mixed, default: {} },
  at: { type: Date, default: () => new Date() },
});
AuditLogSchema.index({ event: 1, at: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', AuditLogSchema);

/* ------------------------------------------------------------------ Import batch */

export interface IImportBatch {
  _id: Id;
  event: Id;
  uploadedBy: Id;
  filename: string;
  fileHash: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  status: 'uploaded' | 'committing' | 'committed';
  mapping: Record<string, string | null> | null;
  options: Record<string, unknown> | null;
  committedAt: Date | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
}

const ImportBatchSchema = new Schema<IImportBatch>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    filename: { type: String, required: true },
    fileHash: { type: String, required: true },
    headers: [{ type: String }],
    rows: { type: [[String]], default: [] },
    rowCount: { type: Number, required: true },
    status: { type: String, enum: ['uploaded', 'committing', 'committed'], default: 'uploaded' },
    mapping: { type: Schema.Types.Mixed, default: null },
    options: { type: Schema.Types.Mixed, default: null },
    committedAt: { type: Date, default: null },
    result: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);
ImportBatchSchema.index({ event: 1, fileHash: 1 });

export const ImportBatch = model<IImportBatch>('ImportBatch', ImportBatchSchema);

export const ALL_MODELS = [
  Institution,
  Organization,
  User,
  Session,
  Event,
  Team,
  TeamMembership,
  Registration,
  ParticipantDocument,
  PaymentRecord,
  Ticket,
  CheckIn,
  Venue,
  VenueAllocation,
  AuditLog,
  ImportBatch,
] as const;
