# Notifications

S2.9 (2026-11-10, Ihor's request while restructuring the org chart: "There will be needed notification that you have
been reassigned/suspended etc... via email"). A person hears, in the app and by email, of the changes that concern
them: their manager, their reports, their role, their membership, the agents reporting to them, the invitations they
sent.

## Who gets what

Every notification is written in the transaction that makes the change, so it exists exactly when the change commits.
Two rules hold for all of them: **the actor is never told of their own action**, and **agents get none** (an agent
knowing its manager and project is a later item). A change made by the system (the identity provider: a webhook event,
a reconcile, a first sign-in) has no actor, so nobody is left out.

| Change | Where it is made | Who is told | Kind | Words (the recipient's side) |
| --- | --- | --- | --- | --- |
| A principal moves to another manager (`PUT /org/positions/:principalId`) | `org/service/positions.ts` | the moved person | `manager_changed` | You now report to Bob / You now stand at the top of the org chart |
| | | the old manager | `report_removed` | Mia no longer reports to you; they report to Bob now |
| | | the new manager | `report_added` | Mia now reports to you |
| A leaver's reports move up (a person removed or suspended, an agent archived) | `org/service/lifecycle.ts` (`takeOffChart`) | each moved person, their new manager (not the leaver) | `manager_changed`, `report_added` | as above |
| An agent paused, resumed or archived (`PATCH /agents/:agentId`) | `org/service/agents.ts` | the manager it reported to | `agent_paused`, `agent_resumed`, `agent_archived` | SLOP BOX, an agent reporting to you, was paused |
| A role change (`PATCH /members/:id`, or the provider while active) | `members/service/role.ts`, the identity store | the person | `role_changed` | You are now an admin in Acme (you were a member) |
| A removal (`DELETE /members/:id`, or the provider) | `members/service/remove.ts`, the identity store | the person (not when they left themselves) | `membership_removed` | You were removed from Acme |
| A suspension, a reactivation (the provider) | the identity store | the person | `membership_suspended`, `membership_reactivated` | Your access to Acme is suspended / is back |
| An invitation accepted (any of the five paths a membership starts by) | the identity store | whoever sent the invitation | `invitation_accepted` | Mia accepted your invitation and joined Acme as a member |
| A task enters a person's step (S5.3a, `POST …/tasks/{taskId}/actions`, a task made into a step) | `tasks/service/apply.ts` | the step's assignee | `task_at_step`, or `task_signoff` at a Sign-off | T-12 “Fix the login” is at your step QA / needs your sign-off at Approve |
| A task escalated to its Lead (a send-back over its step's limit) | `tasks/service/apply.ts` | the nearest person at or above the Lead | `task_escalated` | T-12 “Fix the login” was escalated to DEVBOX Platform Coordinator from Code review |
| A task done | `tasks/service/apply.ts` | its creator and the nearest person at or above the Lead | `task_done` | T-12 “Fix the login” is done |
| A step's turn ended and nobody moved the task (S5.3b) | `tasks/service/runs.ts` | the nearest person at or above the Lead, and the step's assignee when a person | `task_turn_ended` | Developer ended its turn on T-12 “Fix the login” at Develop; nobody has moved it on yet |
| A step's turn could not start, or failed (S5.3b) | `tasks/service/runs.ts` | the same | `task_blocked` | T-12 “Fix the login” is blocked at Develop: Developer's turn could not start or failed |

An agent moved between managers tells both managers; a move of an agent under an agent, or a pause of an agent whose
manager is an agent, tells nobody. A restore from the archive reports to the one who restored it, so nobody else hears
of it. A title change alone tells nobody.

The org and members modules call the notifications service (`notify`, `noticeChartMove`, `noticeAgentStatus`,
`noticeMembership`) in their own transactions. The identity store cannot import it (the notifications module reads
people's profiles through the identity service), so it calls `MemberChart.noticeChange`, an optional method on the
port it already had for the org chart, which `createApp` composes with the notifications module's
`membershipNoticeHook` (`withMemberChart` in `app.ts`). A change a member made through the API and then came back from
the provider (a webhook) is told once: the store sees the membership already in that state.

## Data

Migration `0020_notifications` (generated after `main`'s `0019_agent_icons`; see "Merging" below):

- `notifications` (tenant): `recipient_principal_id` (a composite key to `principals`), `kind` (`NotificationKind`),
  `payload` jsonb (principal ids: `about`, `from`, `to`, and `role`, `previousRole`; a task's notice also `task`, its
  id, whose key and title are read when it is shown, and `step`, the step's name then (S5.3a); names are read when it is shown, so
  a renamed person reads with their new name), `actor_principal_id` (null: the system), `created_at`, `read_at`, and
  the email's state: `email_status` (`pending`, `sent`, `failed`, `skipped`), `email_queued_at` (when the jobs loop
  first saw it, by its clock), `email_next_at` (not before this after a failed try), `email_attempts`, `emailed_at`,
  `email_error` (why it failed or was skipped). Indexed for a person's page (`company_id, recipient, id`), their unread
  ones (partial, `read_at is null`) and the pending emails (partial, `email_status = 'pending'`).
- `notification_settings` (tenant, one row per principal): `email` boolean, default true; no row means the defaults.

The delivery job's cross-company reads are `modules/notifications/repo/delivery.ts`, in Biome's raw-access exemption
like the machines' `repo/upkeep.ts`; everything else goes through `tenant(db, companyId)`.

## API

Under `/api/companies/:companyId/notifications`, for every active member (viewer and above), always the caller's own:

- `GET /notifications?before=<id>&limit=<1..50>`: newest first, 20 by default, with `unreadCount` and `nextBefore` (the
  `before` of the next page, null on the last). Each notification: `{id, kind, text, actor: {principalId, name} | null,
  path, createdAt, readAt}`; `path` is where it points inside the company (`/<slug>/<path>`: `structure`,
  `structure/people`, `agents/<slug>`), null after a removal or a suspension.
- `POST /notifications/read` with `{ids: [...]}` (1 to 100) or `{all: true}`: answers `{unreadCount}`. Ids that are not
  the caller's change nothing.
- `GET /notifications/settings` and `PUT` with `{email}`: `{email, serverEmail}`, where `serverEmail` is MWC_EMAIL.

A suspended or removed person has no access to the company any more; their notification waits in the table and goes
out by email.

## Email

- **The port.** `EmailSender` (`apps/server/src/platform/email/port.ts`): `send({to, subject, text})`, rejecting means
  try again. `platform/email/select.ts` picks the sender MWC_EMAIL names; tests pass their own (`AppDeps.email`,
  read by `moduleJobs`).
- **The development outbox** (`platform/email/outbox.ts`, MWC_EMAIL=`outbox`, the development default): each email is
  an `.eml` file in `.data/outbox/` (git-ignored, files 0600), and one log line. Nothing leaves the computer. Read it
  with `pnpm mwc dev outbox [--last N] [--full]` (newest first, one line each: date, to, subject; or in full), or open
  the files in any mail app.
- **SMTP: not built yet.** The configuration knows `MWC_EMAIL=smtp`, `MWC_SMTP_URL` (smtp:// or smtps://, a secret) and
  `MWC_EMAIL_FROM`, and refuses `smtp` at startup ("smtp is not built yet"). It was left out on purpose: plain SMTP
  needs a client library, and the usual one (nodemailer) ships several releases a week with types that lag its major
  version. The sender is one file implementing the port; when it is built, it takes the URL from the environment only.
- **Off.** MWC_EMAIL=`off`, the default outside development (production, tests): due emails are recorded `skipped`
  ("email is off on this server"). No test and no development server sends real email without explicit configuration.
- **What an email says.** One notice: its sentence is the subject, the body says it with who did it, then a link to
  its page in the app (`MWC_WEB_ORIGIN/<slug>/<path>`, the app's start after a removal or suspension). Several: "3
  changes for you in Acme", the first three listed and "and N more", a link to the org chart. A last line says how to
  turn the emails off.
- **Batching.** The jobs loop (`deliverEmails`, a job of its own that runs with or without an identity provider) first
  stamps the new pending notices with its clock, then emails each person whose batch is due: the newest has been
  quiet for a minute (`EMAIL_QUIET_MS`), or the oldest has waited five (`EMAIL_MAX_WAIT_MS`), and none waits for a
  retry. Several moves within a minute become one email; a long burst still goes out after five minutes. At most 20
  people per tick (every 5 s).
- **Retries.** A failed send counts a try on every notice of the batch and waits the jobs' backoff (30 s doubling to an
  hour, `platform/jobs/retry.ts`); the 12th failed try marks them `failed`, with the error in `email_error`. A success
  marks them `sent` with `emailed_at`. The send happens outside a transaction, so a process killed between the send and
  the mark sends that email again.
- **Skips.** Notices the person read in the app before their email went are skipped ("read in the app first") and the
  rest sent; a person who turned email off, one with no address, and a server with email off skip the batch.
- **The preference.** Per person and company, on by default: the switch at the bottom of the bell's panel ("Email me
  these"). The profile page (`/profile`) is the person's name and photo across every company, so a per-company
  setting sits with the notifications instead.

## Web

The top bar's bell (`apps/web/src/features/notifications/NotificationsBell.tsx`, in every company page through
`CompanyShell` and `AppShell`'s `bell`) shows the unread count and opens a panel: the newest 20 (Show older for more),
each with its words, who did it and how long ago, unread ones marked with a dot. Opening one marks it read and goes to
its page; Mark all read clears the count; the email switch sits at the bottom with what this server does with email.
It refreshes every minute while the page is visible, and when the tab comes back (`api/notifications.ts`); there is no
live channel to the web yet. The attention feed (the right rail, the inbox of S6) keeps its own button beside the
bell, shown while it holds something.

## Merging

- The migration is `0020_notifications`, generated on top of `0019_agent_icons`; it has no `-- custom:` part. If another
  migration (the org chart's invitation manager) lands on `main` first, regenerate rather than hand-edit: drop
  `0020_notifications.sql`, `meta/0020_snapshot.json` and its journal entry, then `pnpm --filter @mwc/db exec
  drizzle-kit generate --name notifications` and `pnpm --filter @mwc/db diagram`.
- The dev database is not migrated by this branch.

## Tests

`apps/server/test/modules/notifications/`: the rules (who gets what, the actor and agents left out, batching, the
backoff) and the words; the routes (paging, the unread count, read marks by id and all, nobody else's, tenant
isolation for someone in two companies, the settings, refusals); each trigger through the real API or the identity
store (`service/chart.test.ts`, `agents.test.ts`, `members.test.ts`, the invitation accepted on each of the five paths a
membership starts by, told once); and the delivery on the test clock (a minute's batch, the five-minute cap, a retry, a
give-up after the last try, the preference, email off, read first, the jobs loop's sender). `test/platform/email/`: the
message text and the outbox files. `packages/cli/test/outbox.test.ts`: `mwc dev outbox`.
