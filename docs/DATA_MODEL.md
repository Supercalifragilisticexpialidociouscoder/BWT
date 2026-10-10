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
     └─1─* Ticket 1─* CheckIn            AuditLog → any entity        Session → User
```

| Collection | Purpose | Key constraints / indexes |
| --- | --- | --- |
| `institutions` | Name, timezone, departments, categories, defaults, requirements, branding | single document per deployment |
| `organizations` | Clubs, departments, committees | `slug` unique |
| `users` | Accounts (participants, organizers, admins); imported people have `claimed: false` | `email` unique |
| `sessions` | Server-side sessions (hash of the cookie token) | `tokenHash` unique; TTL on `expiresAt` |
| `events` | Event, registration rules, fee, schedule (embedded), staff (embedded), counters, final report snapshot | `slug` unique; `{status,startsAt}`, `staff.user` |
| `teams` | Team name, join code, leader, `memberCount` | `code` unique; `{event,nameKey}` unique **among active teams** |
| `teammemberships` | User ↔ team | `{event,user}` unique — one team per person per event |
| `registrations` | Individual or team registration and its status | `code` unique; `activeKey` unique+sparse (one active individual registration per person per event; removed with `$unset` on cancel); `{event,externalId}` unique when present (import idempotency) |
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

## Concurrency guarantees (no transactions required)

| Race | Guard |
| --- | --- |
| Two scans of one ticket | insert into `checkins` with the partial unique index; the loser gets "already checked in" |
| Registrations at capacity | conditional `$inc` on `events.counters.activeRegistrations` with `$expr` capacity check |
| Joins into a nearly full team | conditional `$inc` on `teams.memberCount < max`, then membership insert (unique `{event,user}`) |
| Two organizers deciding one payment | conditional update from `pending` only |
| Two bookings of one room | write allocation → bump `venues.bookingVersion` only if unchanged since the conflict check → otherwise roll back and retry |
| Double-commit of one import | conditional `uploaded → committing` transition |
