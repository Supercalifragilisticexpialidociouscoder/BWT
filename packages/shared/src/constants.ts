/**
 * Canonical enumerations shared by the API and the web client.
 * Labels live next to values so every surface describes a state the same way.
 */

export const USER_ROLES = ['admin', 'organizer', 'participant'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EVENT_STATUSES = ['draft', 'published', 'cancelled', 'completed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const REGISTRATION_MODES = ['individual', 'team'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

/**
 * incomplete – team below its minimum size
 * pending    – awaiting payment verification and/or organizer approval
 * confirmed  – eligible for entry; tickets are issued
 * cancelled  – withdrawn by the participant or an organizer
 * rejected   – declined by an organizer
 */
export const REGISTRATION_STATUSES = ['incomplete', 'pending', 'confirmed', 'cancelled', 'rejected'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const PAYMENT_STATUSES = ['not_required', 'pending', 'verified', 'rejected', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TICKET_STATUSES = ['active', 'checked_in', 'void'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STAFF_ROLES = ['manager', 'checkin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const FEE_BASIS = ['per_registration', 'per_participant'] as const;
export type FeeBasis = (typeof FEE_BASIS)[number];

export const ORGANIZATION_KINDS = ['club', 'department', 'committee', 'chapter'] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const VENUE_KINDS = [
  'classroom',
  'laboratory',
  'auditorium',
  'seminar_hall',
  'conference_room',
  'open_ground',
  'other',
] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];

export const ALLOCATION_STATUSES = ['proposed', 'confirmed'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const CHECKIN_OUTCOMES = ['valid', 'already_checked_in', 'invalid', 'wrong_event', 'not_eligible'] as const;
export type CheckInOutcome = (typeof CHECKIN_OUTCOMES)[number];

/* ------------------------------------------------------------------ documents & participation approval */

/**
 * Kinds of document an event can ask for. CAMPUSFLOW supplies no wording for any of them: organizers
 * describe what they need and may attach their institution's own template.
 */
export const DOCUMENT_TYPES = ['permission_letter', 'guardian_undertaking', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Who a requirement applies to:
 *  registrant  – the person who registered (the team leader for teams)
 *  each_member – every participant, individually (each uploads their own)
 *  team        – one document for the whole team, uploaded by the leader and visible to members
 * For individual registrations all three mean "the participant".
 */
export const DOCUMENT_SCOPES = ['registrant', 'each_member', 'team'] as const;
export type DocumentScope = (typeof DOCUMENT_SCOPES)[number];

export const DOCUMENT_FORMATS = ['pdf', 'jpg', 'png'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** Upper bound for one uploaded document or template. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * submitted          – uploaded; waiting for a reviewer if the requirement needs review
 * approved           – a reviewer accepted this version
 * changes_requested  – a reviewer asked for a corrected file
 * rejected           – a reviewer refused this file; a different one is needed
 */
export const DOCUMENT_STATUSES = ['submitted', 'approved', 'changes_requested', 'rejected'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Participation approval for a registration (separate from registration status: it never changes
 * seats, teams, payments or tickets, and only affects check-in when the event says so).
 *  not_required      – the event asks for no documents and no approval
 *  not_submitted     – at least one required document is missing
 *  submitted         – everything required is in; nothing reviewed yet
 *  under_review      – review has started, or documents are complete and await the organizer's decision
 *  changes_requested – a reviewer asked for a corrected or different document
 *  approved          – approved by an organizer (or every reviewed document approved, when the event
 *                      doesn't ask for a separate decision). Never set by registering.
 *  rejected          – organizers declined participation
 */
export const PARTICIPATION_STATUSES = [
  'not_required',
  'not_submitted',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

/** Organizer filters on the registrations list. */
export const PARTICIPATION_FILTERS = ['approval_pending', 'docs_missing', 'awaiting_review', 'changes_requested', 'approved', 'rejected'] as const;
export type ParticipationFilter = (typeof PARTICIPATION_FILTERS)[number];

/** Suggested facility tags. Venues may use any slug; these are offered in pickers. */
export const COMMON_FACILITIES = [
  'projector',
  'sound_system',
  'microphones',
  'wifi',
  'power_outlets',
  'computers',
  'stage',
  'whiteboard',
  'air_conditioning',
  'livestream',
  'floodlights',
] as const;

export const IMPORT_FIELDS = [
  'externalId',
  'teamName',
  'name',
  'email',
  'rollNumber',
  'department',
  'phone',
  'isLeader',
  'paymentStatus',
  'paymentReference',
  'amountPaid',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const LABELS = {
  role: {
    admin: 'Platform administrator',
    organizer: 'Organizer',
    participant: 'Participant',
  } satisfies Record<UserRole, string>,
  eventStatus: {
    draft: 'Draft',
    published: 'Published',
    cancelled: 'Cancelled',
    completed: 'Completed',
  } satisfies Record<EventStatus, string>,
  mode: {
    individual: 'Individual',
    team: 'Team',
  } satisfies Record<RegistrationMode, string>,
  registrationStatus: {
    incomplete: 'Team incomplete',
    pending: 'Pending',
    confirmed: 'Confirmed',
    cancelled: 'Cancelled',
    rejected: 'Rejected',
  } satisfies Record<RegistrationStatus, string>,
  paymentStatus: {
    not_required: 'Not required',
    pending: 'Pending',
    verified: 'Verified',
    rejected: 'Rejected',
    refunded: 'Refunded',
  } satisfies Record<PaymentStatus, string>,
  ticketStatus: {
    active: 'Valid',
    checked_in: 'Checked in',
    void: 'Void',
  } satisfies Record<TicketStatus, string>,
  staffRole: {
    manager: 'Event manager',
    checkin: 'Check-in volunteer',
  } satisfies Record<StaffRole, string>,
  feeBasis: {
    per_registration: 'per registration',
    per_participant: 'per participant',
  } satisfies Record<FeeBasis, string>,
  venueKind: {
    classroom: 'Classroom',
    laboratory: 'Laboratory',
    auditorium: 'Auditorium',
    seminar_hall: 'Seminar hall',
    conference_room: 'Conference room',
    open_ground: 'Open ground',
    other: 'Other',
  } satisfies Record<VenueKind, string>,
  organizationKind: {
    club: 'Club',
    department: 'Department',
    committee: 'Committee',
    chapter: 'Chapter',
  } satisfies Record<OrganizationKind, string>,
  checkInOutcome: {
    valid: 'Valid ticket',
    already_checked_in: 'Already checked in',
    invalid: 'Invalid ticket',
    wrong_event: 'Wrong event',
    not_eligible: 'Not eligible',
  } satisfies Record<CheckInOutcome, string>,
  documentType: {
    permission_letter: 'Participation permission letter',
    guardian_undertaking: 'Parent / guardian undertaking',
    other: 'Other document',
  } satisfies Record<DocumentType, string>,
  documentScope: {
    registrant: 'The registrant',
    each_member: 'Each participant',
    team: 'One per team',
  } satisfies Record<DocumentScope, string>,
  documentFormat: {
    pdf: 'PDF',
    jpg: 'JPG',
    png: 'PNG',
  } satisfies Record<DocumentFormat, string>,
  documentStatus: {
    submitted: 'Submitted',
    approved: 'Approved',
    changes_requested: 'Changes requested',
    rejected: 'Rejected',
  } satisfies Record<DocumentStatus, string>,
  participationStatus: {
    not_required: 'Not required',
    not_submitted: 'Documents missing',
    submitted: 'Submitted',
    under_review: 'Under review',
    changes_requested: 'Changes requested',
    approved: 'Approved',
    rejected: 'Not approved',
  } satisfies Record<ParticipationStatus, string>,
  participationFilter: {
    approval_pending: 'Approval pending',
    docs_missing: 'Documents missing',
    awaiting_review: 'Awaiting review',
    changes_requested: 'Corrections requested',
    approved: 'Approved',
    rejected: 'Not approved',
  } satisfies Record<ParticipationFilter, string>,
  importField: {
    externalId: 'Registration ID',
    teamName: 'Team name',
    name: 'Participant name',
    email: 'Email',
    rollNumber: 'Roll number',
    department: 'Department',
    phone: 'Phone',
    isLeader: 'Team leader flag',
    paymentStatus: 'Payment status',
    paymentReference: 'Payment reference / UTR',
    amountPaid: 'Amount paid',
  } satisfies Record<ImportField, string>,
} as const;

export function facilityLabel(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
