import { type Agent, type Chat, type ChatTurn, type DbHandle, type TenantDb, tenant } from '@mwc/db';
import type { MachineWait, MembershipRole } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import type { Logger } from 'pino';
import type { Timers } from '../../../platform/jobs/runner.ts';
import type { ConnectedRunner, MachineWake, WakeFailure, WakeTrigger } from '../../machines/index.ts';
import { queueRepo } from '../repo/queue.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import {
  cannotStart,
  MACHINE_WAIT_MS,
  machineStopped,
  messageReason,
  notConnectedText,
  SLOT_WAIT_MS,
  waitedOut,
} from '../rules/machine.ts';
import { MACHINE_OFFLINE, type Refusal } from '../rules.ts';
import type { ChatTurnView } from '../schemas.ts';
import type { ChatsLive } from './live.ts';
import { type TaskTurnHook, taskContext, taskDraft } from './task-hook.ts';
import { turnView } from './views.ts';

/**
 * A turn for an agent whose machine is stopped (docs/harness.md, "When the machine is stopped"): instead of the
 * `machine_offline` refusal, the machines module's wake starts the machine (its policy's switch for the trigger, or the
 * person's Start and send) and the turn waits `queued` with `machine_wait_at`, delivered after; when the machine's runner
 * connects its chat's queue starts it as any waiting turn. It fails when the start fails (in the wake's words) or
 * `MACHINE_WAIT_MS` after it began waiting; the person can stop it. A task's turn that ends so is told to the tasks
 * module's hook, which blocks the task with those words. Wakes that are refused come back as `machine_stopped` (the
 * switch is off) or `machine_offline` in the wake's words (nothing here can start it).
 */

/** What a turn on a stopped machine may do: wake it for this trigger, why, for whom, and whether they asked. */
export interface TurnWake {
  readonly trigger: WakeTrigger;
  /** The power log's reason; a message's by default ("Started for a message to Developer"). */
  readonly reason?: string | undefined;
  /** The person the turn is for, with their role here (an admin or owner may start the machine). */
  readonly person?: { readonly userId: string; readonly role: MembershipRole } | undefined;
  /** They asked to start it (Start and send). */
  readonly asked?: boolean | undefined;
}

/** The chats' side of the waits, made once per runtime (`machineWaits`). */
export interface MachineWaits {
  readonly wake: MachineWake;
  /**
   * A turn of the chat began waiting for its machine to start (or, `slots`, for a free slot): the ones still waiting so
   * `MACHINE_WAIT_MS` (`SLOT_WAIT_MS`) later fail.
   */
  watch(t: TenantDb, chatId: string, machineName: string, wait?: MachineWait): void;
  /** Starts the chat's next waiting turn while none runs (the queue's). */
  startNext(t: TenantDb, chatId: string): Promise<void>;
  /** The machine's runner connected: each chat waiting for it starts its next turn. */
  connected(runner: Pick<ConnectedRunner, 'companyId' | 'machineId'>): Promise<void>;
  /** A wake's start failed: the turns waiting for that machine fail with why. */
  failed(failure: WakeFailure): Promise<void>;
  /** The person stopped a waiting turn; undefined when it no longer waits. */
  stop(t: TenantDb, turn: ChatTurn): Promise<ChatTurn | undefined>;
}

type Started = { readonly ok: true; readonly turn: ChatTurnView } | Refusal;

/** What a wait needs of the turns' deps. */
export interface WaitingDeps {
  readonly waits?: MachineWaits | undefined;
  readonly live: ChatsLive;
  readonly clock: () => Date;
}

/** Who sends the turn, and what it may do to a stopped machine. */
export interface WaitingCaller {
  readonly principalId: string;
  readonly system?: boolean | undefined;
  readonly wake?: TurnWake | undefined;
}

/** Records a turn waiting for the chat's machine (to start, or for a free slot), delivered after. */
export const recordWaiting = (
  deps: Pick<WaitingDeps, 'clock'>,
  t: TenantDb,
  caller: WaitingCaller,
  chat: Chat,
  turn: { readonly prompt: string; readonly wait: MachineWait },
) =>
  t.transaction(async (tx) => {
    const seq = (await turnsRepo.lastSeq(tx, chat.id)) + 1;
    return turnsRepo.insert(tx, {
      id: newId(),
      chatId: chat.id,
      seq,
      prompt: turn.prompt,
      status: 'queued',
      delivery: 'after',
      machineWait: turn.wait,
      machineWaitAt: deps.clock(),
      createdBy: caller.principalId,
      system: caller.system === true,
    });
  });

/**
 * A prompt whose chat's machine has no connected runner (see above): the turn waiting for the machine, or why not; a
 * caller with no wake (a Compact, an answer) gets `machine_offline` as before.
 */
export async function waitForMachine(
  deps: WaitingDeps,
  t: TenantDb,
  caller: WaitingCaller,
  chat: Chat,
  prompt: string,
): Promise<Started> {
  const { waits } = deps;
  const wake = caller.wake;
  if (waits === undefined || wake === undefined) return MACHINE_OFFLINE;
  const agent = (await chatsRepo.agentOf(t, chat.agentId)) as Agent;
  const request = { ...wake, reason: wake.reason ?? messageReason(agent.name) };
  // Recorded first, so a start that fails at once finds the turn to fail; taken back when no start comes.
  const turn = await recordWaiting(deps, t, caller, chat, { prompt, wait: 'stopped' });
  const woken = await waits.wake.wake(t, chat.machineId, request);
  if (!woken.ok) {
    await queueRepo.deleteQueued(t, chat.id, turn.id);
    return 'canStart' in woken
      ? machineStopped(woken.machine, woken.canStart, wake.trigger)
      : cannotStart(woken.message);
  }
  waits.watch(t, chat.id, woken.machine.name);
  if (woken.state === 'up') await waits.startNext(t, chat.id);
  const now = turnView((await turnsRepo.get(t, chat.id, turn.id)) ?? turn);
  deps.live.bus.publish(chat.id, { kind: 'turn', turn: now });
  return { ok: true, turn: now };
}

export interface MachineWaitsDeps {
  readonly db: DbHandle;
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly live: ChatsLive;
  readonly tasks?: TaskTurnHook | undefined;
  readonly wake: MachineWake;
  readonly timers: Timers;
  readonly startNext: (t: TenantDb, chatId: string) => Promise<void>;
  /** The words of a wait for a free slot that ran out, with the machine's slots then (`slot-wait.ts`). */
  readonly slotWords?: ((t: TenantDb, chatId: string) => Promise<string>) | undefined;
}

/** Tells the tasks module's hook of a task's turn that ended while it waited (none for any other chat). */
async function reportTask(deps: MachineWaitsDeps, t: TenantDb, row: ChatTurn) {
  if (deps.tasks === undefined) return;
  const chat = (await chatsRepo.get(t, row.chatId)) as Chat;
  const agent = (await chatsRepo.agentOf(t, chat.agentId)) as Agent;
  const task = taskContext(await taskDraft(deps.tasks, t, { chat, agent, kind: row.kind }), row);
  if (task !== undefined)
    await deps.tasks.ended(t, task, { status: row.status, resultText: null, error: row.error });
}

/** Ends a waiting turn (failed or stopped), tells the stream and a task; undefined when it no longer waits. */
async function endWaiting(
  deps: MachineWaitsDeps,
  t: TenantDb,
  turn: ChatTurn,
  status: 'failed' | 'stopped',
  error: string,
) {
  const row = await queueRepo.updateQueued(t, turn.chatId, turn.id, { status, error, endedAt: deps.clock() });
  if (row === undefined) return undefined;
  deps.live.bus.publish(row.chatId, { kind: 'turn', turn: turnView(row) });
  await reportTask(deps, t, row);
  return row;
}

/** The waits of this runtime (see above); a failure of the listeners' work is logged, never thrown. */
export function machineWaits(deps: MachineWaitsDeps): MachineWaits {
  const logged = (what: string, work: () => Promise<void>) =>
    work().catch((error: unknown) => deps.logger.error({ err: error }, `chats: could not ${what}`));
  /** Fails the chat's waiting turns (those `only` picks), then starts what can start. */
  const fail = async (t: TenantDb, chatId: string, error: string, only: (turn: ChatTurn) => boolean) => {
    for (const turn of await queueRepo.machineWaitsOf(t, chatId)) {
      if (only(turn)) await endWaiting(deps, t, turn, 'failed', error);
    }
    await deps.startNext(t, chatId);
  };
  return {
    wake: deps.wake,
    startNext: deps.startNext,
    watch(t, chatId, machineName, wait = 'stopped') {
      const words = async () =>
        wait === 'slots' && deps.slotWords !== undefined
          ? deps.slotWords(t, chatId)
          : notConnectedText(machineName);
      deps.timers.setTimeout(
        () =>
          logged('end a wait for a machine', async () => {
            const now = deps.clock();
            const waitedFor = (turn: ChatTurn) =>
              (turn.machineWait ?? 'stopped') === wait && waitedOut(turn.machineWaitAt as Date, now, wait);
            return fail(t, chatId, await words(), waitedFor);
          }),
        wait === 'slots' ? SLOT_WAIT_MS : MACHINE_WAIT_MS,
      );
    },
    connected: (runner) =>
      logged('start the turns that waited for a machine', async () => {
        const t = await tenant(deps.db, runner.companyId);
        for (const chatId of await queueRepo.chatsWaitingOn(t, runner.machineId))
          await deps.startNext(t, chatId);
      }),
    failed: (failure) =>
      logged('fail the turns that waited for a machine', async () => {
        const t = await tenant(deps.db, failure.companyId);
        for (const chatId of await queueRepo.chatsWaitingOn(t, failure.machineId)) {
          await fail(t, chatId, failure.message, () => true);
        }
      }),
    async stop(t, turn) {
      const row = await endWaiting(deps, t, turn, 'stopped', 'stopped');
      await deps.startNext(t, turn.chatId);
      return row;
    },
  };
}
