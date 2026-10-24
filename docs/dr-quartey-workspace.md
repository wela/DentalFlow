# Dr Quartey's Workspace: deployment and Google Calendar setup

This extends the existing Next.js/Supabase/Vercel application. It does not create another project or repository. Google is **not operational until the doctor authorizes it and a real synchronization test passes**. Automated tests use mock Google/SMS calls; migrations are tested in isolated PostgreSQL, not applied to production automatically.

## Safe database rollout

1. Back up the existing Supabase database and test the upgrade on a staging copy. Apply existing migrations 001–004 first, then `supabase/migrations/202610240005_multi_clinic.sql`.
2. Existing clinics, patients, appointments, messages and history retain their IDs. Existing clinic profiles default to the legacy UG/date-only model; records are not moved or merged. Inspect legacy clinics before proceeding if you have used the database for anything other than the original Friday workflow.
3. In production, sign in as the doctor (dentist/admin membership), select the existing UG clinic, open Settings and choose **Set up four clinics**. Confirm that its records are UG records. This idempotent action names it UG Dental School, assigns the signed-in doctor, and adds Maritime, Gilead and Aura as empty workspaces. It does not grant other staff access to the new clinics.
4. Review each clinic's name, contact number, working schedule, unavailable dates, duration, reminders and SMS preferences. UG stays Friday/date-only with its existing capacity (8 by default); no existing capacity value is silently reset. Gilead's 13:00–17:00 Saturday hours are provisional. Maritime Monday closing can be changed to 12:30.
5. Existing bookings outside revised hours are preserved and flagged on Overview. Resolve them explicitly. Patient records cannot move across clinics. A patient attending another clinic needs a separate registration there.
6. Deploy the code only after the migration is ready. The new APIs require migration 005. Keep a database backup; do not roll back by dropping the new tables or deleting records. Browsers now use checked appointment RPCs rather than direct appointment writes; update any custom clients accordingly.

## Vercel environment variables

Keep the existing Supabase URL, anon key, server-only service-role key, `APP_URL`, SMS settings and `CRON_SECRET`. For production set `NEXT_PUBLIC_DEMO_MODE=false`; leave live SMS disabled until verified with a consenting test recipient.

Add these **server-only** values (never prefix them with `NEXT_PUBLIC_`):

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth web application client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Exact `https://YOUR-PRODUCTION-DOMAIN/api/google/callback` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Base64 encoding of a cryptographically random 32-byte key |

Generate the encryption key locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, then paste it into Vercel's server environment settings. Do not commit it. Keep it stable across deployments; changing it without re-encrypting tokens requires reconnecting Google. The service-role key and encrypted token tables must remain inaccessible to browsers. Migration 005 enables RLS and removes browser grants on all Google credential/reference tables.

Redeploy after changing environment variables. The existing notification cron remains `/api/notifications/process` with `0 6 * * *` (daily at 06:00 UTC/Africa/Accra), compatible with Vercel Hobby scheduling. Google synchronization happens in the booking request with bounded timeouts, not an hourly cron. Failed/pending syncs are retried explicitly from Overview. No new recurring job is added.

## Google Cloud configuration

1. Create or select the doctor's Google Cloud project and enable **Google Calendar API**.
2. Configure Google Auth Platform/OAuth consent: app name, support contact, authorized production domain, audience, and the application's privacy policy. For an external application in Testing, add the doctor's Google account as a test user. Google's testing/verification and refresh-token policies apply; publish/verify the app as required before relying on long-term production authorization.
3. Create an OAuth 2.0 client of type **Web application**. Add the exact production redirect URI above. For local testing, separately add `http://localhost:3000/api/google/callback` (or your actual local port) and use that same URI in local environment variables. Do not point preview deployments at production authorization unintentionally.
4. Configure scopes requested by this implementation:
   - `https://www.googleapis.com/auth/calendar.events` — read busy event intervals and create/update/delete DentaFlow-owned events.
   - `https://www.googleapis.com/auth/calendar.calendarlist` — list calendars and set the color of a newly created clinic calendar.
   - `https://www.googleapis.com/auth/calendar.calendars` — create optional secondary clinic calendars.
   These scopes do not include ACL/sharing management. The application does not change calendar sharing. The doctor should select private calendars and review any existing calendar sharing herself.
5. Add credentials to Vercel, deploy, then select **Connect Google Calendar** in Settings while signed in as the designated workspace doctor. OAuth uses an expiring encrypted state cookie, PKCE, server-side code exchange and encrypted refresh-token storage. No Google password is requested or stored.
6. For each clinic, select an existing writable calendar, or click **Create a calendar for this clinic**, then select it and save the mapping. Calendar creation is explicit and not automatically retried; if a create response is interrupted, inspect the calendar list before trying again.
7. Choose any additional relevant busy calendars. The primary calendar and all mapped clinic calendars are checked automatically. Selected additional calendars need event-read access; free/busy-only shared calendars cannot be selected by this version. The app reads event intervals server-side and returns only available slots, not personal event details.

Reference documentation: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar event creation and IDs](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [calendar creation](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert), [calendar list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list).

## Synchronization rules and operational limitations

- Titles are exactly `Patient Full Name's Appointment`. No clinic prefix or medical notes are sent. Events are marked private; no patient attendees/invitations are added. Check that the calendars themselves are not publicly shared.
- UG events are individual all-day events with an exclusive next-day end. They are transparent in Google (date-only bookings do not claim a specific time). Timed appointments have an exact start/end in Africa/Accra and are busy events.
- Events use Google's supported palette IDs: UG cyan/teal (7), Maritime blueberry/blue (9), Gilead grape/purple (3), Aura tangerine/orange (6). Google palette shades may differ from customized application colors. Newly created calendars also receive the clinic's requested background color where supported. Existing calendars' colors are not changed automatically.
- A deterministic event ID and private ownership marker identify each DentaFlow appointment. A server-side lease serializes sync attempts. Rescheduling updates that event; cancelling removes only that event; completion retains it. Unrelated Google events are never modified.
- Supabase is the source of truth. Temporary Google failure does not roll back an already saved appointment. The UI shows pending/failed/disconnected and offers **Retry sync**. If availability itself cannot be checked, the doctor must explicitly confirm a manual Google check before saving with sync pending. No failed API call is presented as a successful Google sync.
- Cross-clinic database bookings are serialized under a workspace lock. External Google changes cannot be locked transactionally with Supabase: an unrelated Google event created between availability checking and synchronization can still cause a conflict. Review Google after a connection outage and before retrying pending bookings.
- A failed request after Google created an event can be retried safely using the same event ID. A linked event manually deleted in Google is flagged for review rather than silently recreated. Mapping changes after events have been linked are blocked to avoid leaving duplicate/orphaned events. Migrating an established clinic to another Google calendar needs a controlled migration, not a dropdown change.
- Disconnect revokes Google authorization and removes the stored token; existing events, mapping IDs and appointment history are retained. Reconnect the same account to resume. Google-to-DentaFlow appointment import or two-way editing is not implemented in this phase.
- Patient name changes mark their linked appointments pending; use Overview's sync retry for those existing events. New bookings and appointment changes sync automatically.
- Historical `no show` records are retained. New reschedules of unclosed past visits record `attendance not recorded`, without assuming non-attendance.
- Demo mode remains browser-local, clinic-specific, and simulated. Existing UG demo data keeps its original storage key. Other clinics start empty and can be exercised with fictional registrations; no Google connection or live SMS is used in demo.

## Acceptance test before live use

Use fictional patients first and keep SMS simulated:

1. Switch among all four clinics; register/edit a test patient in Maritime and verify it is absent from Aura, Gilead and UG.
2. Book Maritime Monday 10:00 for 30 minutes and Aura Monday 14:00 for 45 minutes. Verify All Clinics sorts them chronologically. Try an overlap and a visit extending beyond closing; both must be rejected.
3. Book Gilead Saturday afternoon and UG Friday date-only. Check UG capacity and 4-/6-week suggestions.
4. Connect Google and save each calendar mapping. Book one test visit; confirm **synced** in DentaFlow and inspect the real Google event title, calendar, date, timezone, duration and privacy.
5. Reschedule that visit twice, including a same-day time change. Verify there is still only one Google event. Complete and undo; the event must remain. Cancel a separate test visit; only its event should disappear, with DentaFlow history preserved.
6. Add a personal busy event in the selected Google calendar and verify its time is unavailable. Test a failed sync/disconnection and retry; ensure the appointment remains and no duplicate event appears.
7. Check phone layout, keyboard navigation, swipe completion/undo, and appointment action panels with Dr Quartey. Browser visual inspection and a real dentist trial remain manual acceptance steps for this rollout.
8. Only then configure/enable live SMS with a consenting test recipient. Verify the clinic/date/time (no time for UG), provider receipt signing, reminders, cancellation and retry history using the existing SMS deployment guide.
