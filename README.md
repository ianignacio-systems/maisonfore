# MaisonFore

Tee-time booking for golfers and partner golf courses, part of the Maison family. This is the first
build of Release 1: the **tee-sheet engine**, the **partner portal** and the **Maison admin** pages for
reviewing courses. The golfer app and payment in the app come next, on the same engine.

| Folder | What it is |
| --- | --- |
| `packages/engine` | The tee-sheet engine: works out the tee sheet from each course's settings, green fees, booking rules, holds and closures, checks every booking, and prices it line by line (green fees by player type, 9 or 18 holes, carts, caddies, gallery and other fees). Pure TypeScript, no database, so the server, the portal, the golfer app and later MaisonClub all use the same rules. Member features for MaisonClub are built in and switched off for partner courses. |
| `packages/maison-core` | Maison core: the parts every Maison product shares, taken from MaisonPOS v1. Database layer and migrations, the Maison account sign-in check, members and roles, the activity log, addresses (maisonfore.com/coursename), platform admins, and the screen kit (Maison green and gold). MaisonPOS moves onto it after its go-live weeks. |
| `server` | The MaisonFore server: the `/api/v1` API over PostgreSQL (Supabase), Fastify, Node 22. |
| `portal` | The partner portal: React web app. Sign in, add your course, go live, an overview for owners and managers (today, money to collect, the week ahead, what needs attention, the last 30 days), settings (tee times, player types and green fees, carts, caddies and fees, booking rules, holidays), the live tee sheet with a sliding date strip and day and week views (book, move, take counter payments, edit golfer details), staff with roles (owner, manager, starter, view only) (phone, Viber and walk-in bookings, holds and closures, check-in, cancel, no-show), activity log, and Maison admin. |

## Try it on a computer

You need Node 22 and npm.

```
npm install
MAISON_DEV_AUTH=1 PLATFORM_ADMIN_EMAILS=admin@maison.ph npm run dev:server     # http://localhost:8787, in-memory database
npm run dev:portal                                                              # http://localhost:5174
```

Without Supabase settings the portal signs in with any email and no password (local trials only). Sign in
as `admin@maison.ph` to see Maison admin. The in-memory database is empty again each time the server
restarts; set `DATABASE_URL` to a PostgreSQL database to keep data.

## Tests

```
npm test                                   # engine and server (server tests on PGlite, in memory)
TEST_DATABASE_URL=postgres://... npm test   # also runs 30 people booking the same slot at once, on real PostgreSQL
npm run typecheck
```

## How it fits the Maison conventions (as MaisonPOS)

- Money in centavos as whole numbers, times as epoch milliseconds, days as `YYYY-MM-DD`, clock times as
  minutes after midnight in the course's time zone.
- Every row carries `business_id`. Row-level security is on with no policies: only the server reaches the
  database, and every call checks the caller's membership and role first.
- Every change writes the activity log (who, what, when).
- One booking can never push a slot over its player limit: the slot is locked inside the transaction
  that checks and saves the booking.

Setting it up online is in `SETUP.md`.
