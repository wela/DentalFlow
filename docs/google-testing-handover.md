# Google Calendar testing and handover

## Deployment prerequisites

Apply `supabase/migrations/202610240006_google_handover.sql` after migration 005, then deploy the application. Back up the database first. No live database migration or Google authorization is performed by the code changes alone.

Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and a stable 32-byte base64 `GOOGLE_TOKEN_ENCRYPTION_KEY` in Vercel. Register the exact deployed `/api/google/callback` URL in the Google OAuth web client. The consent flow requests OpenID email identity plus Calendar permissions. Add the developer and doctor as OAuth test users when the Google consent application is restricted to testing. Never expose these secrets as NEXT_PUBLIC variables.

Old connections without a verified Google identity must be disconnected and reconnected. Existing records remain production records; fictional records created before this migration are not automatically eligible for cleanup and require a separate, carefully reviewed migration.

## Developer testing

1. Sign in as the designated workspace owner. Open **Settings → Google Calendar → Testing and handover**.
2. Disconnect any existing Google connection, then choose **Start Test Mode** and type `START TEST MODE`.
3. Use **Connect Google Calendar** and select the developer's Google account. Verify its displayed email. Create or map a calendar for each clinic you want to test.
4. Add fictional patients and appointments only. The amber TEST MODE banner must be visible. Test messages are simulated; calendar events are real and are tagged with their appointment and test session.
5. Verify creation, rescheduling, cancellation and retry behavior in Google Calendar. Production records are hidden and do not consume test capacity.

Browser-only demo mode does not contact Google or Supabase. Use a configured, authenticated Supabase workspace for this integration test.

## Handover checklist

- [ ] While the original test Google account is connected, choose **Clear Test Data** and type `CLEAR TEST DATA`. Continue/retry batches until complete.
- [ ] Resolve every reported Google deletion failure. Local records remain until all tracked events are confirmed removed. Do not manually remove local references to bypass a failure.
- [ ] Click **Disconnect** and confirm. This removes stored tokens and mappings and attempts Google revocation; it does not delete events. If revocation cannot be confirmed, remove DentaFlow access in the Google account's permissions.
- [ ] Choose **Switch to production for handover** and type `SWITCH TO PRODUCTION`.
- [ ] Connect Dr Quartey's Google account, verify the displayed email, and explicitly confirm that email in the handover panel. The previously recorded developer account cannot be used for this production handover.
- [ ] Create/map her calendars for each clinic. Confirm future synchronization appears in her account. Review clinic names, working hours, colors and messaging configuration before real use.
- [ ] Securely hand over the application login and deployment ownership separately; replacing Google Calendar does not transfer the Supabase login or Vercel project ownership.

Cleanup never deletes a Google calendar, even one DentaFlow created during testing. The panel tracks calendar IDs and uncertain creation attempts for manual review. Keeping calendars avoids destroying unrelated events added to them. Cleanup checks both the Google account and event ownership/test-session markers before deleting any event. Clinic settings, hours, colors and production records are retained.

If you disconnect before cleanup, reconnect the original test account to finish. A failed or interrupted cleanup locks test edits and is safely resumable. Test and production classifications cannot be changed through the application. Separate account-bound event references prevent a replacement account from adopting the previous account's events.

Automated tests cover the database migration, isolation, ownership checks, cleanup failure handling and disconnection token removal. A real Google consent/revocation test and deployed Supabase smoke test still require the account owner's interactive authorization.
