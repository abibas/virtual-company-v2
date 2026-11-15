# TODO

The running list of what's next, kept current by the main chat. The plan and its history are in `docs/roadmap.md`;
this is the short version Ihor and the main chat work from. Items move to the roadmap's "Built" notes when done.

## Next in the plan (S7, one step at a time, a live test after each)

- [ ] **S7.2 Per-task worktrees and branches:** a git worktree and branch per task from a fresh origin default
      branch, kept across steps and rounds, cleaned up after Done.
- [ ] **S7.3 Pull requests:**
  - the coder opens the PR after the last check (a Pull request step on the flow);
  - a PR watch reads checks, comments and conflicts and hands findings back to the coder;
  - the merge moves the task to Done.
- [ ] **S7.4 Jira intake:** the flow's Jira sources (a parent's children, labels, single tickets) through an
      Atlassian profile. **Take** puts a ticket in Queued; optionally, a merged PR moves the ticket to Done.
- [ ] **S7.6 Confluence as a place for results:** a step publishes its artifacts or a summary to a page.
- [ ] **S7.7 Sprints tied to releases**, and AI gateway routing per machine. Sprints themselves are built (T-37); what is
      left is tying them to releases.
- [ ] **The real-ticket rehearsal**, end to end on one ticket. It waits for Ihor's answers: which repo, what Done
      means, parallel work.
- [ ] **The stage gate S7→S8 (T-17):** the structure review is done (5 of 5 approved) and the full `pnpm mwc check`
      is green on branch `t-17-stage-gate`, which sits on the T-26 test pass. Left for Put live: merge T-26, then
      T-17, then tag `v0.7.0` and push.
- [ ] **S8 cloud deployment:** a hardened compose with TLS and backups, k8s, a staging instance, the runner's signed
      self-update, email over SMTP.
- [ ] **Bonus, only after Ihor approves everything works:** the animated assembly-line view of a flow's stages (a
      Fable 5.2 subagent, styled like buildindex.dev's assembly template).

## Waiting on Ihor

- [ ] Set the "Code Reviewer" profile's GitHub part to **Reviews: Approve**. The PR review tools landed on 2026-11-14
      (migration `0041`); existing parts default to Off.
- [ ] Optional: turn on "Start when you message an agent on it" for the Airia devbox, so Slack requests wake it.
- [ ] **Update runner** on This Mac. The devbox and the Docker runner are current. Until then its agents lack the
      server tools (GitHub, Atlassian, Slack), `record_decision`, the modes, the full trace and session recovery.
- [ ] Rename one of the two agents named "Code Reviewer" (`test-dev` and the DEVBOX reviewer).
- [ ] Optional: the `dev.airiadev.ai` gateway needs an `Authorization: Bearer` header next to its key. Add it on the
      gateway card's Edit.
- [ ] Optional: turn on the machine switches "Start when you message an agent on it" and "Start when an agent on it
      gets work".
- [ ] Decide whether the auto-compact line should also post in Slack.

## Housekeeping

- [ ] About 60 old agent worktrees under `.claude/worktrees/` (`git worktree list`). List them for Ihor before removing
      any.
- [ ] The next near-limit files, split when they are next changed: `packages/shared/src/enums.ts` (289 of 300),
      `packages/db/src/schema/chats.ts` (288), `apps/web/src/pages/design/flows/conversation-sample.ts` (292).
- [ ] Later: Slack could mirror the team structure (a channel per team), Ihor's idea of 2026-11-13.
