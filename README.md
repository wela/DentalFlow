# DentaFlow

The missed-visit update adds the coming-Friday Overview (call list, fill empty slots), swipe right to reschedule, a "Needs rescheduling" list, booking the next visit at completion (4 weeks, 6 weeks or a custom Friday), SMS history on the patient profile instead of a Messages page, tick-box reminder and closed-Friday settings, one-tap completion, Finish the day, walk-ins, a shorter patient form that accepts local numbers (024…), readable dates in SMS and history, and a Friday 06:00 summary SMS to the clinic contact number when live SMS is on. Patient confirmation links and the Mark arrived step were removed. Apply `supabase/migrations/202610220004_missed_visits.sql` after the earlier migrations; it records no-shows and "next visit not booked" in visit history.

The latest clinic-day update adds arrival tracking, five-minute completion Undo, persistent settings with impact review, signed SMS receipts, and interrupted-job recovery. Apply the migrations in order, including `202610210003_clinic_day.sql`; see [deployment notes](docs/clinic-day-deployment.md) and the [dentist trial guide](docs/dentist-trial.md).

The Friday workflow update is described in [docs/friday-workflow.md](docs/friday-workflow.md). Existing installations must apply the additive `202610210002_friday_workflow.sql` migration before using the updated screens. It preserves patient and visit records and adds quick actions, history, and transactional notification creation.

DentaFlow is a responsive dental appointment scheduling and patient follow-up MVP for a Friday-based clinic in Ghana. It includes a polished dentist dashboard, patient directory, capacity-aware calendar, clinic settings, reusable scheduling logic, and a Supabase schema with clinic isolation and concurrency-safe booking.

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env.local`.
3. Run `npm install`.
4. Run `npm run dev` and open `http://localhost:3000`.

The UI starts in safe demo mode. It uses fictional data and never sends SMS or WhatsApp messages. Set `NEXT_PUBLIC_DEMO_MODE=false` only after Supabase is configured; protected staff routes then require a valid Supabase Auth session.

## Supabase setup

1. Create a Supabase project.
2. Apply `supabase/migrations/202610190001_initial_schema.sql` with the Supabase CLI or SQL editor.
3. Create a user in Supabase Auth, add its `user_profiles` record and `clinic_memberships` record, then set the public URL and anon key in `.env.local`.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Never prefix it with `NEXT_PUBLIC_`.
5. Optionally run `supabase/seed.sql`; all supplied patients are fictional.

The `book_appointment` PostgreSQL function serializes bookings per clinic/date with an advisory transaction lock. It checks working days, blocked dates, configured capacity, active booking states, membership, and writes an audit record. Use this RPC for production booking rather than inserting appointments from the browser.

## Messaging

`MockSmsProvider` is the default and performs no network request. To integrate a verified provider, configure `SMS_API_URL`, `SMS_API_KEY`, and `SMS_SENDER_ID` on the server and map the provider's documented request/response contract in `HttpSmsProvider`. Live delivery also requires `MESSAGING_LIVE_ENABLED=true` and the clinic-level `messaging_enabled` setting. The latter should always be checked before sending.

Notification jobs support schedules, retry limits, idempotency keys, delivery attempts, cancellation, and provider responses. Invoke `/api/notifications/process` from a trusted scheduler with `Authorization: Bearer $CRON_SECRET`. A production implementation should atomically claim due rows with `FOR UPDATE SKIP LOCKED`, skip reminders for cancelled/rescheduled appointments, and update attempts from provider webhooks.

WhatsApp is deliberately adapter-ready but disabled until Meta Business credentials, approved templates, webhook verification, and patient opt-in are configured. Personal-account automation is not supported.

## Security notes

- RLS isolates all clinic-scoped data. Dentist/admin-only settings policies are separate from receptionist workflows.
- The middleware offers basic single-instance rate limiting. Use a durable edge rate limiter for multi-instance production.
- This is a scheduling product, not an electronic medical record. It intentionally avoids clinical records.
- Ghana Data Protection Act obligations, provider terms, security controls, and clinical workflows require professional review before real-patient use. This project does not claim legal or production certification.

## Commands

- `npm run dev` — local development
- `npm run typecheck` — TypeScript validation
- `npm test` — unit tests
- `npm run build` — production build

## Deploy to Vercel

Import the repository root into Vercel, add the environment variables, use the default Next.js build settings, and deploy. `vercel.json` schedules notification processing once daily at 06:00 UTC, which is 06:00 in Ghana. This daily schedule is compatible with Vercel Hobby cron limits. Set a strong `CRON_SECRET` in Vercel so cron requests receive the required bearer token. The endpoint atomically claims due jobs using `FOR UPDATE SKIP LOCKED`, so overlapping invocations cannot claim the same pending job; provider idempotency keys further protect retries. The nested `dentaflow` starter is excluded by `.vercelignore`, so Vercel builds this root application only. Keep demo mode enabled and live messaging disabled until Supabase, provider credentials, consent flows, webhook verification, and an operational security review are complete.

Required production variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_DEMO_MODE=false`, and a random `CRON_SECRET`. Add messaging variables only after validating the chosen provider contract.

## Current credential-dependent work

The production database connection, Auth session UI, real SMS transport, WhatsApp Business webhooks, durable rate limiting, and scheduled job runner require external projects/credentials. All are represented by schema or adapter boundaries; the app remains safe and demonstrable without them.

## Dr Quartey's multi-clinic workspace

See [multi-clinic rollout and Google Calendar setup](docs/dr-quartey-workspace.md) before deploying this upgrade. Apply migration 005 after the earlier migrations, then use Settings → Set up four clinics. Google integration requires server credentials, the doctor's authorization, calendar mappings and a real sync test; demo mode does not connect to Google.

## Google testing and safe handover

Apply migration 006 after 005 for account-aware Google connections, isolated Test Mode, protected cleanup and the Settings handover checklist. Follow [Google testing and handover](docs/google-testing-handover.md). Disconnect never deletes calendar events; cleanup is a separate confirmed action.
