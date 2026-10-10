# CAMPUSFLOW

An event operating platform for university communities: discovery → registration → teams → payment verification → tickets → check-in → live attendance → reports, on one data model.

Built around the workflows of Malla Reddy Technical Campus and Club Infin8, with institution, departments, categories, clubs, venues and branding all configurable. **The bundled dataset is demonstration data** — fictional people and sample events — and the UI labels it as such.

## What's in it

| Area | Screens |
| --- | --- |
| Public | Home with the **Event Universe** (an interactive 3D map of real events: time runs into the distance, rows are categories, height is registrations), time rail, event index, editorial directory with filters, event pages, sign in / sign up |
| Participants | Register solo or create a team and share a join code, join by code, *My events* with a per-registration lifecycle and "needs you" actions, payment-reference submission, team management, document uploads with reviewer feedback and participation status, full-screen QR ticket, profile |
| Organizers | Overview (on-now, attention queue, activity), event editor (details, registration rules, schedule, venue booking + allocation assistant, **documents & participation approval**, staff, activity log), calendar (month/week/agenda, clash markers), registrations with filters and a detail drawer (verify/reject payment, approve, review documents, approve/decline participation, cancel, refund), teams, payment queue, attendance with audited corrections, reports + CSV exports + finalize, CSV import with reconciliation, venues + batch planner, settings (admins) |
| Event day | Live dashboard (real-time arrivals, entry rate, team board) and a phone-first scanner (camera QR or manual lookup) with distinct outcomes for valid / already checked in / invalid / wrong event / not eligible (including "participation not approved", when the event asks for it) / service unavailable |

### Documents and participation approval

Per event, organizers can ask for a **participation permission letter**, a **parent / guardian undertaking** or any other document — a fixed set of fields, not a form builder: name, what it must contain, required or optional, who provides it (the registrant, each participant, or one per team), deadline, accepted formats (PDF/JPG/PNG, up to 5 MB) and whether organizers review it. They can attach their institution's official form as a template; **CAMPUSFLOW never supplies wording** for these documents.

Participants upload from their registration page. Files are stored privately (never under a public URL) and only the person concerned, their team (for team documents) and the event's organizers can open them. Organizers open or download each document and approve it, request changes, reject it or comment; every step is recorded with who and when. Replacing an approved file sends it back to review. With **participation approval** turned on, an organizer explicitly approves or declines each registration once its documents are in order — registering never approves participation — and the event can optionally refuse entry at check-in until then. Participation never changes seats, teams, payments or tickets.

A scanned or typed signature is just a picture for organizers to check by eye: it is **not** a verified digital signature, and CAMPUSFLOW does not check university records.

## Quick start

Prerequisites: **Node 20.19+** (22 recommended) and **MongoDB 6+** running locally (a standalone server is fine).

```bash
npm install
```

```bash
npm run seed
```

```bash
npm run dev
```

Open http://localhost:5173. The API runs on :4000 and Vite proxies `/api`, `/socket.io` and `/uploads` to it.

`npm run seed` **wipes the CampusFlow collections** in `MONGODB_URI` and creates the demo dataset. Event dates are relative to when you run it, so one event (Infin8 Hack Day) is always in progress and the live dashboard has data. Re-run it any time.

### Demo accounts

All use the password `campusflow-demo` (also offered as one-click shortcuts on the sign-in page while demo data is loaded).

| Role | Email |
| --- | --- |
| Participant with a Hack Day ticket | `student@campusflow.demo` |
| Check-in volunteer (Hack Day) | `volunteer@campusflow.demo` |
| Organizer — Club Infin8 head | `head.infin8@campusflow.demo` |
| Organizer — faculty coordinator | `faculty.cse@campusflow.demo` |
| Organizer — cultural committee | `cultural@campusflow.demo` |
| Platform administrator | `admin@campusflow.demo` |

The demo includes **Infin8 Overnight Buildathon**, which collects a permission letter and a parent/guardian undertaking and admits only approved participants. The demo participant leads "Night Owls" there (one document approved, one sent back for changes); `head.infin8@campusflow.demo` reviews. Its sample files are one-page PDFs that say they are demonstration samples — no signatures, no institutional wording.

A sample registration export with deliberate problems (duplicate line, resubmitted team, missing email, oversized team, unknown department, reused UTR, one roll number under two emails) is at `docs/samples/registration-export-sample.csv` — import it from *Workspace → Import*.

## Configuration

The server reads `server/.env` if present (see `server/.env.example`); real environment variables take precedence. Everything has a development default.

| Variable | Default | Notes |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/campusflow` | |
| `PORT` | `4000` | |
| `WEB_ORIGIN` | `http://localhost:5173` | Comma-separated origins allowed to send cookies (CORS + Socket.IO origin check) |
| `TICKET_SECRET` | dev placeholder | HMAC key for QR ticket signatures. **Required in production**; the server refuses to start with the placeholder |
| `SESSION_TTL_DAYS` | `14` | Sliding session lifetime |
| `COOKIE_SECURE` | `true` in production | |
| `TRUST_PROXY` | `0` | Set to the number of proxies in front of the API |
| `UPLOAD_DIR` | `uploads` | Event cover images (publicly served) |
| `DOCUMENT_DIR` | `private-documents` | Participant documents and requirement templates. Never served statically; must not be inside `UPLOAD_DIR` (the server refuses to start otherwise). Back it up with the database |
| `WEB_DIST` | — | Serve the built web app from the API process |
| `LOG_LEVEL` | `info` | Logs are JSON; secrets, tokens and passwords are redacted |

Web: `CAMPUSFLOW_API` (default `http://localhost:4000`) changes the dev proxy target; `VITE_HOST=true` exposes the dev server on your network.

### Phones and the camera scanner

Browsers only allow the camera on **HTTPS or localhost**. To scan from a real phone, expose the dev server over HTTPS (for example through a tunnel, or a reverse proxy with a local certificate) and add that origin to `WEB_ORIGIN`. Manual lookup works everywhere.

## Production

```bash
npm run build
```

```bash
NODE_ENV=production TICKET_SECRET='<32+ random chars>' WEB_DIST=../web/dist MONGODB_URI='<uri>' WEB_ORIGIN='https://your.host' npm start
```

The API then serves the web app (with a CSP) on one origin.

## Architecture

```
packages/shared   Zod schemas, enums, DTO types, timezone helpers — used by both sides
server            Express 5 + Mongoose 8 + Socket.IO (TypeScript, run with tsx, bundled with tsup)
  src/modules/      auth · institution · events · registrations (teams, payments, tickets) ·
                    checkin · venues (pure allocation engine + booking) · reports · imports (pure analyzer)
  src/lib/          access control, crypto, audit, CSV
  src/realtime/     authenticated, event-scoped Socket.IO rooms
web               React 19 + Vite 8 + Tailwind 4 + TanStack Query + React Router 7
  src/three/        React Three Fiber scene (lazy-loaded), 2D fallback, shared layout
  src/features/     public · participant · workspace · live
```

Data model and integrity rules: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

Key decisions:

- **The database is the source of truth.** Socket.IO messages are sent only after a write succeeds and only tell clients what to re-read; clients re-fetch authoritative state on every (re)connect.
- **Concurrency without transactions.** MongoDB may run standalone, so guarantees come from unique / partial-unique indexes and conditional single-document updates: one active check-in per ticket, one live ticket per participant per event, one team per participant per event, atomic capacity and team-slot reservation, and an optimistic version lock per venue for bookings. Each is covered by a concurrency test.
- **Sessions, not JWTs.** Opaque random tokens in an httpOnly, SameSite=Lax cookie; only a SHA-256 hash is stored. Passwords use scrypt (N=2¹⁴, r=8, p=5). State-changing requests must send `X-Requested-With: campusflow` (CSRF defence), and Socket.IO refuses foreign origins. Signing out deletes the server session, closes that session's live sockets, clears every cached response in the browser (other open tabs sign out too) and returns to the public site.
- **Event-scoped authorization** on every route (`server/src/lib/access.ts`): admins, the event creator, organizers of the owning club, and per-event staff (manager or check-in). Unpublished records are reported as 404 to people who can't manage them.
- **Tickets carry no personal data.** The QR payload is `CF1.<ticketId>.<HMAC>`; the server resolves everything else.
- **Time.** Instants are stored in UTC; wall-clock values (forms, opening hours, calendars, reports) use the institution's IANA timezone.
- **Design system.** Tokens live in `web/src/styles/index.css` (Tailwind `@theme`). Colours were checked with a colour-vision validator: the lime accent stays distinguishable from every status colour. One category "grammar" (`web/src/lib/categories.ts`) drives the 3D forms, the 2D fallback, the directory, the calendar and the rail.

## Tests

| Suite | Command | Needs |
| --- | --- | --- |
| Shared unit | `npm test -w packages/shared` | — |
| Server unit + integration | `npm test -w server` | MongoDB (uses database `campusflow_test`, dropped per file; override with `MONGODB_TEST_URI`) |
| Web unit | `npm test -w web` | — |
| End-to-end (Playwright) | `npm run test:e2e` | MongoDB, `npm run seed`, Google Chrome installed (uses your local Chrome with a fresh profile); starts or reuses the dev servers |

`npm test` runs the first three. Integration tests include: sign-out revoking the server session (a replayed cookie is refused, live sockets of that session are closed), document requirements and private submissions (ownership, content sniffing, size limit, deadlines, private storage and download authorization), review with stale-version and concurrent-reviewer protection, participation approval and its check-in gate, CSRF and auth, ID-swapping attempts across organizers, capacity under 7 concurrent registrations, team slots under concurrent joins, two organizers verifying one payment at once, 25 simultaneous scans of one ticket, two simultaneous bookings of one room, CSV import idempotency, Socket.IO authorization, and report finalization. The end-to-end tests walk create → publish → sign up → register → pay → verify → ticket → check-in → live dashboard update in another tab → duplicate refused → CSV export through the real UI; configure a document requirement → upload → review → approve participation; and sign out from both layouts, across tabs, and after a session ended elsewhere.

## Known limitations

- **No email verification.** Anyone can sign up with any address, and participants created by a CSV import "claim" their account by signing up with the same email. Production use needs email verification before claiming.
- **Payments are recorded, not processed.** Organizers verify submitted UTR references against their own statements; there is no payment-gateway integration, and "verified" never means money moved through CampusFlow.
- **No multi-document transactions.** Multi-step operations (e.g. cancelling a team registration: close registration → release slot → void tickets → disband team) are ordered so each step is safe to retry, but a crash between steps can leave a partial state that needs an organizer action to finish.
- Waitlists are not implemented; a full event refuses new registrations.
- Per-participant team fees are recalculated as members join only until the payment is verified.
- Venue occupancy on the live dashboard and reports counts entries; exits are not tracked, so it is an upper bound.
- The homepage landscape shows the next 60 upcoming events (the API page limit); the directory lists everything.
- One institution per deployment. Cover images are stored on the API server's disk.
- Camera scanning needs HTTPS on phones. The decode path is unit-tested (render ticket QR → decode with the scanner's decoder), and the scanner UI was checked in a desktop browser; it was not exercised with a physical phone camera in automated tests.
- Rate limits are per process (in-memory). Revoking someone's staff role takes effect on their next socket subscribe/reconnect, not instantly for an open live dashboard.
- Documents: files are kept on the API server's disk under `DOCUMENT_DIR` (back it up with the database; `npm run seed` wipes the records but leaves files on disk). There is no virus scanning — uploads are limited to PDF/JPG/PNG identified by content, served with `nosniff` and a sandboxing CSP, but a PDF's contents are not inspected. Organizers can only judge documents by eye: signatures are not verified and no university records are consulted. Participation approval is per registration (a team is approved as a whole). Removing a requirement that already has submissions deactivates it instead, so nothing is deleted. Document reviews notify participants only in the app (no email).
- CSV is the only import format; `server/src/modules/imports/service.ts` has an adapter point for others (e.g. XLSX).
