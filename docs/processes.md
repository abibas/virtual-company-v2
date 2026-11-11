# Processes: flows, tasks, steps and artifacts

The design Ihor agreed on 2026-11-11 (his words in quotes), for S5.3a, S5.3b, S5.4 and S6. Keep it simple until he
asks for more: one straight row of steps, with "send back" as the only way back, and no branches, conditions or
parallel steps.

## The words

| Word | What it is |
| --- | --- |
| **Team** | A manager on the org chart and the people and agents reporting to it. |
| **Lead** | The team's manager (e.g. DEVBOX Platform Coordinator). It is not a step: "it's obligation to MONITOR what is going on, and distribute tasks… it knows all tasks done… keeping a context". |
| **Flow** | A team's ordered steps. One flow per team to start with. |
| **Step** | A name, a **kind**, an **assignee** (a person or an agent: "who is required to do this job"), what happens when the same task comes back to it, where it sends a task back to, and its send-back limit. |
| **Task** | One piece of work going through the flow, with its thread, its history and its artifacts. |
| **Round** | One more pass through a step after a send-back. |
| **Artifact** | What a step produced for the task: a file, a link or a note. |

## Step kinds

Each kind has its own colour on the board and in the drawing.

| Kind | What it does | Its outcomes |
| --- | --- | --- |
| **Work** | does the job | hand on (to the next step) |
| **Check** | checks someone's work (code review, QA) | pass (to the next step), or send back to an earlier step it names |
| **Sign-off** | a decision by whoever is assigned, a person or an agent | approve (to the next step, or Done after the last step), or send back |

## Per step

- **Assignee:** a person or an agent of the company. Steps hold this assignee; a role that any matching agent could take
  may come later, for parallel developers.
- **Starts:** by itself when a task enters the step, or when someone presses Start.
- **When the same task comes back** (round 2, 3, …): **Keep** continues that step's own conversation of the task; **Fresh**
  starts a new one, given only the hand-off (what changed, the findings). The default is Keep. A conversation belongs to
  one task at one step, so different steps never share one.
- **Sends back to** (Check and Sign-off only): an earlier step.
- **Send-back limit** (Check and Sign-off only, "configurable… in the steps"): after N send-backs from this step, the task
  no longer goes back by itself. It goes to the Lead with the reason, and the Lead decides: retry, change course, or ask a
  person. Each step counts its own send-backs. An empty limit means no limit.

## Task states

`queued` → `active` at a step → `done` or `cancelled`, plus `escalated` (with the Lead).

While a task is active at a step, its step state is one of:
- `waiting` to start;
- `working` (a run is live);
- `needs_person` (a question or a sign-off for a person);
- `blocked`;
- `ended_without_handoff` (the turn ended and nobody moved the task).

The history records every move: created, entered a step, started, handed on, passed, sent back (from, to, why), escalated,
signed off, done and cancelled, each with who did it.

The last step's approval, or its pass, moves the task to Done.

## The Lead

- **Its conversation:** it keeps one ongoing conversation for the team, and compacts it when it gets long.
- **It sees** the whole board: every task, its step, who is on it, and what is done or stuck.
- **It distributes:** it creates tasks, puts them into a step, starts them and orders them.
- **It is told** when a task finishes, is sent back, gets blocked or escalated, or a turn ends without a hand-off.
- **It answers** the team's questions and brings to a person only what needs one.

Until S6 gives agents their tools, people do these moves on the board.

## Artifacts

Each artifact is kept with its task, step and round, and shown on the task:
- a branch or commit;
- review findings;
- QA screenshots and logs;
- a pull request link;
- a plan document.

Agents add them with a tool (S6) or by writing them into the task's folder, which the runner collects at the hand-off
(S5.3b).

## How a flow is written and drawn

Written (what people and agents read):

```
Flow: DEVBOX delivery · Lead: DEVBOX Platform Coordinator

Step          Kind       Who             Comes back again   Sends back to   Limit
Develop       Work       Developer       Keep               —               —
Code review   Check      Code Reviewer   Keep               Develop         3 → Lead
QA            Check      QA              Fresh              Develop         2 → Lead
Approve       Sign-off   Ihor            —                  Develop         —
→ Done
```

Drawn: one row of boxes, coloured by kind, each with its assignee's icon or photo, a Keep or Fresh mark, and the limit
as a small badge. Send-backs are dashed arrows back to their step. The editor adds a step, picks the assignee from the
company, sets the kind and the options, and reorders by dragging.

The team's **board** has the columns Queued, then each step, then Done. Each card shows its round, who works on it, its
step state and how many artifacts it has.

## Stages

| Step | What |
| --- | --- |
| S5.3a | Flows and tasks: the data, the rules, the API, the flow editor, the team's board, the task page, `mwc task`; people move tasks by hand |
| S5.3b | Steps run: entering a step starts its assignee's run, one conversation per task and step (Keep or Fresh), artifacts collected |
| S5.4 | Runs survive a runner or server restart (journal, re-attach, Stop) |
| S6 | Agents' tools: `hand_on`, `pass`, `send_back`, `sign_off`, `attach_artifact`, `ask_user`, `report_blocked`; the Lead's board tools; the Inbox |
| Check | Ihor's DEVBOX team takes one real ticket from the Lead to the end |
| Later | "Assembly line", an animated view of the steps with each step clickable (Ihor's reference: buildindex.dev's assembly template), built once everything above is approved and working; a Fable 5.2 subagent builds it |

## Built in S5.3a (2026-11-11)

The data, the rules, the API and `mwc task` / `mwc flow`, then the web (flow editor, board, task page; "Web" below).
People move tasks by hand; nothing runs yet.

### Tables (migration `0022_flows`)

All four are tenant tables (`company_id`, `UNIQUE(company_id, id)`, composite keys to principals), audited field by
field (`audit_log`, entity types `flow`, `flow_step`, `task`).

| Table | What it holds |
| --- | --- |
| `flows` | `lead_principal_id` (the team's manager, a person or an agent; `UNIQUE(company_id, lead_principal_id)`: one flow per Lead), `name` (1–80), `created_by` |
| `flow_steps` | `flow_id`, `position` (from 1, unique in the flow), `name` (1–60; unique per flow whatever the case, checked by the rules), `kind` (`work`, `check`, `signoff`), `assignee_principal_id`, `starts` (`auto`, `manual`; default `manual`, so nothing starts on entry unless asked), `on_return` (`keep`, `fresh`; default `keep`), `sends_back_to_step_id` (a step of the same table; CHECK: not on a Work step, never itself), `send_back_limit` (1–99 or null; CHECK: not on a Work step) |
| `tasks` | `number` (per company, `UNIQUE(company_id, number)`; the key is `T-<number>`), `flow_id`, `title` (1–200), `description` (markdown, up to 50 000), `priority` (`low`, `normal`, `high`, `urgent`), `state`, `current_step_id`, `step_state`, `rounds` (jsonb: entries and send-backs by step id), `escalation_reason`, `escalation_target_step_id`, `created_by`, `closed_at`. CHECKs keep the state and its columns in step: a step only while `active` or `escalated`, a step state only while `active`, a reason only while `escalated`, `closed_at` only when `done` or `cancelled` |
| `task_events` | the history: `kind` (`created`, `entered`, `started`, `handed_on`, `passed`, `sent_back`, `escalated`, `signed_off`, `routed`, `retried`, `done`, `cancelled`, `edited`), `actor_principal_id` (null: it happened by itself, a step that starts on entry), `from_step_id`/`from_step_name`, `to_step_id`/`to_step_name` (plain ids with the names as they were, so a removed step leaves the history readable), `round`, `reason`, `details` (an escalation's `{code, limit, sendBacks}`, an edit's `{fields}`) |

`notifications.kind` gains `task_at_step`, `task_signoff`, `task_escalated` and `task_done`, and their payload names the
task (`task`) and the step (`step`).

**Steps keep their ids.** The step list is replaced as a whole (`PUT …/flows/{flowId}/steps`): an item with an `id` is
that step, wherever it moves, so the tasks at it stay with it; an item without one is a new step; a step left out is
removed. A removal is refused while a task is at the step or a retry would send one there (409 `step_has_tasks`, naming
the tasks): the Lead routes them elsewhere first. Send-back targets are named by the step's name in the same list, so a
new step can be one. Every move of a task and every change of a flow's steps takes the flow's row lock first, so a step
is never removed while a task enters it.

### The rules (`apps/server/src/modules/tasks/rules/`, pure)

| Action | From | To | Who |
| --- | --- | --- | --- |
| `start` | active, step state `waiting`, `blocked` or `ended_without_handoff` | `working` at the same step | the step's person, the Lead's people, admins |
| `hand_on` (Work) | active | the next step, or `done` after the last | the step's person, the Lead's people, admins |
| `pass` (Check) | active | the next step, or `done` after the last | the step's person, the Lead's people, admins |
| `approve` (Sign-off) | active | the next step, or `done` after the last | the step's person, the Lead's people, admins |
| `send_back` (Check, Sign-off; a reason is required) | active | the step it names, one more round; over its limit: `escalated` to the Lead instead | the step's person, the Lead's people, admins |
| `route` (`toStepId`) | queued, active, escalated | that step | the Lead's people, admins |
| `retry` | escalated | the step the stopped send-back was going to (else the step it escalated from), the escalating step's send-backs back to 0 | the Lead's people, admins |
| `cancel` | queued, active, escalated | `cancelled` | the Lead's people, admins |

- **Entering a step** counts a round there (`rounds[step].entries`). A person's Sign-off waits for them
  (`needs_person`); otherwise a step that starts `auto` is `working` at once (with a `started` row by nobody), and a
  `manual` one is `waiting`.
- **The limit**: with a limit of N, a step's first N send-backs go back; the next one escalates the task (state
  `escalated`, at the step it escalated from, with the reason "Code review sent it back 3 times already, its limit;
  this time: …" and the step a retry goes to). The send-back itself is not refused: the API answers `outcome:
  escalated`.
- **The Lead's people** are the Lead when it is a person, and every person above the Lead on the chart
  (`peopleAtOrAbove` of `@mwc/shared/org-chart`). They, and the company's admins and owners, make every move and change
  the flow, each recorded as themselves. A step's assignee, when a person, makes the step's moves. Members and up create
  tasks (queued; straight into a step only the Lead's people and admins); a task's creator also edits it. Viewers read.
  Agents get no moves until S6 gives them tools.
- **The step list** is refused (422) when empty (`no_steps`), longer than 20 (`too_many_steps`), with two names alike
  (`duplicate_step_name`), an id of no step of the flow (`unknown_step`), an assignee who is not an active person or an
  agent not archived (`assignee_not_found`; a paused agent is fine), a Work step that sends back (`work_sends_back`), or
  a target that is not an earlier step, or a limit without a target (`bad_send_back`).

### Notifications (people only, never the one who moved it)

| When | Who | Words |
| --- | --- | --- |
| A task enters a person's step | the assignee | T-12 “Fix the login” is at your step QA |
| … a person's Sign-off | the assignee | T-12 “Fix the login” needs your sign-off at Approve |
| A task is escalated | the nearest person at or above the Lead | T-12 “Fix the login” was escalated to DEVBOX Platform Coordinator from Code review |
| A task is done | its creator and the nearest person at or above the Lead | T-12 “Fix the login” is done |

They point at `tasks/T-12` in the company (the web's task page, next step).

### The API (`/api/companies/{companyId}/…`)

| Route | Who | Refusals |
| --- | --- | --- |
| `GET flows` | viewer+ | |
| `POST flows` `{leadPrincipalId, name, steps}` | the Lead's people, admins (member+) | 403 `not_lead`, 409 `flow_exists`, 422 `lead_not_found` and the step list's |
| `GET flows/{flowId}`, `GET leads/{lead}/flow` (the Lead's principal id or agent slug) | viewer+ | 404 `flow_not_found` |
| `PATCH flows/{flowId}` `{name}` | the Lead's people, admins | 403 `not_lead`, 404 |
| `PUT flows/{flowId}/steps` `{steps}` | the Lead's people, admins | 403, 404, 409 `step_has_tasks`, 422 the step list's |
| `GET flows/{flowId}/text` | viewer+ | 404: the written form below, as `{text}` |
| `GET flows/{flowId}/board?done=10` | viewer+ | 404 |
| `GET tasks?flowId&state&stepId&assignee&limit&before` | viewer+ | newest first, `nextBefore` pages |
| `POST tasks` `{flowId, title, description?, priority?, stepId?}` | member+ | 403 `not_lead` (a step), 404 `flow_not_found`, 422 `unknown_step` |
| `GET tasks/{taskId}` (`T-12` or the id) | viewer+ | 404 `task_not_found`; with its history and the caller's `actions` |
| `PATCH tasks/{taskId}` `{title?, description?, priority?}` | its creator, the Lead's people, admins | 403 `not_yours`, 404 |
| `POST tasks/{taskId}/actions` `{action, toStepId?, reason?, fromStepId?}` | as the table above | 403 `not_your_step`, `not_lead`; 404; 409 `task_moved` (it left `fromStepId`), `wrong_state`, `already_at_step`; 422 `wrong_kind`, `no_send_back_target`, `reason_required`, `step_required`, `unknown_step` |

Another company's flow or task is the same 404 as none. The action answers `{outcome, task}`, `outcome` one of
`started`, `moved`, `done`, `escalated`, `cancelled`.

**The board** (`GET …/board`): `{flow, columns}`, the columns Queued, then one per step in order (with the step's kind
and assignee), then Done (the latest `done`, 10 by default, at most 50, with `total` counting all) and Escalated. Each
card: `id`, `key`, `title`, `priority`, `round` (its entries into its step; null in Queued and Done), `stepState`,
`assignee` (the step's, the Lead's for an escalated task), `stepId`, `updatedAt`; the most urgent first, then the oldest.
Cancelled tasks are on no column.

**The written form** comes from `flowText` of `@mwc/shared/flows`, so the web and, in S6, the agents write the same
text. A person's step shows a dash for "comes back again" (people keep no conversation).

### The CLI

- `mwc flow show <lead> [--json]`: the written form. The flow is named by its Lead (an agent's slug, a principal id or
  a name) or its own id or name.
- `mwc task create --flow <lead> --title <title> [--step <step>] [--description <text>] [--priority <p>]`
- `mwc task list [--flow <lead>] [--state <state>]`: a table of key, state, step, step state, round, who, priority, title.
- `mwc task show <key>`: the task, where it stands, what you may do, its description and history.
- `mwc task move <key> <action> [--to <step>] [--reason <text>]`: one move; a step by its name or id.

Each takes `--company`, `--json` and `--server` like `mwc org tree`.

### Web

The rail's **Flows** item (a task's page belongs to it too). Every page starts with the path Company structure / Flows /
the flow / `T-12`. The views take their data and calls as props, so the design gallery (`/design/flows`) draws them on
sample records.

| Route | What it shows |
| --- | --- |
| `/:slug/flows` | Every team's flow as a card: the Lead's face, the flow's name, its open tasks, its steps as chips in their kind's colour with the tasks at each, and Queued, Done and Escalated counts (each card reads its board with `?done=0`). "Create a flow" lists the managers without one that the viewer may lead |
| `/:slug/flows/<lead>` | The team's **Board**: Queued, each step (its name, kind colour and assignee's face), Done (the latest 10, "3 of 14") and Escalated. A card shows its key, priority (unless normal), when it last moved, its title, its step state ("Needs you" to the person it waits for), its round from the second on and who has it; it opens the task. **New task** (member and up): title, description (Markdown), priority, and "Start at" a step for those who lead the team. Read again every 30 seconds while the page is visible |
| `/:slug/flows/<lead>/flow` | The team's **Flow**: the drawing (one row of boxes in their kind's colour, each with its assignee's face and name, Keep ↻ or Fresh ✦ on an agent's step, the limit as "3×", then Done; dashed arrows in an SVG under the row from each Check and Sign-off box back to its target) and the written form (`GET …/text`) with Copy. **Edit** (`?edit=1`) for those who lead the team |
| `/:slug/tasks/T-12` | The task: its title (renamed in place), state and step state; its moves (the API's `actions`); the flow drawn with its step ringed and each step's rounds and send-backs under its box; its description (Markdown, edited in place); its facts (flow, step, round, who has it, priority as a select, who made it, when) and its history as a timeline (who, what, from and to which step, the reason, when). Escalated: the reason and where Retry goes. `/:slug/tasks` alone opens the flows |

`<lead>` is an agent Lead's slug or a person Lead's principal id. A Lead without a flow gets the editor that makes one
(`POST …/flows`) for those who may, and "No flow yet" for everyone else. On the org chart a manager's ⋯ menu has "Open
its flow", or "Create its flow" for those who may lead the team.

**Who sees what.** The web works out who leads a team the way the API does, from the chart: an admin or owner, or a
member who is the Lead or above it (`peopleAtOrAbove`). They get Edit, "Start at", the board's drag and "Create a
flow"; the task's creator and they edit a task. The task's moves come from the API (`actions`). The server stays the
judge: a refusal shows its own words.

**The board's drag.** Those who lead the team drag a card (from Queued, a step or Escalated, not Done) onto a step's
column; while it is dragged the columns it may land on are outlined and the others dimmed (Queued, Done, Escalated and
the step an active task is at already). The drop shows the card there at once and sends `route` with `fromStepId` (the
step it was seen at); a refusal (`task_moved`, `wrong_state`, …) puts it back and shows the server's message at the
bottom of the window. Done and Cancel are the task page's buttons.

**The flow editor** edits the step list in place, with a live drawing of the draft above it: the flow's name; per step
its name, kind (Work, Check, Sign-off), assignee (the company's people, then its agents), Starts (Auto, On Start), Comes
back again (Keep, Fresh; an agent's step only), and for Check and Sign-off where it sends back to (an earlier step) and
its limit (a number, or none). Steps move by their handle (the browser's drag and drop) or Up and Down, and are
removed with the bin; a send-back to a removed step is cleared, and a Work step keeps none. A step keeps its id, so
`PUT …/steps` keeps its tasks; send-backs are sent by the target's name. A step with no name, a name used twice, a
send-back to a later step or a limit without a target is marked under the step and holds Save. The server's refusals
show above the buttons (`step_has_tasks` names the tasks).

The web's parts: `apps/web/src/api/flows.ts` (the types inferred from the routes, the hooks, the calls),
`features/flows/` (`list/`, `team/`, `board/`, `drawing/`, `editor/`, `task/`, and `access.ts`, `links.ts`, `words.ts`,
`Face.tsx`), `pages/company/flows/` and `pages/design/flows/`.

### Left for S5.3b (design only, no tables yet)

- **Per-step conversations:** a `task_conversations` row per task and step (the harness session, its machine), made on
  the step's first entry; `on_return: fresh` begins a new one on the next entry and keeps the old one readable. The
  round a conversation began with is the entry's `round`.
- **Artifacts:** a `task_artifacts` row per artifact (task, step, round, kind `branch`, `findings`, `screenshot`,
  `log`, `pull_request`, `document`, a link or a stored file), counted on the board's cards.
- **Starting a run** on entering an agent's `auto` step, and the step states `blocked` and `ended_without_handoff`,
  which only runs and S6's tools set.
