# DentaFlow dentist trial — 20 minutes

Use demo mode and fictional patients on the dentist's own phone. Record the device, screen size, browser, date, and the dentist's role. Start from Overview. Reset demo data if necessary. This is a trial guide; no dentist observation has been performed by the automated tests.

## Tasks to observe

1. Register a fictional patient with messaging consent and a four-week follow-up. Ask the dentist to explain the consent checkbox.
2. Schedule a Friday, then add a recommended patient. Ask whether the occupied/free count is clear.
3. Set a small capacity in Settings, review the effect, and try to add one patient beyond capacity. Confirm the existing bookings remain.
4. On a Friday, open Today's queue and tap Complete (or swipe left), then book the next visit: 4 weeks, 6 weeks, a custom Friday, or Not now. Try Undo. Swipe right to reschedule. Add a walk-in. At the end, use Finish the day to mark anyone who didn't come, and check they appear under Needs rescheduling.
5. Open a past unfinished visit, reschedule it to the following available Friday, then cancel it. Verify history and the released slot.
6. Edit a phone number and follow-up interval. Check that old visits remain in history.
7. Block a Friday with bookings in Settings. Read the impact review, acknowledge the bookings, save, and resolve the affected visits from the calendar.
8. Open Messages after booking or cancelling. Distinguish simulated messages from real delivery statuses. For a failed message, use Retry; for an uncertain send, check the provider first.

## Record for each task

| Task | Finished unaided? | Time | Taps / backtracks | Confusing words or controls | Dentist's comment |
| --- | --- | --- | --- | --- | --- |
| Register | | | | | |
| Schedule / recommendation | | | | | |
| Capacity | | | | | |
| Complete / book next / Undo | | | | | |
| Reschedule / cancel | | | | | |
| Edit patient | | | | | |
| Settings / blocked date | | | | | |
| Messages / retry | | | | | |

Allow the dentist to attempt each task without coaching. Note the first hesitation, mis-tap, unexpected screen, and any request for help. Ask at the end: “What would slow you down between patients?” and “Which action should take fewer taps?”

## Automated rehearsal

`tests/clinic-trial.test.ts` exercises registration, a full Friday, completion, Undo, next-Friday rescheduling, cancellation, and settings impact review through the application components. It uses fictional data and never contacts a real provider. Other tests cover swipe confirmation, patient edits, PostgreSQL constraints, signed receipts and interrupted delivery recovery. These checks do not replace observing the dentist or testing an actual phone/browser rendering.
