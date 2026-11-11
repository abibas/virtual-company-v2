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
