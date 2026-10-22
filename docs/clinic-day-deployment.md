# Clinic-day update

Apply `202610210003_clinic_day.sql` after the two existing migrations. It adds arrival timestamps, completion snapshots, job claim timestamps, and delivery receipts. It also adds authenticated clinic-day/settings functions and service-only receipt processing. Existing visits and patient records are retained.

Completion can be undone for five minutes. Undo restores the prior status and reminders, retains an audit trail, and fails if restoring the appointment would exceed capacity or conflict with another active booking. Arrival is available only for today's active appointments.

Settings persist in Supabase for production and browser storage for demo mode. Dentists and administrators can edit settings; receptionists can read them. Reduced capacity and newly blocked dates never delete existing appointments. The impact review requires acknowledgement of conflicts, and the server checks again during saving. Pending reminders are regenerated at 06:00 UTC using the configured days. Messages include the saved clinic name and contact number.

## SMS gateway receipt contract

The HTTP adapter expects the gateway to honor `idempotencyKey` and return `{ "id": "provider-message-id" }` after accepting a message. An accepted message remains **sent** until a verified delivery receipt arrives. This is a gateway contract, not an integration with a particular SMS vendor; configure your gateway or a vendor-specific adapter accordingly.

Set `SMS_WEBHOOK_SECRET` on the server and gateway. POST a raw JSON body to `/api/notifications/receipt`:

```json
{"eventId":"unique-event-id","providerMessageId":"provider-message-id","status":"delivered"}
```

`status` can be `delivered` or `failed`. Send `x-delivery-timestamp` as Unix seconds and `x-delivery-signature` as the hex HMAC-SHA256 of `timestamp + "." + rawBody`, using the shared secret. Requests older than five minutes or with invalid signatures are rejected. Event IDs are deduplicated. A failure receipt cannot overwrite delivered status. Retry HTTP 503 responses with a fresh signature; the send attempt may not have been committed yet when the callback first arrives.

## Worker recovery and retries

The daily cron stays `0 6 * * *`, with `CRON_SECRET` authentication. Requests process small concurrent batches within a bounded execution window. Provider requests time out after 15 seconds. Explicit failures retry at the next daily run up to the attempt limit. On the next worker run, processing jobs older than ten minutes are recovered: simulated jobs are safe to retry, while live jobs are marked failed with “Delivery uncertain.” Check the provider before using Retry for those jobs. Retrying uses the same provider idempotency key. Only a provider that actually honors that key can guarantee deduplication after an ambiguous network failure.

Live sending still requires production mode, environment enablement, clinic enablement, configured credentials, and patient consent. No live SMS or production database change was performed by the automated tests.

See [dentist-trial.md](dentist-trial.md) for the phone trial and observation sheet. The trial has been rehearsed automatically; actual dentist feedback remains to be collected.
