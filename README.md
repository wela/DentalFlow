# DentaFlow

The Friday workflow update is described in [docs/friday-workflow.md](docs/friday-workflow.md). Existing installations must apply the additive `202610210002_friday_workflow.sql` migration before using the updated screens. It preserves patient and visit records and adds quick actions, history, and transactional notification creation.

DentaFlow is a responsive dental appointment scheduling and patient follow-up MVP for a Friday-based clinic in Ghana. It includes a polished dentist dashboard, patient directory, capacity-aware calendar, mock message inbox, analytics, clinic settings, secure-link patient UX, reusable scheduling logic, and a Supabase schema with clinic isolation and concurrency-safe booking.

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
- Patient links store only an HMAC-SHA-256 token hash, expire, and are marked used transactionally by `respond_to_appointment`. Use a cryptographically random raw token in the URL and never persist or log that raw token.
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

Required production variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_DEMO_MODE=false`, a random `TOKEN_HASH_SECRET`, and a random `CRON_SECRET`. Add messaging variables only after validating the chosen provider contract.

## Current credential-dependent work

The production database connection, Auth session UI, real SMS transport, WhatsApp Business webhooks, durable rate limiting, and scheduled job runner require external projects/credentials. All are represented by schema or adapter boundaries; the app remains safe and demonstrable without them.
