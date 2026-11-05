# Effort and model by task size

Ihor, 2026-11-05: "for simple coding tasks use medium/high reasoning instead of xhigh". Opus 5.5 at xhigh was used for
everything before that day, including 11-minute one-file fixes. Pick the row by the task, not by habit.

| Size   | What it looks like                                                                 | Who does it                         | Effort        |
| ------ | ---------------------------------------------------------------------------------- | ----------------------------------- | ------------- |
| Tiny   | A few lines, one or two files, the change already known (a label, a class, a CSS value, a prop passed through) | the main chat, directly             | n/a           |
| Small  | One area, a clear fix or a small feature, no schema change, no new contract (a UI tweak, one route option, a bug with a known cause) | Opus subagent                       | `medium`      |
| Medium | One step of the roadmap with its tests: a module's routes, a page, a migration with a simple shape | Opus subagent                       | `high`        |
| Large  | Cross-cutting or risky: security and secrets, data migrations with backfills, concurrency, protocols, identity, a new package or app, unknown external behaviour | Opus subagent                       | `xhigh`       |

- Pass `effort` explicitly on every subagent; the size decides it, and this table is Ihor's instruction for it.
- UI design work goes to Fable 5.1 only when Ihor asks for it again (paused since 2026-11-05).
- Raise the effort one step for a task that already failed once at a lower one; lower it one step when a size class
  keeps finishing well under its time.
- A task that is really two sizes (a large server part and a small web part) is two briefs.

## Rough budgets (wall clock) to compare against

Tiny: under 5 minutes. Small: 10 minutes. Medium: 20 minutes. Large: 40 minutes. A task well over its budget is a fact
for the next reflection: was it sized wrong, briefed wide, or blocked?
