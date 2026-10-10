# Data model

MongoDB via Mongoose (`server/src/models/index.ts`). All instants are UTC. Every collection that the seed writes carries `isDemo`.

```
Institution 1─* Organization 1─* Event
                                  │
          ┌───────────────────────┼──────────────────────────────┬───────────────┐
          │                       │                              │               │
   Registration ──1:1── PaymentRecord                    VenueAllocation *─1 Venue   ImportBatch
     │      │
     │      └─(team)── Team 1─* TeamMembership *─1 User
     │
     ├─1─* Ticket 1─* CheckIn            AuditLog → any entity        Session → User
     │
     └─1─* ParticipantDocument   (one per document slot; files in the private DOCUMENT_DIR)
```

| Collection | Purpose | Key constraints / indexes |
| --- | --- | --- |
| `institutions` | Name, timezone, departments, categories, defaults, requirements, branding | single document per deployment |
| `organizations` | Clubs, departments, committees | `slug` unique |
| `users` | Accounts (participants, organizers, admins); imported people have `claimed: false` | `email` unique |
| `sessions` | Server-side sessions (hash of the cookie token) | `tokenHash` unique; TTL on `expiresAt` |
| `events` | Event, registration rules, fee, schedule (embedded), staff (embedded), document requirements and participation settings (embedded), counters, final report snapshot | `slug` unique; `{status,startsAt}`, `staff.user` |
| `teams` | Team name, join code, leader, `memberCount` | `code` unique; `{event,nameKey}` unique **among active teams** |
| `teammemberships` | User ↔ team | `{event,user}` unique — one team per person per event |
| `registrations` | Individual or team registration, its status, and its participation approval (derived status + counts, the organizer's decision, `rev`) | `code` unique; `activeKey` unique+sparse (one active individual registration per person per event; removed with `$unset` on cancel); `{event,externalId}` unique when present (import idempotency); `{event,participation.status}` |
| `participantdocuments` | One document a registration owes (requirement × person, or × team): current file metadata, earlier versions, review, append-only history | `{registration,slot}` unique — one record per slot; `{event,status}`, `{event,requirementKey}` |
| `paymentrecords` | Fee, status, submitted reference, decision, history | `registration` unique; `{event,referenceKey}` for duplicate-UTR detection |
| `tickets` | One per participant of a confirmed registration | `{event,user}` unique **where `live`** (one valid ticket per person per event); `{event,shortCode}` unique |
| `checkins` | Attendance records; corrections set `active:false` and keep the record | `ticket` unique **where `active`** — the atomic guard against double admission |
| `venues` | Rooms/grounds with capacity, facilities, accessibility, hours, turnover | `{institution,building,name}` unique; `bookingVersion` optimistic lock |
| `venueallocations` | Event ↔ venue booking (`proposed` or `confirmed`) | `{event,venue}` unique; `{venue,startsAt,endsAt}` |
| `auditlogs` | Who did what, when, to which record | `{event,at}`, `{entityType,entityId,at}` |
| `importbatches` | Uploaded CSV rows, mapping, result | `{event,fileHash}` |

## Status rules

Registration status is derived (`server/src/modules/registrations/status.ts`) for active registrations:

1. team below minimum size → `incomplete`
2. fee required and payment not verified → `pending`
3. approval required and not approved → `pending`
4. otherwise → `confirmed` (tickets issued for every participant)

`cancelled` and `rejected` are terminal. When a registration stops being confirmed, its unused tickets are voided (used ones are kept).

## Documents and participation approval

Events can ask for documents (`events.documentRequirements`): a permission letter, a parent/guardian undertaking or another document, each with a name, description, required/optional, who it applies to (the registrant, each participant, or one per team), a deadline, accepted formats (PDF/JPG/PNG), whether organizers review it, and an optional template file. CAMPUSFLOW supplies no wording for any of them.

A registration owes one **slot** per requirement × person (`<key>:<userId>`) or × team (`<key>:team`). Files are written under random names to `DOCUMENT_DIR`, which is never served statically, and are read back only through `GET /api/documents/:id/file` (the person the document is about, team members for team documents, and the event's organizers). Uploads are identified by content (magic bytes), limited to 5 MB, and never overwrite: a replacement keeps the previous file in `previous` and returns the document to review.

Participation status (`modules/documents/status.ts`, pure and unit-tested) is derived from the slots, their documents and the organizer's decision:

1. no required documents and no approval step → `not_required`
2. organizer declined → `rejected`
3. any document with changes requested or rejected → `changes_requested`
4. any required document missing → `not_submitted`
5. documents awaiting review → `submitted` (none reviewed yet) or `under_review`
6. approval step on → `approved` only while the organizer's approval still covers the exact document versions it was given for; otherwise `under_review` (ready for a decision)
7. no approval step → `approved` when every required document that needs review was approved; `submitted` if none needs review

Registering never approves participation, and participation never changes registration status, seats, teams, payments or tickets. Check-in consults it only when the event sets `participation.checkInRequiresApproval`, evaluated live from the database at scan time.

## Concurrency guarantees (no transactions required)

| Race | Guard |
| --- | --- |
| Two scans of one ticket | insert into `checkins` with the partial unique index; the loser gets "already checked in" |
| Registrations at capacity | conditional `$inc` on `events.counters.activeRegistrations` with `$expr` capacity check |
| Joins into a nearly full team | conditional `$inc` on `teams.memberCount < max`, then membership insert (unique `{event,user}`) |
| Two organizers deciding one payment | conditional update from `pending` only |
| Two bookings of one room | write allocation → bump `venues.bookingVersion` only if unchanged since the conflict check → otherwise roll back and retry |
| Double-commit of one import | conditional `uploaded → committing` transition |
| Two first uploads into one document slot | unique `{registration,slot}`: the loser becomes a replacement of the winner |
| Replacing a file while it is being reviewed | review is conditional on the `version` the reviewer opened → the stale decision gets 409 |
| Two reviewers deciding one document | review is conditional on the status the reviewer saw → exactly one wins |
| Two organizers deciding participation | decision is conditional on `participation.rev` → exactly one wins |
| Stale participation status written late | derived fields are written only if `participation.rev` is unchanged since they were computed; every input change bumps `rev` first |
