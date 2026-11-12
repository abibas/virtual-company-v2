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

Since S6a an agent Lead does these moves with its board tools in its own chats ("Built in S6a"); people still do them on
the board. Since S6c it is told by itself: its team's events wake it with a short message in its team chat ("Built: the
Lead wakes up"); a person Lead hears through notifications, as before.

## Artifacts

Each artifact is kept with its task, step and round, and shown on the task:
- a branch or commit;
- review findings;
- QA screenshots and logs;
- a pull request link;
- a plan document.

Agents add them with a tool (`task_attach`, S6a: "Built in S6a" below) or by writing them into the task's folder, which
the runner collects when the step's turn ends (S5.3b, built: "Built in S5.3b" below).

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
| S6 | Agents' tools (S6a, built: the step's moves as `task_hand_on`, `task_pass`, `task_approve`, `task_send_back`, and `task_read`, `task_attach`, `task_blocked`; the Lead's board tools); `ask_user` was built in S5.2; the Inbox (S6b, built: "Built in S6b"); the Lead wakes up by itself and questions are answered from the Inbox (S6c, built: "Built: the Lead wakes up", "Inbox answers") |
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
  Agents get no moves through the API: since S6a they act only through their tools ("Built in S6a").
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

### What S5.3a left to S5.3b

Per-step conversations, artifacts, a run started on entering an agent's step, and the step states `blocked` and
`ended_without_handoff`: all built in S5.3b, below.

## Built in S5.3b (2026-11-11)

Steps run: a step whose assignee is an agent runs a real turn of that agent, in a conversation of the task at that step,
and what it leaves is kept with the task. Server and runner first, then the web's views of the conversations and the
artifacts ("Web" below).

### A step's work is a chat

**The data choice: three nullable columns on `chats`, not a `task_conversations` table** (migration `0023_task_runs`):
`task_id` (a composite key to `tasks`), `task_step_id` (a plain id: a step removed later leaves its conversations
readable, as `task_events` keeps its plain ids) and `task_round` (the round of the step the conversation began in; a
CHECK keeps the three together, the round from 1). Why: a step's conversation is one chat, one to one, so a side table
would only split the chat's row in two. Being a chat, it gets everything chats have with no new code: streaming, its
events, Stop, the queue, the briefing ("Standing instructions"), resume, the machine and profile checks, the terminal
and "Open in Claude Code". The agent's chat list (`GET …/agents/{agentId}/chats`) leaves task conversations out
(`task_id is null`); they open by id (`GET …/chats/{chatId}`, whose `task` names the task, the step and the round) and
are listed on the task (`conversations` in `GET …/tasks/{taskId}`).

**One conversation per task and step** (`taskTurns` of the chats module, `service/tasks.ts`): the step's latest
conversation of that agent goes on when it can (not archived, the agent's harness and machine unchanged) and the step
is **Keep** or the round is the same (a Start again after a block); otherwise a new chat begins, titled
`T-12 · Develop · Fix the login`, with the person who moved the task as its creator (audited as any chat's start). So
**Keep** continues the same Claude Code session across rounds (`--resume`), **Fresh** opens a new chat each round and the
old ones stay readable, and different steps never share a conversation (the lookup is by task and step).

### Entering a step whose assignee is an agent

- **`starts: auto`**: the move that enters it (a hand-on, pass, approval, send-back, route, retry, or a task made into the
  step) leaves the task `working` with a `started` row by nobody, and once its transaction is written the step's turn
  starts (`runStep`, `service/runs.ts`), as the person who made the move (their principal on the turn and on the
  credential's use).
- **`starts: manual`**: the task waits (`waiting`) until Start, which starts the turn the same way.
- **Refused**: a start the chats refuse leaves the task **`blocked`** with the refusal's words in `blocked_reason` (a new
  `tasks` column, kept only while blocked) and a `blocked` history row by nobody: the step's assignee is no agent
  (`not_an_agent`), the agent is archived, has no placement or a container one, its machine has no runner, the runner is
  too old or lacks the CLI, the agent has no access profile or the profile no subscription, and so on (the chats' own
  checks, docs/harness.md "How a turn runs"). Start again tries once more (`blocked` is startable).
- A person's step runs nothing, as before.

### The step's prompt

`stepPrompt` of `@mwc/shared/flows` (`flows/prompt.ts`, pure and tested), always within a chat prompt's 20 000
characters (the task's description gives way first, a quoted reply is cut at 4 000, the artifacts list keeps the latest
25). A **full** prompt (a new conversation) holds:

- the task: its key, title and description;
- the flow in its written form (`flowText`), and "You are at <step>";
- the step's ask: Work does the job and ends with a hand-off for the next step; Check checks and answers `PASS` or
  `SEND BACK` on its first line with findings (and where a send-back goes); Sign-off answers `APPROVE` or `SEND BACK`;
  and that nobody moves the task for it yet;
- the hand-off: how the task came (new, handed on, passed, approved, sent back "for round N" with the reason and findings,
  routed, retried), the last reply of the step it came from (that step's latest hand-off note), and the task's artifacts;
- where outputs go: `tasks/<key>/artifacts/<position>-<step>/round-<n>/` under the agent's home folder.

A conversation that goes on (Keep) gets only the **delta**: "Task T-12 is back at your step "Develop" (Work): round 2.",
the hand-off since its last round (how it came, the reason, the reply, the artifacts of other steps since its previous
entry) and the outputs folder; a Start again in round 1 gets "Continue … where you left off." Examples are in the
roadmap's S5.3b entry.

### Turn end, before S6's tools

(S6a: a turn that recorded a decision with the step's tools has it applied here instead; "Built in S6a" below.)

Every message turn of a task's conversation (the step's own, and a person's reply in it) reports to the tasks module
(`taskTurnHook`, `service/hook.ts`, the chats module's `TaskTurnHook` port, wired in `app.ts`):

| What | The task, while it is still worked on at that step | History | Who is told |
| --- | --- | --- | --- |
| The turn starts (a person's reply, or the step's own) | `waiting`, `blocked` or `ended_without_handoff` → `working` | `started` by the replier | — |
| The turn ends (done, or stopped) | `ended_without_handoff` | `turn_ended` by nobody (a stop says why) | `task_turn_ended` |
| The turn fails | `blocked`, its error as the reason | `blocked` by nobody | `task_blocked` |

The notices go to the nearest person at or above the Lead and the step's assignee when a person (an agent's step has
none; agents get no notices). People then hand on, pass or send back by hand (the S5.3a moves), or reply in the
conversation, which continues it. A turn that ends after the task moved on, or while another turn of the step's
conversations runs, changes nothing on the task.

**Across restarts** (S5.4, docs/harness.md "Surviving restarts"): a step's turn survives its runner's dropped link, the
runner's restart and the server's restart. While its runner is away the turn stays `running` (detached, "Reconnecting…"
in its thread) and the task stays `working`: nothing is blocked while the turn may still come back. When the runner comes
back with it, the turn goes on and ends as usual. Only a turn that finally fails blocks the task, once: the grace after a
dropped link runs out (`machine_disconnected`), a turn a stopped server left running that no runner took back within the
grace after the start (`server_restarted`), or a process that died while no runner watched it (`process_lost`). A
person's reply that waited in the conversation of a step whose turn ended as a server stopped fails at the next start
(`server_restarted`) and blocks the task the same way.

**Moving a task while its turn runs** is refused (409 `step_running`, after the caller's own checks) unless the move
says `force: true` (`mwc task move … --force`), which stops the turn (`turn.stop`) once the move is written; its end then
leaves the task alone. Chosen over stopping silently so nobody kills an agent's work by a stray drag.

### The task folder and artifacts

Each turn of a task's step names its outputs folder in its spec (`TurnSpec.artifacts.dir`,
`tasks/T-12/artifacts/2-code-review/round-1`): the runner makes it (and so the task's folder `tasks/T-12/`) under the
agent's home before the process starts, and the agent still starts in its home, so its CLAUDE.md, skills and memory load.
When the turn ends the runner collects the files new or changed there and sends them before `turn.end`
(docs/runner-protocol.md "Artifacts"): at most 20 files, 2 MB each and 10 MB together, text (UTF-8) or PNG, JPEG, GIF,
WebP images; anything else is listed as skipped with why. Hidden names and links inside the folder are passed over, and a
folder that leads outside the home is not collected. The server puts each file together, checks its size and SHA-256,
tells its type again from the bytes, and keeps it.

`task_artifacts` (migration `0023_task_runs`): `task_id`, `step_id` (plain) with `step_name` as it was, `round`, `name`
(the path in the round's folder), `kind` (`file`, `note`, `link` for S6, `skipped`), `content_type`, `size`, `sha256`,
`bytes` (at most 2 MB; files and notes only), `note` (a skipped file's reason, a link's address), `chat_id`, `turn_id`
and `created_by` (the step's agent). One name per task, step and round: a file collected again in the same round
replaces the one before. The turn's final reply is kept as the round's **hand-off note** (`hand-off note`, Markdown;
the latest reply of the round wins), which the next step's prompt quotes.

| Route | Who | |
| --- | --- | --- |
| `GET tasks/{taskId}/artifacts` | viewer+ | oldest first, without bytes; 404 `task_not_found` (another company's too) |
| `GET tasks/{taskId}/artifacts/{artifactId}/content` | viewer+ | the bytes, as an attachment with their type, `nosniff`, a CSP that runs nothing and the hash as ETag; 404 `artifact_not_found` for none or one without bytes |

The task's detail adds `blockedReason`, `conversations` and `artifacts` (a count, skipped files left out); the board's
cards add `artifacts`. The CLI: `mwc task show <key>` lists the conversations (chat ids) and the artifacts;
`mwc task artifact <key> <name> [--step <step>] [--round <n>] [--out <path>]` prints a text artifact or saves one.

### The Lead today

Notifications to people only. An agent Lead sees nothing automatically yet: no board, no notice, no conversation of its
own about the team's tasks; S6a gives agent Leads their board tools in their own chats ("Built in S6a").

### Web

The task page (`/:slug/tasks/T-12`) and the board show the runs. The views still take their data as props (`TaskRuns`,
`features/flows/task/runs.ts`: the artifacts, their bytes, the open conversation's thread), so the gallery draws them on
samples.

| Where | What it shows |
| --- | --- |
| Task page, top | The title, the state pills, the notices (escalation, **Blocked at <step>**, the recorded decision; a long reason clipped to two lines with "more"), the moves, and the flow drawn with the current step ringed and "N rounds · M sent back" under each step. Beside them on a wide screen, above the tabs on a phone: the **facts** (flow, step, round, with, priority, created by, created, updated), sticky while the page scrolls |
| Task page, moves | The moves, and under them on `ended_without_handoff` one line: "Turn ended. Read the reply, then hand on (pass or send back; approve or send back), or reply in the conversation." A move (or Cancel) refused with `step_running` offers "Stop the turn and move" behind an in-place confirm, resent with `force: true`; "Leave it" drops it |
| Task page, **Story** (the first tab) | The history cut into **rounds**: a round is one pass down the flow, and a new one begins whenever the task enters a step at or before the one it was last at (a send-back, a retry, a route back). Newest round first by default (the page is opened for where the task stands now; the older rounds say why), with a Newest/Oldest toggle; up to three rounds all open, else the latest two, the older ones folded to one line (each step's name with its outcome's dot). Each step it went through is one row: its kind's dot, the assignee's face, the step, the **outcome chip** (Handed on, Passed, Approved, Sent back → step, Escalated, Routed, Cancelled, Blocked, Turn ended, Waiting, Working, Needs you), who made it when not the assignee, who started its turn, "conversation" (opens the Conversations tab on the step's conversation) and when. Under it once: the reason (a send-back's, an escalation's, a cancel's; clipped to two lines), else the **hand-off note**'s first lines, both opening in place (the note rendered as Markdown; "note" opens it beside a reason); people's actions and errors as small lines (a person's route with a reason, a restart, an edit, a failed turn's error clipped to one line with "more"); the step's files as chips (images with a tiny thumbnail, text with its icon, both opening the viewer; links to their address; skipped files struck through, why on hover). Folded into the rows: entered, started by itself, a route out of the queue without a reason. A reason the notices above already say (the current block, the escalation) is not repeated. Under the rounds, **All files** (folded): every file and link by step and round with Download, the notes left out. Bytes come through the bearer client (`api/task-artifacts.ts`) into one object URL per artifact version, shared by chip and viewer |
| Task page, **Conversations** | One chip per conversation in the flow's order: the agent's face, the step, its rounds (a Keep conversation spans "Rounds 1–2" up to the step's next conversation or its entries so far; Fresh has one per round), its state (Running with a pulsing dot, Queued, Ended, Stopped, Failed, Not started) and its last activity. The one chosen (a chip, or a story row's "conversation"), else the current step's latest, else the latest of all. Its thread is inline under the chips in a frame at most 40rem high: the chat views' thread (stream, tool calls, subagents, to-dos, copy, answers to questions), the composer (admins and owners; a reply continues the conversation and the server sets the task back to `working`), Stop and the waiting messages, "Open as chat" (the agent's chat page with `?chat=<id>`) and "Open in Claude Code". A turn's end reads the task again (its state, its artifacts). The tab shows only once there is a conversation |
| Task page, **Description** | The description as Markdown, with Edit for those who may edit the task |
| Task page, **Log** | Every history row, oldest first, one line each: its dot, the actor's face, who did what from and to which step, its reason once beside it (clipped to one line with "more"), when. "Quiet rows" (off by default) adds entered, started by itself and routes out of the queue without a reason |
| Board card | A files icon with the artifacts count beside the time; Working with a pulsing dot while a turn runs; a blocked pill's tooltip is `blockedReason` |

The page reads the task again every 30 seconds while visible, like the board.

**Server changes for the web** (small, tested in `test/modules/tasks/service/runs.test.ts`): each conversation in the
task's detail has `lastTurn: {status, at} | null` (the running turn's status while one runs, else the latest's; the latest
start or end; Clears left out), and the board's cards carry `blockedReason`.

**Not built:** a "Task conversations" list on the agent's page: the agent's chat list leaves task conversations out
and no route lists one agent's task chats, so it waits for an API that gives it cheaply.

The parts: `features/flows/conversations/` (`model.ts` pure: states, round spans, order, the first open; `TaskConversations`,
`ConversationList`, `ThreadFrame`, `TaskThread` (live), `LiveDot`), `features/flows/artifacts/` (`groups.ts` pure: groups,
views, sizes; `ArtifactRow`, `ArtifactViewer`), `features/flows/story/` (`story.ts` pure: the rounds from the history,
artifacts and conversations; `outcomes.ts` the words; `TaskStory`, `StoryRound`, `StoryStepRow`, `FileChips`, `AllFiles`,
`Clip`), `features/flows/task/` (`TaskView`, `TaskTabs`, `TaskHistory` the Log, `ForceMove`), `api/task-artifacts.ts`.
The gallery (`/design/flows`): `?task=T-12` (three rounds: a failed first turn with a 401 error, send-backs from Code
review and QA, an edit, then Ihor's Approve; four conversations, notes in every step, screenshots, a Markdown file,
diffs, two skipped files), `T-14` (escalated in its fourth round, the older rounds folded), `T-18` (a running turn on
its second round; its moves are refused with `step_running` to show the forced move), `T-17` (ended without a
hand-off), `T-15` (blocked at QA); samples in `pages/design/flows/task-history-sample.ts`, `conversation-sample.ts`,
`artifact-sample.ts` and `SampleThread.tsx`.

## Built in S6a (2026-11-11)

Agents move tasks themselves: a step's agent records its step's move with a tool during its turn, applied when the turn
ends; a flow's Lead agent distributes the work with board tools in its own chats. The tools ride the runner's MCP bridge
(docs/harness.md "Agents' tools"): the runner only relays each call (`turn.tool`, answered by `turn.tool.result`,
docs/runner-protocol.md "Chat turns"), and the server checks everything again.

### The tools

`AgentTool`, `AGENT_TOOL_INPUTS` and `AGENT_TOOL_INFO` of `@mwc/shared/flows` (`flows/tools.ts`, the words in
`flows/tool-words.ts`) name them, check their inputs and describe them; the runner's `tools/list` is generated from them.
The runner and the server check a call's input with the same `checkToolInput` (`flows/tool-input.ts`).

| Who, where | Tool | Input | What it does |
| --- | --- | --- | --- |
| A step's turn, every kind | `task_read` | — | the task (key, title, description), its flow's written form, the step, the round, the hand-off and the artifacts (the step's full prompt), then where the task is now and the move recorded so far |
| Work | `task_hand_on` | `{summary}` | records "hand on" |
| Check | `task_pass` | `{findings?}` | records "pass" |
| Check, Sign-off | `task_send_back` | `{reason, findings}` | records "send back" (past the step's limit: escalated to the Lead) |
| Sign-off | `task_approve` | `{note?}` | records "approve" |
| A step's turn, every kind | `task_attach` | `{name, text}`, `{path}` or `{name, url}` | keeps a note, a file of the turn's outputs folder (named by its path) or a link with the task now, in the step's round, as the step's agent |
| A step's turn, every kind | `task_blocked` | `{reason}` | records "blocked" |
| A Lead's own chats | `team_board` | — | the board in words: Queued, each step (kind, assignee), Done (the latest 10 of all), Escalated, each card's state, round and priority |
| | `task_show` | `{key}` | one task of its flow: where it is, who has it, a block or escalation, the recorded decision, its description (4 000 characters), its latest 15 history rows |
| | `task_create` | `{title, description?, priority?, step?}` | a task of its flow, queued or into a step (by name, any case), which runs at once when the step starts by itself |
| | `task_route`, `task_start`, `task_retry`, `task_cancel` | `{key, step}`, `{key}`, `{key}`, `{key, reason}` | the S5.3a moves, at once |

A turn gets the tools only when its runner offers them (`caps.agentTools`): a task step's turn its kind's
(`stepTools(kind)`), a chat of the agent that leads a flow (`flows.lead_principal_id`) the Lead's, any other turn none.
The spec names them (`TurnSpec.tools`); a Compact or a Clear gets none.

### A step's decision

- **Recorded during the turn, applied when it ends.** A move tool (`task_hand_on`, `task_pass`, `task_approve`,
  `task_send_back`, `task_blocked`) writes the turn's decision on the task (`tasks.decision`, migration
  `0024_task_decisions`: jsonb, only while `active`, CHECK `tasks_decision_check`; `TaskDecision` of `@mwc/shared/flows`:
  the turn, conversation, step, round, action, reason, note, agent, when, and what it makes as found then) and answers
  what will happen: "Recorded: when your turn ends the task goes to "Code review". End your turn now." (or "goes back to
  "Develop" for round 2", "is done", "is marked blocked: …"). Audited as the agent (`decide`).
- **One decision per turn.** A second call replaces the first; the answer starts "This replaces your earlier decision
  (pass).". A decision of another turn on the task is stale and replaced silently.
- **The limit.** A send-back past the step's limit is still recorded; the answer says it will be escalated: ""Code review"
  has sent this task back 3 times already, its limit, so when your turn ends it is escalated to the team's Lead (DEVBOX
  Coordinator) instead of going back to "Develop".", as the S5.3a rules do.
- **At the turn's end** (the hook's `ended`): a turn that ended **done** with a decision has it applied as the step's
  agent, under the flow's and the task's locks, in place of `ended_without_handoff`: the move (`handed_on`, `passed`,
  `signed_off`, `sent_back` or `escalated` with the agent as actor; a next step that starts by itself runs next, its turn
  started as the agent), or `blocked` with the reason (a `blocked` row by the agent; the Lead's nearest person told). The
  decision's words become the round's hand-off note in place of the last reply: the summary, the findings or the note, a
  send-back's as "**Sent back:** <reason>" and its findings; a pass or approval without words, and a block, keep the
  reply. A move the task no longer allows by then (its flow changed) leaves it `ended_without_handoff`, saying why.
- **Dropped:** a turn that **failed** blocks the task as before, a turn that was **stopped** leaves it
  `ended_without_handoff` as before, and both drop the decision (a Stop is a person taking over); so does another turn of
  the step's conversations still running, and any move or step change of the task (`applyMove`, `applyStepChange` clear it).

**Server re-checks** for every step tool (`stepToolRefusal`, `rules/decision.ts`): the turn is a message turn of the
task's conversation at the step (the sink's task context, never the runner's word), the step still exists and its
assignee is the turn's agent (403 `not_your_step` in words), the task is still active at that step (`task_moved`: "The
task is no longer at your step: nothing was recorded."), and the tool is one of the step's kind (`wrong_kind`: "task_pass
is not a move of "Develop", a work step: use task_hand_on."); then the move must be one the task allows now (the machine's
own refusals, e.g. `no_send_back_target`). `task_read` works while the task has moved on (it says where it is).

### The Lead's tools

They apply at once, as the S5.3a actions (`actOnTask`, `createTask`), acting as the Lead agent: the history and audit rows
name it (`actor_kind` `agent`), and a step that starts by itself runs with its turn started as the Lead. Only its own flow:
a task of another flow answers "No task T-9 in your flow "DEVBOX delivery"." and nothing of it moves. A move while the
task's turn runs is refused (`step_running`, in words), never forced. Its chats' standing instructions get a short section
after its own (`leadSection`):

```
## Leading your team (from Most Wanted)

You lead the flow "DEVBOX delivery". Your tools act at once, as you: team_board, task_show {key}, task_create {title,
description?, priority?, step?}, task_route {key, step}, task_start {key}, task_retry {key} and task_cancel {key,
reason}. Each step's agent moves its own task when its turn ends; you distribute the work, unblock it, and decide on
escalations.
```

(`STANDING_INSTRUCTIONS_MAX` grew by `STANDING_SECTION_MAX`, 2 000; a section that would not fit is left out.)

### Who may (`rules/access.ts`)

The caller may be an agent (`Caller.agent`: `lead` or `decision`; its role is `member` only so no role check gives it
more). A Lead agent (`agent: 'lead'` and the flow's `lead_principal_id`) creates tasks in its own flow, puts them into a
step (`intoStepRefusal`) and routes, starts, retries and cancels there; a step's agent (`agent: 'decision'`) makes its
step's moves (`hand_on`, `pass`, `approve`, `send_back`) on its own step only, through its turn's decision. Agents never
lead (`leads` is false), change a flow or edit a task. People keep all their rights.

### The step's prompt

`stepPrompt` takes `tools` (the runner offers them): the step's ask names the move ("Then call task_hand_on with your
hand-off for "Code review" … and end your turn."; Check: "call task_pass (with your findings, if any) or task_send_back
{reason, findings: …}"; Sign-off: "Call task_approve (with a note, if any) or task_send_back {reason, findings}"), and
"Nobody moves the task for you yet: …" gives way to:

> Your move is recorded when you call it and applied when your turn ends; calling another one replaces it. task_read
> shows the task, task_attach {name, text | path | url} keeps a note, a file of your outputs folder or a link with the task
> now, and task_blocked {reason} says you cannot go on. Without a move, a person reads your reply and moves the task.

The tasks module writes both variants and the chats module picks by the agent's runner (`TaskTurnRequest.prompt.plain` and
`.tools`), so an older runner keeps the S5.3b text.

### Web

- The task page shows the recorded decision while the turn runs, as a notice with the agent's face: "Developer will hand
  on to Code review" (or "… will send it back over the limit: it goes to the Lead", "… will mark it blocked"), "When its
  turn ends.", and a send-back's or a block's reason (`decision` in the task's detail: action, outcome, the step it goes
  to, reason, by, at; `features/flows/task/TaskDecision.tsx`).
- The story and the log show each actor's face, an agent's icon when an agent moved the task (`TaskHistory`'s `nodes`).
- A block an agent reported says so: "Blocked at Develop · reported by Developer", with its reason.

### What is not built

The Lead heard nothing by itself (S6c built that: "Built: the Lead wakes up"); it read the board when it was asked in its
chat. A person's reply in a task conversation gets the step's tools too, and a decision it records counts
the same way. Approving a tool mid-turn (the permission round trip) is the rest of S6; the Inbox is S6b, below.

## Built in S6b (2026-11-11)

The Inbox: what needs a person now, in the right panel of every company page ("Attention", across all their companies),
with the notifications moved there from the top bar's bell (docs/notifications.md, "Web"). Ihor's ask: "Approvals for me
should be added to the Attention required" and "Notifications icon should disappear (near my face), and its function
moved to the one at the right vertical rail".

### What needs a person (`apps/server/src/modules/inbox/`)

**Computed live, no table.** Every read works the items out from the tasks and the chats as they stand (the module's
repo reads their rows, read only; the rules are `rules.ts`, pure). Nothing is resolved, expired or kept: an item is there
while its cause is, and it goes once the task moves or the question is answered. Every item leads to the routes that
already act on it (the task's actions, the chat's answers); the inbox adds no write path.

| Kind | Who sees it | Rule (`taskKind`, `answersQuestions`) |
| --- | --- | --- |
| `signoff` (Sign-off) | the step's person | an active task at a Sign-off step whose assignee is the viewer (`needs_person`) |
| `step` (Your step) | the step's person | an active task at another step of the viewer's (Work or Check), whatever its step state: a person's step runs nothing, so it waits for them |
| `escalated` (Escalated) | the Lead's people | an escalated task in a flow whose Lead the viewer is, or is above on the chart (`peopleAtOrAbove`, the S5.3a rule; an admin beside the chain is not one) |
| `blocked` (Blocked) | the Lead's people, and the step's person | an active task whose step state is `blocked` |
| `turn_ended` (Turn ended) | the Lead's people, and the step's person | an active task whose step state is `ended_without_handoff` |
| `question` (Question) | admins and owners, as `POST …/chats/{chatId}/answers` allows | a chat (not archived, its agent not archived) whose last turn has an open question: its latest question, not answered (the chats' own `openQuestion`); a task's conversation asks like any chat |

Viewers (the role) make no moves, so nothing needs them: their inbox is empty. Each item carries its `kind`, its
`company` (id, slug, name), a `title` (the task's, or the agent's first question), a `subtitle` (`DEVBOX delivery ·
Approve`, or the agent and its chat's title), the `reason` it waits (a block's, an escalation's, else the send-back's
that brought it), `from` (who handed it on, sent it back, escalated it or asked; a block or a turn's end by itself names
the step's agent), its `link` inside the company (`tasks/T-12`, or `chats/<agentId>?chat=<chatId>` with the question
card), the `actions` the caller may take now (the task's moves exactly as the task page's `actions`, or `answer`), the
`task` (key, title, priority, flow and Lead, step, round) or the `question` (chat, agent, id, how many it asks, the task
whose conversation it is), and `at`, since when it waits (the history row that moved or stopped the task, or the
question's event).

**The order, the most urgent first:** the task's priority (urgent, high, normal, low; a question counts as normal), then
the kind (Sign-off, question, your step, escalated, blocked, turn ended), then the longest waiting.

### The API

| Route | Who | |
| --- | --- | --- |
| `GET /api/companies/{companyId}/inbox` | viewer+ (a viewer's is empty) | `{items, count}`; another company's is the same 404 as none |
| `GET /api/companies/{companyId}/inbox/count` | viewer+ | `{count}`, for a badge |
| `GET /api/me/inbox` | any signed-in person (a session or a personal API key) | `{items, count, companies}`: every company where their membership is active, each item naming its company, and each company's count by name. An API key acts in its own company only, so its inbox is that company's |
| `GET /api/me/inbox/count` | the same | `{count, companies}` |

The panel reads `GET /api/me/inbox`, since it says "Across all companies"; the CLI reads the company's unless `--all`.

### Web: the right panel

- **Two tabs** at the top of the right rail's card, Attention and Notifications, each with its count (red: what needs
  you; blue: unread), and the collapse button. Under them a line with the view's scope ("Across all companies", "In
  Acme") and, for Notifications, Mark all read.
- **Attention** lists the items as compact cards: the kind's chip (Sign-off violet, Question amber, Your step blue,
  Escalated red, Blocked, Turn ended grey), the task's key, its priority unless normal, the company when it is another
  one, how long it has waited; the title (a link to the task or the chat); the flow and step with who moved it and Open;
  the reason, two lines at most. A Sign-off the person may decide has **Approve** and **Send back…** (a required reason
  in place) instead of Open, calling `POST …/tasks/{key}/actions` in the task's own company with the step it was seen at
  (`fromStepId`); a refusal shows its words on the card. Read again every 30 seconds while the page is visible, when the
  tab comes back, and right after a move. Empty: "Nothing needs you."
- **Quick create** sits at the foot of Attention (members and up): chips of the company's flows' Leads (an agent's icon
  or a person's initials and the Lead's name), a title, send. It makes the task with the existing `POST …/tasks`:
  queued, or straight into the flow's first step for those who lead the team (the flows' pages' own `leadsTeam`; the
  server stays the judge); the made task's key links to it. No flows yet: one line with a link to the flows. It replaced
  the old dock that picked an agent and said "Tasks arrive in S4".
- **The collapsed strip**: expand, the inbox icon with the attention count (red, pulsing while something waits), the
  bell with the unread count (blue), each opening its tab, and "+" at the foot opening Attention with the quick create's
  title focused. The rail still opens by itself while something needs you until you toggle it (`mwc.rightRail`).
- **The top bar** has no bell: from 80rem nothing sits beside the person. Below 80rem one inbox button (both counts, red
  while something needs you) opens the same two tabs in a drawer, which closes when a card or a notice opens its page.
- The left rail's muted "Inbox, coming in S6" item is gone.

The parts: `apps/web/src/api/inbox.ts` (`useInbox`), `features/inbox/` (`InboxView`, `InboxCard`, `kinds.ts`,
`QuickTask`, `LeadChips`, `LiveQuickTask`, `use-company-rail.tsx`: the rail's props for a company page),
`features/notifications/` (`NotificationsView`, `MarkAllRead`, `EmailSetting` with `EmailSwitch`), `components/layout/`
(`RailViews`, `RightRail`, `RailStrip`, `TopBar`, `AppShell`), and `CountDot`'s blue `info` tone (`IconButton`'s
`badgeTone`). `ago` ("5 min ago") moved from the notifications list to `components/data/format.ts`; the old
`AttentionFeed`, `QuickCreate`, `NotificationsBell` and the empty `api/attention.ts` are gone. The gallery (`/design/dashboard` and every mock page; `?inbox=empty` for the empty views) draws
the panel on samples (`pages/design/inbox-sample.ts`, `sample-rail.tsx`); its Lists section shows every card kind and the
dock.

### The CLI

- `mwc inbox list [--all]`: a table of kind, key, title, where, from, since and what you may do (with the company with
  `--all`); "Nothing needs you in Acme." when empty.
- `mwc inbox count [--all]`: the number alone, for a status line.
- `mwc inbox approve <key>` and `mwc inbox send-back <key> --reason <text>`: thin wrappers over `POST …/tasks/{key}/actions`
  (the server's refusals as they come).

Each takes `--company`, `--json` and `--server` like `mwc task`. With a personal API key `--all` is the key's own company.

### Tests

`apps/server/test/modules/inbox/`: the rules (`rules.test.ts`), each kind through the real task moves on PGlite (a
Sign-off until approved, a person's QA step and a send-back away from it, an escalation over the limit, a block from a
Start without a placement, a turn ended), the order and the count, a viewer at their own step, tenancy (another company's
404, an outsider's empty inbox) (`routes/company.test.ts`); open questions for admins and owners only, answered,
superseded, an archived chat and agent, a turn's latest question, a task's conversation, a question between a Sign-off
and a block (`routes/questions.test.ts`); one person in two companies, a suspended membership, an API key, no credential
(`routes/mine.test.ts`); the names are the org module's `principalNames` (`apps/server/test/modules/org/service/names.test.ts`). `packages/cli/test/inbox/`: the commands against the real
API in-process, and the table.

### Not built

The live wait of S6's plan (an `attention_items` table, a question answered within 90 s reaching the waiting process,
`mwc inbox watch`, the MCP's `inbox_list` / `inbox_answer`): questions are answered on the chat's card as in S5.2. S6c
added the notice for a new question and the answer inline on the card ("Inbox answers").

## Built: the Lead wakes up (S6c, 2026-11-12)

When a flow's Lead is an agent, its team's events wake it by themselves: a short message in **its team chat**, queued as a
turn by Most Wanted (not by a person), that says what happened and the decision expected with the tools that make it.
Ihor's ask: the Lead acts without being talked to. A person Lead is never woken (people hear through notifications), and
the step agents' and people's paths are unchanged.

### The events (`lead_wake_events`, migration `0025_lead_wakes`)

Each event is a row written **in the transaction that made it**, only when the flow's Lead is an agent on the chart and
the flow's settings wake it for that kind (`service/wake/record.ts`):

| Kind | Made by | Step and reason kept |
| --- | --- | --- |
| `escalated` | a move over a step's send-back limit (a person's send-back, or a step agent's decision) (`applyMove`) | the step it escalated from; the escalation's reason |
| `blocked` | a step's run that could not start or failed, or a step agent's `task_blocked` (`applyStepChange`) | the step; the block's reason |
| `turn_ended` | a step's turn that ended and nobody moved the task, or a decision the task no longer allowed (`applyStepChange`) | the step; why, when said |
| `done` (off by default) | the last step's approval or pass (`applyMove`) | — |
| `signoff_waiting` (off by default) | the tick: an active task at a person's Sign-off (`needs_person`) unchanged for the flow's hours, once per wait | the step |

A turn a **person stopped** wakes nobody (`StepChange.quiet`): a Stop is a person taking over. The row keeps the step's
name as it was and the reason clipped to 300 characters (`LEAD_WAKE_REASON_MAX`), one line.

| Column | What it holds |
| --- | --- |
| `flow_id`, `task_id` | composite keys to `flows` and `tasks` |
| `kind` | `LeadWakeKind` (`escalated`, `blocked`, `turn_ended`, `done`, `signoff_waiting`) |
| `step_name`, `reason` | as above (1–60; at most 300) |
| `outcome` | `LeadWakeOutcome`: `pending` until the tick tells it, then `woke` (told in a turn), `capped` (over a cap), `unreachable` (the Lead could not run), `dropped` (the task moved on first, or the Lead is no agent now) |
| `seen_at` | when the tick first saw it, by the server's clock: the window starts at a flow's oldest |
| `delivered_at`, `chat_id`, `turn_id`, `detail` | when it was told, held or let go; the team chat and the turn (`woke`; `turn_id` a plain id, since a person may discard the waiting turn); why it was not told (the refusal's words, the cap, "The task moved on first") |

CHECKs hold `pending` ⇔ no `delivered_at`, `woke` ⇔ a turn (and a turn ⇔ a chat). Indexed for the tick's pending scan
(partial, `outcome = 'pending'`), a flow's caps (`company_id, flow_id, delivered_at`) and a task's latest (`company_id,
task_id, id`).

### The settings, on the flow

Eight columns on `flows` (migration `0025_lead_wakes`), defaults `LEAD_WAKE_DEFAULTS` of `@mwc/shared/flows`, bounds
`LEAD_WAKE` (CHECKs):

| Setting | Column | Default | Bounds |
| --- | --- | --- | --- |
| Escalated, Blocked, Turn ended | `wake_escalated`, `wake_blocked`, `wake_turn_ended` | on | |
| Done (a digest) | `wake_done` | off | |
| A sign-off waits over N hours | `wake_signoff_hours` | null (off) | 1–168 |
| The quiet window | `wake_window_seconds` | 60 | 0–600 |
| Wake-ups per hour, per day | `wake_max_per_hour`, `wake_max_per_day` | 6, 40 | 1–60, 1–500 |

| Route | Who | |
| --- | --- | --- |
| `GET /api/companies/{companyId}/flows/{flowId}/lead-wakes` | viewer+ | the settings, `leadIsAgent`, `chat` (the team chat it was last woken in, with its agent), `last` (the last wake-up told or held: outcome, when, why) and `counts` (wake-ups in the last hour and day, events waiting) |
| `PUT` the same, all eight settings | the Lead's people, admins and owners | 403 `not_lead`, 404 `flow_not_found` (another company's too), 400 out of bounds; audited field by field on the flow (`update`); unchanged settings write nothing |

### The tick (`service/wake/tick.ts`)

Every 5 seconds (`WAKE_TICK_MS`), in the server process that holds the runners' sockets and the chats' live turns (so it
is the app's, made by `createApp`, not the jobs loop's): it writes the sign-off waits, stamps the new pending events with
its clock (`seen_at`), then delivers each flow whose **quiet window** has passed since its oldest seen event, 20 flows a
tick at most (`deliverFlow`, `service/wake/deliver.ts`). It runs when the server runs its background work (MWC_JOBS, on
by default outside tests), one tick at a time, logs a failed tick and tries again; it stops with the server. Its
cross-company reads are `repo/wakes-due.ts`, in Biome's raw-access exemption; each flow is read, told and marked through
its company's tenant. Tests pass timers they fire by hand (`AppDeps.leadWakeTimers`).

**Delivering a flow**, outside any transaction:
1. The Lead is no agent on the chart now: every pending event is `dropped`.
2. An event whose task is no longer what it said (a person handled it within the window: no longer escalated, blocked,
   ended, waiting for the sign-off) is `dropped` ("The task moved on first").
3. **The caps**: the Lead's wake-ups (turns) in the last hour and day; at the flow's cap the events are `capped` ("Over the
   flow's wake-ups for this hour" / "for today").
4. Otherwise the message (below) goes to the team chat through the chats module (`TeamChats.wake`); a refusal holds the
   events `unreachable` with its words; else they are `woke` with the chat and the turn.
5. **The Lead's nearest person** (at or above it on the chart) is told when the events are held (`lead_not_woken`,
   docs/notifications.md), **once**: only the first time for that outcome since the Lead was last told (the flow's
   previous told-or-held outcome differs). So a broken loop that hits the cap, or a Lead without a machine, tells them
   once until a wake-up gets through again.

A process killed between the turn's start and the events' mark tells them again at the next tick (a second wake-up).

### The team chat (the chats module, `service/team.ts`)

**One chat per flow for the Lead**: a chat whose `flow_id` names the flow (migration `0025_lead_wakes`; a CHECK keeps it
off task conversations). The latest team chat of the flow with that agent goes on while it can (not archived, the
agent's harness and machine unchanged); otherwise a new one is made, titled `<flow>: team` (cut to a chat title's 80),
created by the agent and audited as the system. It is one of the Lead's own chats: it shows in its chat list (with a bell),
gets the Lead's board tools and its "Leading your team" section as any of its chats does. Ihor's ad-hoc chats with the
Lead are never woken.

**Delivery**: the message is sent as a turn **Most Wanted queued** (`chat_turns.system`, its `created_by` the agent),
"after this turn" (the existing queue, docs/harness.md "Delivery while a turn runs"): it starts at once while nothing runs
there, else it waits behind the running turn; while a wake-up of its own still waits, a new message joins it (the prompts
one after the other, within a prompt's 20 000 characters) instead of queueing another. Every check of a turn holds (the
placement, the runner, the profile, the CLI); a paused Lead is not woken (`agent_paused`, "The agent is paused: resume it
to wake it"); a refusal comes back in words. A wake that waits behind a running turn and is refused when the queue starts
it fails in the chat as any waiting message does (the event says `woke`).

### The message (`leadWakeMessage` of `@mwc/shared/flows`, pure and tested)

A headline, then per task that needs a decision two lines (what happened, the decision with its tools), the done tasks as
one digest line, at most 10 tasks (the rest counted, for `team_board`), a task's repeated event of one kind told once,
titles clipped to 80 and reasons to 300:

```
Most Wanted · DEVBOX delivery: 1 task needs your decision.

- T-12 “Fix the login” was escalated to you from Code review: Code review sent it back 3 times already, its limit; this time: the Safari tests still fail
  Decide: task_retry / task_route / task_cancel, or ask Ihor Herasko (ask_user_question).

Act with your tools now; team_board shows the whole board. Keep your reply to a line or two.
```

```
Most Wanted · DEVBOX delivery: 1 task needs your decision.

- T-14 “Add SSO”: its turn ended at Develop without a hand-off
  Decide: task_show, then task_start / task_route / task_cancel, or ask Ihor Herasko (ask_user_question).

Act with your tools now; team_board shows the whole board. Keep your reply to a line or two.
```

A block reads `- T-15 “…” is blocked at QA: <reason>` / `Decide: fix the cause, then task_start; or task_route /
task_cancel, or ask …`; a sign-off's wait `- T-16 “Ship it” has waited 26 h for Ihor's sign-off at Approve` / `Decide:
remind them (ask_user_question), or leave it.`; done tasks `- Done: T-3 “Docs”, T-4 “Logo”.` The person named is the
Lead's nearest person ("a person" when there is none).

### Web

- **The Flow tab** (`/:slug/flows/<lead>/flow`, view and edit) gets **Lead wakes up on** for those who lead the team when
  the Lead is an agent: switches for Escalated, Blocked, Turn ended without a hand-off and Done (a digest), "A sign-off
  waits over N hours", "Events within N seconds go as one message", "At most N an hour and N a day", Save and Discard,
  and one line on the last wake-up ("Woke it 5 min ago · 2 this hour, 3 today", "Held …: Over the flow's wake-ups for
  this hour", "Could not wake it …: <why>") with a link to the team chat (`features/flows/wakes/`: `LeadWakes.tsx`,
  `LiveLeadWakes.tsx`, `words.ts`; `api/flows.ts` `useLeadWakes`, `putLeadWakes`).
- **The board**: an open card says **Lead notified** (a bell, its time on hover) when its agent Lead was told of it as it
  stands (`leadNotifiedAt`: the task's latest wake event was told and nothing happened to the task since it was written).
- **The chat**: a turn Most Wanted queued shows "Most Wanted" above a neutral bubble, and its waiting message says
  "Most Wanted · Queued…"; the chat list marks a team chat with a bell.

### Tests

`packages/shared/test/flows/wake.test.ts` (the message: each kind, the digest, clipping, one per task and kind, ten
listed); `packages/db/test/schema/lead-wakes.test.ts` (the settings' and the events' CHECKs, keys, the team chat's and
the system turn's columns); `apps/server/test/modules/tasks/rules/wake.test.ts` (the pure rules);
`service/wake/deliver.test.ts` (an escalation in a new team chat as Most Wanted's turn, never Ihor's ad-hoc chat, the
board's mark and the settings' view; a block and an ended turn in one message; done as a digest only when asked; a person
Lead never woken; an event let go when its task moved on); `service/wake/tick.test.ts` (the window from the first event
seen; queued behind the Lead's running turn and a later one joined into the waiting turn, then run; the hour's and the
day's caps telling the nearest person once; a Lead without a placement, told once; a sign-off waiting past the hours,
once; the loop's failed tick and stop); `routes/wakes.test.ts` (the defaults, who may change them, the audit, the bounds,
tenancy, a person Lead); `apps/server/test/modules/chats/service/team.test.ts` (the title, an archived team chat replaced,
a paused Lead). All on PGlite with the fake runner; no real CLI.

## Inbox answers (S6c, 2026-11-12)

An agent's question is answered on its **Inbox card** (Attention), and a notice tells the people who may answer it.

- **The item** carries the questions with their options (`question.questions` of `GET …/inbox` and `GET /api/me/inbox`,
  the `question` event's own `AskQuestions`).
- **The card** (`features/inbox/InboxQuestion.tsx`) reuses the chat card's form (`QuestionForm`, `compact`: without the
  headers' steps): one question a page with "1 of N" and the arrows for 2 or more, single or multiple choice, the "Other"
  box, Send. It posts to the chat's own `POST /api/companies/{companyId}/chats/{chatId}/answers` in the item's company
  (`chatCalls(…).answer`), remembers what it sent (the chat's receipt shows it), and reads the inbox again; the item goes
  once the answer's turn starts. A refusal shows its words under the form: `question_closed` (answered elsewhere, or the
  chat moved on), `turn_running`, a machine or profile refusal. Open still goes to the chat. The gallery draws it on the
  samples.
- **The notice**: when an agent's `question` event is stored (a frame sent again is told once), the company's active
  admins and owners, as the answers route allows, get `agent_question` ("SLOP BOX asks: “Which database should the
  service use?”", the first question clipped to 200), pointing at `chats/<agentId>?chat=<chatId>`; never the agent,
  nobody below admin, nobody of another company (docs/notifications.md).

Tests: `apps/server/test/modules/inbox/routes/answers.test.ts` (the item's questions, the card's answers taken and the
item gone, a second answer refused `question_closed`), `apps/server/test/modules/notifications/service/questions.test.ts`
(who gets it, never the agent, tenancy, once, the words and the path, a long question clipped).
