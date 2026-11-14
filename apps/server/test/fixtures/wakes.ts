/**
 * The Lead wake-ups' tests helpers (S6c): the chats' world with the wake-up tick on timers fired by hand, a team whose
 * Lead agent (and Developer) sit on an online machine offering the agents' tools with an access profile, a flow of
 * Develop (the Developer, started by hand), QA (the tester, a person, sending back to Develop with a limit of 1) and
 * Approve (the owner's Sign-off), the moves that make each event, and the rows a wake-up leaves. Never a real CLI: the
 * runner is the fake.
 */
import { chats, chatTurns, type DbHandle, leadWakeEvents, notifications } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { and, asc, eq } from 'drizzle-orm';
import { BOTH_HARNESSES, type ChatsWorld, chatsWorld, endTurn, place } from './chats/world.ts';
import { enroll } from './machines/machines.ts';
import { addSubscription, putProfile, seedProfile } from './org.ts';
import { type ManualTimers, manualTimers } from './platform/jobs.ts';
import { agentOf, finish } from './runs.ts';
import { type FlowView, makeFlow, makeTask, moved, stepOf, type TeamCompany, teamCompany } from './tasks.ts';

export interface WakeWorld extends ChatsWorld {
  /** The wake-up tick's timers: `fire()` runs one tick. */
  readonly ticks: ManualTimers;
}

export async function wakeWorld(): Promise<WakeWorld> {
  const ticks = manualTimers();
  const w = await chatsWorld({}, { leadWakeTimers: ticks.timers });
  return { ...w, ticks };
}

export interface WakeScene {
  readonly c: TeamCompany;
  readonly flow: FlowView;
  readonly runner: FakeRunner;
  readonly machineId: string;
}

export interface WakeOptions {
  /** Leave the Lead without a placement. */
  readonly leadUnplaced?: boolean;
  /** The machine's slots (the fake runner's eight unless said). */
  readonly slots?: number;
  /** Its runner offers the decision log's `record_decision` too (`caps.decisions`). */
  readonly decisions?: boolean;
}

/** The team, its machine online (with the agents' tools), the Lead and the Developer placed with a profile, the flow. */
export async function wakeScene(w: WakeWorld, options: WakeOptions = {}): Promise<WakeScene> {
  const c = await teamCompany(w);
  const { machineId, runnerKey } = await enroll(w, c);
  const slots = options.slots === undefined ? {} : { slots: options.slots };
  const decisions = options.decisions === true ? { decisions: true } : {};
  const caps = { ...BOTH_HARNESSES, agentTools: true, ...slots, ...decisions };
  const runner = await w.connect(runnerKey, { caps });
  const credential = await addSubscription(w, w.keyring, c.owner.userId, 'claude_setup_token');
  const profile = await seedProfile(w.t.db, c.owner.userId, {
    credentialId: credential.id,
    model: 'claude-opus-5-5',
  });
  const placed = options.leadUnplaced ? [c.developer] : [c.developer, c.lead];
  for (const principal of placed) {
    const agent = await agentOf(w.t.db, principal);
    await place(w, c, agent.id, { machineId });
    await putProfile(w.t.db, c.companyId, agent.id, profile.id);
  }
  const steps = [
    { name: 'Develop', kind: 'work', assigneePrincipalId: c.developer },
    {
      name: 'QA',
      kind: 'check',
      assigneePrincipalId: c.tester.principalId,
      sendsBackTo: 'Develop',
      sendBackLimit: 1,
    },
    { name: 'Approve', kind: 'signoff', assigneePrincipalId: c.owner.principalId, sendsBackTo: 'Develop' },
  ];
  const flow = await makeFlow(w, c, { steps });
  return { c, flow, runner, machineId };
}

/** A task made at a step (the owner leads the team). */
export const taskAt = (w: WakeWorld, s: WakeScene, step: string, title = 'Fix the login') =>
  makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, title, stepId: stepOf(s.flow, step).id });

/** Escalates the task: at QA, the tester sends it back (its one), the owner hands it on again, and sends it back again. */
export async function escalate(w: WakeWorld, s: WakeScene, key: string): Promise<void> {
  const { c } = s;
  await moved(w, c, c.tester, key, { action: 'send_back', reason: 'The tests fail' });
  await moved(w, c, c.owner, key, { action: 'hand_on' });
  await moved(w, c, c.tester, key, { action: 'send_back', reason: 'Still failing on Safari' });
}

/** Starts the task at Develop and has the runner end its turn: done (turn ended) or failed (blocked). */
export async function runDevelop(
  w: WakeWorld,
  s: WakeScene,
  key: string,
  end: 'done' | 'failed',
): Promise<void> {
  await moved(w, s.c, s.c.owner, key, { action: 'start' });
  const start = await s.runner.frames.next('turn.start');
  if (end === 'done') finish(s.runner, start, 'I looked at it.');
  else endTurn(s.runner, start.turnId, { ok: false, exitCode: 1, error: 'The repo is missing' });
}

/** The flow's wake events as stored, oldest first. */
export const wakeEvents = (db: DbHandle, flowId: string) =>
  rawDb(db)
    .select()
    .from(leadWakeEvents)
    .where(eq(leadWakeEvents.flowId, flowId))
    .orderBy(asc(leadWakeEvents.createdAt), asc(leadWakeEvents.id));

/** The flow's team chats as stored, oldest first. */
export const teamChatsOf = (db: DbHandle, flowId: string) =>
  rawDb(db).select().from(chats).where(eq(chats.flowId, flowId)).orderBy(asc(chats.createdAt), asc(chats.id));

/** A chat's turns as stored, by number. */
export const turnsOf = (db: DbHandle, chatId: string) =>
  rawDb(db).select().from(chatTurns).where(eq(chatTurns.chatId, chatId)).orderBy(asc(chatTurns.seq));

/** The notifications of a kind a principal got, oldest first. */
export const noticesOf = (db: DbHandle, recipient: string, kind: string) =>
  rawDb(db)
    .select()
    .from(notifications)
    .where(and(eq(notifications.recipientPrincipalId, recipient), eq(notifications.kind, kind as never)))
    .orderBy(asc(notifications.id));

/** Runs the tick now, then again once the clock passed the window (60 s by default). */
export async function tickPastWindow(w: WakeWorld, seconds = 60): Promise<void> {
  await w.ticks.fire();
  w.clock.advance(seconds * 1000);
  await w.ticks.fire();
}
