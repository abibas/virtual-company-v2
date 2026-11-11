import type { DbHandle, TenantDb } from '@mwc/db';
import { artifactsFolder } from '@mwc/shared/flows';
import type { Logger } from 'pino';
import type {
  TaskTurnContext,
  TaskTurnEnd,
  TaskTurnHook,
  TaskTurnLink,
  TaskTurns,
} from '../../chats/index.ts';
import { tasksRepo } from '../repo.ts';
import { decisionNote, decisionOf } from '../rules/decision.ts';
import { replyStarted, turnEnded } from '../rules/runs.ts';
import { roundsAt } from '../rules.ts';
import { storeFile, storeNote, storeSkipped } from './artifacts.ts';
import { applyDecision, dropDecision } from './decision.ts';
import { changeStep, type RunDeps } from './runs.ts';
import { callTool, toolsFor } from './tools.ts';

/**
 * The tasks module's side of a task's conversation (S5.3b, the chats module's `TaskTurnHook`, passed in by `app.ts`):
 * before a message turn starts, its round and outputs folder (`tasks/T-12/artifacts/<step>/round-<n>`); when it starts,
 * a task that waits, ended without a hand-off or is blocked at the step is worked on again (a person's reply in the
 * conversation continues it); each collected file and each file left out is kept with the task, the step and the round;
 * at its end the reply is kept as the step's hand-off note and, while the task is still worked on at the step and no
 * other turn of its conversations runs there, the task ends `ended_without_handoff` (or `blocked` by a failure) and the
 * Lead's nearest person is told. Since S6a it gives an agent's turns their tools and answers their calls (`tools.ts`):
 * a step's turn that recorded a decision and ended done has it applied in place of `ended_without_handoff`, its summary,
 * findings or note as the round's hand-off note; a turn that fails or is stopped drops it. Each method logs its own
 * failure and never throws (it runs on a turn's write queue).
 */

const repo = tasksRepo;

/** The round and folder of a message turn of the task's conversation at the step; undefined once the step is gone. */
async function prepare(t: TenantDb, link: TaskTurnLink) {
  const task = await repo.tasks.get(t, { id: link.taskId });
  const step = task && (await repo.flows.steps(t, task.flowId)).find((s) => s.id === link.stepId);
  if (task === undefined || step === undefined) return undefined;
  const round = Math.max(1, roundsAt(task.rounds, step.id).entries);
  return { round, artifactsDir: artifactsFolder(task.number, step, round) };
}

/** A person's message started a turn of the step's conversation: the task is worked on again, by them. */
async function started(t: TenantDb, turn: TaskTurnContext, by: string) {
  const task = await repo.tasks.get(t, { id: turn.taskId });
  if (task === undefined) return;
  await changeStep(repo, t, task, turn.stepId, replyStarted, { principalId: by, requestId: null });
}

/**
 * The turn ended: the round's hand-off note (its decision's words, else its reply), then its decision applied, or the
 * task waiting for a person (see above).
 */
async function ended(deps: RunDeps, t: TenantDb, turn: TaskTurnContext, end: TaskTurnEnd, now: Date) {
  const task = await repo.tasks.get(t, { id: turn.taskId });
  const decision = task && decisionOf(task, turn.turnId);
  const applies = decision !== undefined && end.status === 'done';
  const note = (applies ? decisionNote(decision) : null) ?? end.resultText;
  if (note !== null && note.trim() !== '') await storeNote(repo, t, turn, note);
  if (task === undefined) return;
  if (await repo.conversations.othersRunning(t, task.id, turn.stepId, turn.turnId)) {
    if (decision !== undefined) await dropDecision(repo, t, turn);
    return;
  }
  if (applies) {
    await applyDecision(deps, repo, t, turn, now);
    return;
  }
  await changeStep(repo, t, task, turn.stepId, (at, step) => turnEnded(at, step, end));
  // A failed or stopped turn's decision goes, even when the task's step state did not change.
  if (decision !== undefined) await dropDecision(repo, t, turn);
}

/** A method that logs its own failure by the turn and gives `fallback` instead of throwing. */
function guarded<A extends [TenantDb, ...unknown[]], R>(
  logger: Logger,
  name: string,
  work: (...args: A) => Promise<R>,
  fallback: R,
): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await work(...args);
    } catch (error) {
      const turn = args[1] as Partial<TaskTurnContext>;
      logger.error(
        { err: error, taskId: turn.taskId, turnId: turn.turnId },
        `tasks: a step's run could not ${name}`,
      );
      return fallback;
    }
  };
}

/**
 * What the hook needs: the logger, the database (names) and, to run the next step after a decision or a Lead's move,
 * the chats' way to run a step, asked when needed (the chats runtime is made after its hook).
 */
export interface HookDeps {
  readonly logger: Logger;
  readonly db: DbHandle;
  readonly clock?: (() => Date) | undefined;
  readonly steps?: (() => TaskTurns | undefined) | undefined;
}

export const TOOL_FAILED = 'The tool could not be carried out on the server; nothing was changed.';

/** The hook the chats module calls for every message turn of a task's conversation, and for agents' tools. */
export function taskTurnHook(deps: HookDeps): TaskTurnHook {
  const { logger } = deps;
  const run = (): RunDeps => ({ db: deps.db, steps: deps.steps?.() });
  const clock = deps.clock ?? (() => new Date());
  return {
    prepare: guarded(logger, 'plan its turn', prepare, undefined),
    started: guarded(logger, 'record its start', started, undefined),
    collected: guarded(
      logger,
      'keep a collected file',
      (t, turn, file) => storeFile(repo, t, turn, file),
      undefined,
    ),
    skipped: guarded(
      logger,
      'keep what was left out',
      (t, turn, c) => storeSkipped(repo, t, turn, c),
      undefined,
    ),
    ended: guarded(
      logger,
      'record its end',
      (t, turn, end) => ended(run(), t, turn, end, clock()),
      undefined,
    ),
    toolsFor: guarded(logger, 'give its tools', (t, turn) => toolsFor(repo, t, turn), { tools: [] }),
    tool: guarded(logger, 'answer a tool', (t, turn, call) => callTool(run(), repo, t, turn, call, clock()), {
      ok: false,
      text: TOOL_FAILED,
    }),
  };
}
