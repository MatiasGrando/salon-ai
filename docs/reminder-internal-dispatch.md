# Automatic appointment reminders

The marketing scheduler calls `processDueReminders({ businessId, limit: 100 })` internally. It does not need an open CRM browser or a user's session cookie. The manual `POST /reminder-automations/process-due` endpoint remains authenticated.

The existing scheduler settings are unchanged: production enables it unless `AUTOMATION_SCHEDULER_ENABLED=false`; `true` explicitly enables it in other environments. The initial cycle runs after 30 seconds and subsequent reminder cycles default to 15 minutes, configurable with `REMINDER_PROCESS_INTERVAL_MINUTES`. This local fix does not enable settings, start a live worker or deploy the application.

The reminder service still checks the active business account, connected WhatsApp configuration, real sending and reminder permissions, automatic mode, an approved Utility template, future confirmed appointments within the configured reminder window, retry limits and delivery claims. Completed deliveries are excluded from subsequent normal cycles. The existing retry policy for an interrupted `PROCESSING` delivery is unchanged; uncertain provider acceptance is not an exactly-once guarantee.

A blocked internal run logs the business ID, `blocked` flag and counts. An unexpected failure logs only the affected business ID and allows subsequent businesses and the existing post-sale processor to continue. Reminder logs do not include message bodies, recipient phones, credentials or raw provider errors. The CRM process action displays a supplied block reason as an error, including when reminders were prepared before the sending gate blocked them.

Scheduled campaigns, automated campaigns, retry jobs and post-sales retain their existing execution paths. Opening the reminder deliveries list can still prepare pending records; pending or historical records alone do not establish that a message was sent.

Run `npm run test:reminder-internal-dispatch` for the offline scheduler/service/authentication and CRM feedback regressions. The scheduler test uses a fixed clock, captured timers, in-memory database methods and a provider fake; network requests are prohibited. It verifies that the HTTP endpoint still rejects requests without a session, internal execution reaches the service, existing gates prevent sends, completed deliveries do not repeat, failures remain isolated per business, and overlapping/closed scheduler callbacks cannot execute.

Verification does not process live pending reminders. Production rollout, settings and live operation remain separate authorized actions.

Local verification on 2026-10-28 passed the scheduler's 21 guard cases, seven CRM feedback cases, 48 offset cases, the existing mode/phone/manual/agenda regressions, CRM script syntax and UTF-8 checks. The full TypeScript check still fails with the same 638 pre-existing diagnostics; comparison of the entire output found no new diagnostics after normalizing only source locations and line endings. Work-unit commits remain pending under the existing native review STOP.
