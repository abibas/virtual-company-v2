/**
 * The step runs' tests helpers (S5.3b): the chats' world (a real runner socket, `FakeRunner`), a team company whose
 * Developer and Code Reviewer agents are placed on an online machine with an access profile, a flow of Develop (Work),
 * Code review (Check, sending back to Develop) and Approve (the owner's Sign-off), and the runner's side of a step's
 * turn: its `turn.start`, an answer, its end, collected files. Never a real CLI: the runner is the fake.
 */
import { createHash } from 'node:crypto';
import { agents, chats, type DbHandle, taskArtifacts, tasks } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { TurnEvent } from '@mwc/shared/harness';
import type { TurnArtifact, TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import { asc, eq } from 'drizzle-orm';
import {
  BOTH_HARNESSES,
  type ChatsWorld,
  endTurn,
  eventually,
  HOME,
  place,
  sendEvents,
} from './chats/world.ts';
import { enroll } from './machines/machines.ts';
import { addSubscription, putProfile, seedProfile } from './org.ts';
import { type FlowView, makeFlow, type TeamCompany, teamCompany } from './tasks.ts';

export { endTurn, eventually, HOME, sendEvents };

/** The agent row of a principal. */
export const agentOf = async (db: DbHandle, principalId: string) =>
  (
    await rawDb(db).select().from(agents).where(eq(agents.principalId, principalId))
  )[0] as typeof agents.$inferSelect;

export interface RunScene {
  readonly c: TeamCompany;
  readonly flow: FlowView;
  readonly machineId: string;
  readonly runner: FakeRunner;
}

export interface RunOptions {
  /** How Develop starts (auto by default). */
  readonly starts?: 'auto' | 'manual';
  /** What Code review does when the task comes back (keep by default). */
  readonly reviewReturns?: 'keep' | 'fresh';
  /** Leave the Developer without a placement. */
  readonly unplaced?: boolean;
}

/** The team company, its machine online, its Developer and Code Reviewer placed with a profile, and the flow. */
export async function runScene(w: ChatsWorld, options: RunOptions = {}): Promise<RunScene> {
  const c = await teamCompany(w);
  const { machineId, runnerKey } = await enroll(w, c);
  const runner = await w.connect(runnerKey, { caps: BOTH_HARNESSES });
  const credential = await addSubscription(w, w.keyring, c.owner.userId, 'claude_setup_token');
  const profile = await seedProfile(w.t.db, c.owner.userId, {
    credentialId: credential.id,
    model: 'claude-opus-5-5',
  });
  for (const principal of options.unplaced ? [c.reviewer] : [c.developer, c.reviewer]) {
    const agent = await agentOf(w.t.db, principal);
    await place(w, c, agent.id, { machineId });
    await putProfile(w.t.db, c.companyId, agent.id, profile.id);
  }
  const steps = [
    { name: 'Develop', kind: 'work', assigneePrincipalId: c.developer, starts: options.starts ?? 'auto' },
    {
      name: 'Code review',
      kind: 'check',
      assigneePrincipalId: c.reviewer,
      starts: 'auto',
      onReturn: options.reviewReturns ?? 'keep',
      sendsBackTo: 'Develop',
      sendBackLimit: 3,
    },
    { name: 'Approve', kind: 'signoff', assigneePrincipalId: c.owner.principalId, sendsBackTo: 'Develop' },
  ];
  const flow = await makeFlow(w, c, { steps });
  return { c, flow, machineId, runner };
}

/** A whole answer of a step's turn: its session, the reply, the usage and the result. */
export const answer = (reply: string, session = 'b4c1f0e2-session'): TurnEvent[] => [
  { type: 'session', sessionId: session },
  { type: 'text', text: reply },
  { type: 'usage', inputTokens: 12, outputTokens: 3 },
  { type: 'result', ok: true, text: reply, durationMs: 900 },
];

/** The runner answers the turn and ends it (ok). */
export function finish(runner: FakeRunner, start: TurnStart, reply = 'Done.', session?: string): void {
  sendEvents(runner, start.turnId, answer(reply, session));
  endTurn(runner, start.turnId);
}

/** The task's row as stored. */
export const taskRow = async (db: DbHandle, id: string) =>
  (await rawDb(db).select().from(tasks).where(eq(tasks.id, id)))[0] as typeof tasks.$inferSelect;

/** Waits until the task's step state is `state`, and gives its row. */
export async function stepStateIs(db: DbHandle, id: string, state: string) {
  await eventually(`the task is ${state}`, async () => (await taskRow(db, id)).stepState === state);
  return taskRow(db, id);
}

/** The task's conversations as stored, oldest first. */
export const conversationsOf = (db: DbHandle, taskId: string) =>
  rawDb(db).select().from(chats).where(eq(chats.taskId, taskId)).orderBy(asc(chats.createdAt), asc(chats.id));

/** The task's artifacts as stored, oldest first. */
export const artifactsOf = (db: DbHandle, taskId: string) =>
  rawDb(db)
    .select()
    .from(taskArtifacts)
    .where(eq(taskArtifacts.taskId, taskId))
    .orderBy(asc(taskArtifacts.id));

/** A file's `turn.artifact` frames: its bytes in parts of `partBytes` (128 KB unless said), its hash and type. */
export function fileFrames(
  turnId: string,
  index: number,
  path: string,
  bytes: Uint8Array,
  options: { readonly contentType?: string; readonly sha256?: string; readonly partBytes?: number } = {},
): TurnArtifact[] {
  const partBytes = options.partBytes ?? 128 * 1024;
  const parts = Math.max(1, Math.ceil(bytes.length / partBytes));
  const sha256 = options.sha256 ?? createHash('sha256').update(bytes).digest('hex');
  return Array.from({ length: parts }, (_, part) => ({
    type: 'turn.artifact',
    turnId,
    index,
    path,
    contentType: options.contentType ?? 'text/plain; charset=utf-8',
    size: bytes.length,
    sha256,
    part,
    parts,
    data: Buffer.from(bytes.subarray(part * partBytes, (part + 1) * partBytes)).toString('base64'),
  }));
}

/** UTF-8 bytes of a text. */
export const utf8 = (text: string) => new TextEncoder().encode(text);
