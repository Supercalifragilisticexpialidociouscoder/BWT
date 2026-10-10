import type {
  AllocationStatus,
  CheckInOutcome,
  EventStatus,
  FeeBasis,
  ImportField,
  OrganizationKind,
  PaymentStatus,
  RegistrationMode,
  RegistrationStatus,
  StaffRole,
  TicketStatus,
  UserRole,
  VenueKind,
} from './constants';

/** API response contracts. Dates are ISO-8601 strings in UTC. */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface InstitutionDTO {
  id: string;
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

export interface OrganizationDTO {
  id: string;
  name: string;
  slug: string;
  kind: OrganizationKind;
  description: string;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string | null;
  rollNumber: string | null;
  phone: string | null;
  organizations: string[];
  claimed: boolean;
}

export interface StaffEventRef {
  eventId: string;
  title: string;
  slug: string;
  role: StaffRole | 'owner';
  startsAt: string;
  endsAt: string;
}

export interface SessionDTO {
  user: UserDTO | null;
  access: {
    isAdmin: boolean;
    canOrganize: boolean;
    /** Events where the user holds an explicit staff assignment or organizer access. */
    staffEvents: StaffEventRef[];
  };
}

export interface FeeDTO {
  amount: number;
  currency: string;
  basis: FeeBasis;
}

export type RegistrationWindowState = 'open' | 'not_yet_open' | 'closed' | 'full' | 'cancelled' | 'ended' | 'draft';

export interface VenueRefDTO {
  id: string;
  name: string;
  building: string;
  roomCode: string;
}

export interface EventSummaryDTO {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  categoryName: string;
  organization: { id: string; name: string; slug: string };
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string | null;
  registrationDeadline: string;
  mode: RegistrationMode;
  teamSize: { min: number; max: number };
  capacity: number | null;
  fee: FeeDTO;
  status: EventStatus;
  coverUrl: string | null;
  isDemo: boolean;
  venue: VenueRefDTO | null;
  activeRegistrations: number;
  remaining: number | null;
  registrationState: RegistrationWindowState;
}

export interface ScheduleItemDTO {
  startsAt: string;
  endsAt: string;
  title: string;
  location: string;
}

export interface AllocationDTO {
  id: string;
  event: { id: string; title: string; slug: string };
  venue: VenueRefDTO & { capacity: number };
  startsAt: string;
  endsAt: string;
  status: AllocationStatus;
  reason: string;
  createdAt: string;
}

export interface StaffMemberDTO {
  user: { id: string; name: string; email: string };
  role: StaffRole;
}

export interface EventDetailDTO extends EventSummaryDTO {
  description: string;
  eligibility: string;
  rules: string[];
  schedule: ScheduleItemDTO[];
  paymentInstructions: string;
  requiresApproval: boolean;
  allowedDepartments: string[];
  expectedAttendance: number | null;
  requiredFacilities: string[];
  checkInOpensMinutesBefore: number;
  allocations: AllocationDTO[];
  staff: StaffMemberDTO[] | null;
  finalizedAt: string | null;
  viewer: {
    canManage: boolean;
    canCheckIn: boolean;
    registrationId: string | null;
  };
}

export interface PaymentDTO {
  status: PaymentStatus;
  required: boolean;
  amountDue: number;
  currency: string;
  reference: string | null;
  payerName: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: { id: string; name: string } | null;
  note: string | null;
  /** Other registrations in the same event that quote the same reference. */
  duplicateReferenceOf: string[];
}

export interface TicketRefDTO {
  id: string;
  shortCode: string;
  status: TicketStatus;
  checkedInAt: string | null;
}

export interface ParticipantDTO {
  id: string;
  name: string;
  email: string | null;
  rollNumber: string | null;
  department: string | null;
  phone: string | null;
  isLeader: boolean;
  claimed: boolean;
  ticket: TicketRefDTO | null;
}

export interface TeamDTO {
  id: string;
  name: string;
  /** Join code — only visible to team members and event managers. */
  code: string | null;
  codeExpiresAt: string | null;
  leaderId: string;
  memberCount: number;
  status: 'active' | 'disbanded';
}

export interface RegistrationDTO {
  id: string;
  code: string;
  event: {
    id: string;
    title: string;
    slug: string;
    category: string;
    coverUrl: string | null;
    startsAt: string;
    endsAt: string;
    mode: RegistrationMode;
    teamSize: { min: number; max: number };
    fee: FeeDTO;
    paymentInstructions: string;
    requiresApproval: boolean;
    registrationDeadline: string;
    status: EventStatus;
  };
  kind: RegistrationMode;
  status: RegistrationStatus;
  statusReason: string;
  source: 'web' | 'import';
  externalId: string | null;
  primary: { id: string; name: string; email: string };
  team: TeamDTO | null;
  participants: ParticipantDTO[];
  payment: PaymentDTO;
  approval: { required: boolean; decidedAt: string | null; decidedBy: { id: string; name: string } | null; note: string | null };
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  viewer: { isMember: boolean; isLeader: boolean; canManage: boolean };
}

export interface RegistrationRowDTO {
  id: string;
  code: string;
  kind: RegistrationMode;
  status: RegistrationStatus;
  name: string;
  teamName: string | null;
  memberCount: number;
  primaryEmail: string;
  primaryRollNumber: string | null;
  payment: { status: PaymentStatus; reference: string | null; amountDue: number; submittedAt: string | null };
  source: 'web' | 'import';
  createdAt: string;
}

export interface TicketDTO {
  id: string;
  shortCode: string;
  status: TicketStatus;
  /** Opaque signed payload rendered into the QR code. Contains no personal data. */
  qrPayload: string;
  checkedInAt: string | null;
  participant: { id: string; name: string };
  registration: { id: string; code: string; status: RegistrationStatus };
  team: { id: string; name: string } | null;
  event: {
    id: string;
    title: string;
    slug: string;
    startsAt: string;
    endsAt: string;
    venue: VenueRefDTO | null;
    checkInOpensMinutesBefore: number;
  };
}

export interface CheckInResultDTO {
  outcome: CheckInOutcome;
  message: string;
  /** Machine-readable reason for not_eligible outcomes. */
  reason?: 'registration_not_confirmed' | 'ticket_void' | 'window_not_open' | 'window_closed' | 'event_not_active';
  checkInId?: string;
  participant?: { id: string; name: string; rollNumber: string | null; department: string | null };
  team?: { id: string; name: string; arrived: number; size: number } | null;
  registrationCode?: string;
  ticketShortCode?: string;
  checkedInAt?: string;
  checkedInBy?: { id: string; name: string } | null;
  method?: 'qr' | 'manual';
  eventTitle?: string;
}

export interface CheckInRowDTO {
  id: string;
  at: string;
  method: 'qr' | 'manual';
  active: boolean;
  participant: { id: string; name: string; rollNumber: string | null };
  team: { id: string; name: string } | null;
  registrationCode: string;
  ticketShortCode: string;
  staff: { id: string; name: string } | null;
  voidedAt: string | null;
  voidedBy: { id: string; name: string } | null;
  voidReason: string | null;
}

export interface LiveStatsDTO {
  eventId: string;
  generatedAt: string;
  expectedParticipants: number;
  confirmedRegistrations: number;
  checkedIn: number;
  attendanceRate: number | null;
  teams: { total: number; arrivedComplete: number; arrivedPartial: number; notArrived: number } | null;
  /** Check-ins per 5-minute bucket for the trailing 2 hours (oldest first). */
  entryBuckets: { at: string; count: number }[];
  entriesLast15Min: number;
  venue: { name: string; capacity: number; occupancyRate: number } | null;
  recent: CheckInRowDTO[];
  teamBoard: { id: string; name: string; size: number; arrived: number }[];
  window: { opensAt: string; closesAt: string; state: 'not_open' | 'open' | 'closed' };
}

export interface ReportDTO {
  eventId: string;
  kind: 'live_snapshot' | 'finalized';
  generatedAt: string;
  finalizedAt: string | null;
  registrations: {
    total: number;
    byStatus: Record<RegistrationStatus, number>;
    bySource: { web: number; import: number };
  };
  teams: { total: number; complete: number; incomplete: number } | null;
  participants: { total: number; confirmed: number };
  payments: {
    required: boolean;
    byStatus: Record<PaymentStatus, { count: number; amount: number }>;
    currency: string;
  };
  attendance: {
    checkedIn: number;
    expected: number;
    rate: number | null;
    noShows: number | null;
    corrections: number;
  };
  venue: { name: string; capacity: number; peakUtilization: number } | null;
  registrationsByDay: { day: string; count: number }[];
  departments: { department: string; participants: number; checkedIn: number }[];
}

export interface OverviewDTO {
  scope: { eventIds: string[]; label: string };
  totals: {
    events: number;
    registrations: number;
    confirmedRegistrations: number;
    teams: number;
    completeTeams: number;
    participants: number;
    paymentsAwaitingVerification: number;
    paymentsAwaitingReference: number;
    checkedIn: number;
  };
  activity: { day: string; registrations: number }[];
  upcoming: (EventSummaryDTO & { pendingPayments: number })[];
  attention: AttentionItemDTO[];
}

export interface AttentionItemDTO {
  kind:
    | 'payments_awaiting_verification'
    | 'incomplete_teams_near_deadline'
    | 'no_venue'
    | 'venue_conflict'
    | 'pending_approvals'
    | 'duplicate_payment_reference'
    | 'stale_draft'
    | 'unfinalized_report'
    | 'near_capacity'
    | 'deadline_soon';
  severity: 'high' | 'medium' | 'low';
  eventId: string;
  eventTitle: string;
  count: number;
  message: string;
  href: string;
}

export interface WorkspaceEventDTO extends EventSummaryDTO {
  counts: {
    registrations: number;
    confirmed: number;
    participants: number;
    pendingPayments: number;
    checkedIn: number;
  };
  access: StaffRole | 'owner' | 'admin' | 'organization';
}

export interface CalendarEntryDTO {
  id: string;
  title: string;
  slug: string;
  category: string;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  organization: string;
  isDemo: boolean;
  manageable: boolean;
  allocations: { id: string; venueId: string; venueName: string; status: AllocationStatus; startsAt: string; endsAt: string }[];
  conflicts: { allocationId: string; withEventId: string; withEventTitle: string; venueName: string }[];
}

export interface VenueCandidateDTO {
  venue: VenueRefDTO & { capacity: number; facilities: string[] };
  eligible: boolean;
  score: number | null;
  reasons: string[];
  blockers: string[];
}

export interface AllocationSuggestionDTO {
  eventId: string;
  required: { attendance: number; facilities: string[]; startsAt: string; endsAt: string };
  selected: VenueCandidateDTO | null;
  explanation: string;
  candidates: VenueCandidateDTO[];
}

export interface AuditEntryDTO {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  meta: Record<string, unknown>;
}

export interface ImportIssueDTO {
  code:
    | 'missing_required'
    | 'invalid_email'
    | 'duplicate_row'
    | 'conflicting_registration_id'
    | 'duplicate_participant'
    | 'participant_in_other_registration'
    | 'team_too_small'
    | 'team_too_large'
    | 'inconsistent_team'
    | 'unrecognized_department'
    | 'inconsistent_payment'
    | 'duplicate_payment_reference'
    | 'possible_same_person'
    | 'mode_mismatch'
    | 'capacity_exceeded';
  severity: 'error' | 'warning' | 'review';
  rows: number[];
  registrationKey: string | null;
  message: string;
  /** Present for review items: the decision options the organizer must choose from. */
  review?: { id: string; options: { value: string; label: string }[]; default: string };
}

export interface ImportPreviewRegistrationDTO {
  key: string;
  externalId: string | null;
  teamName: string | null;
  action: 'create' | 'update' | 'unchanged' | 'skip';
  participants: {
    row: number;
    name: string;
    email: string;
    rollNumber: string | null;
    department: string | null;
    isLeader: boolean;
    match: 'new_user' | 'existing_user';
  }[];
  payment: { status: PaymentStatus; reference: string | null; amount: number | null };
  issues: number;
}

export interface ImportAnalysisDTO {
  batchId: string;
  filename: string;
  alreadyCommittedAt: string | null;
  layout: 'per_participant' | 'per_registration';
  totals: {
    rows: number;
    registrations: number;
    participants: number;
    create: number;
    update: number;
    unchanged: number;
    skip: number;
    errors: number;
    warnings: number;
    reviews: number;
  };
  issues: ImportIssueDTO[];
  registrations: ImportPreviewRegistrationDTO[];
  canCommit: boolean;
}

export interface ImportUploadDTO {
  batchId: string;
  filename: string;
  headers: string[];
  rowCount: number;
  sample: Record<string, string>[];
  suggestedMapping: Partial<Record<ImportField, string | null>>;
  detectedLayout: 'per_participant' | 'per_registration';
  memberColumnGroups: number;
  previousImportOfSameFile: { batchId: string; committedAt: string | null } | null;
}

export interface ImportResultDTO {
  batchId: string;
  committedAt: string;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  usersCreated: number;
  ticketsIssued: number;
}

export interface ImportBatchDTO {
  id: string;
  filename: string;
  status: 'uploaded' | 'committing' | 'committed';
  rowCount: number;
  createdAt: string;
  committedAt: string | null;
  uploadedBy: { id: string; name: string } | null;
  result: ImportResultDTO | null;
}
