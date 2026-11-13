import { type Chat, type ChatTurn, isUniqueViolation, type TenantDb } from '@mwc/db';
import { TurnSpec } from '@mwc/shared/harness';
import type { Logger } from 'pino';
import { queueRepo } from '../repo/queue.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import { ranWith } from '../rules/overrides.ts';
import { nextQueued, startSeq } from '../rules/queue.ts';
import { CHAT_ARCHIVED, MACHINE_OFFLINE, type Refusal, titleOf } from '../rules.ts';
import { tellInbound } from './inbound.ts';
import { holdForSlot, slotCheck } from './slot-wait.ts';
import { resolveTarget, type Target } from './target.ts';
import { artifactsOf, taskDraft } from './task-hook.ts';
import { INVALID_SPEC, launch, specIssues, specTools, type TurnsDeps } from './turns.ts';
import { turnView } from './views.ts';

/**
 * Starting a chat's waiting turns (S5.2 step 6, docs/harness.md "Delivery while a turn runs"): while no turn of the chat
 * runs, the next waiting one (`nextQueued`) starts as a prompt does, as the person who sent it (its checks, its
 * credential, its runner), resuming the chat's session; one refused fails with the refusal's words and the next one is
 * tried, except while a turn of the chat waits for its stopped machine to start (`machine-wait.ts`): its queue then
 * waits for the runner; while every slot of the chat's machine is taken, its next turn waits for a free slot
 * (`slot-wait.ts`). Called after each turn's end, after each message queued or moved up and when a machine that
 * was waited for connects; one chat's starts run one at a time in this process, and a start that loses a race to
 * another (the one-running-turn index) leaves the chat to it.
 */

export interface DrainDeps extends TurnsDeps {
  readonly logger: Logger;
}

/**
 * How one start went: started (or lost a race to another start), waits for a free slot, gone meanwhile, failed, or
 * refused.
 */
type Outcome = 'started' | 'raced' | 'slots' | 'gone' | 'failed' | Refusal;

/** Takes the waiting turn: running, numbered after every turn that started, the chat titled; or why not. */
async function claim(deps: DrainDeps, t: TenantDb, chat: Chat, id: string, target: Target) {
  try {
    return await t.transaction(async (tx): Promise<ChatTurn | 'gone'> => {
      const waiting = (await queueRepo.queuedOf(tx, chat.id)).find((turn) => turn.id === id);
      if (waiting === undefined) return 'gone';
      const lastStarted = await queueRepo.lastStartedSeq(tx, chat.id);
      const seq = startSeq(waiting.seq, lastStarted, await turnsRepo.lastSeq(tx, chat.id));
      const now = deps.clock();
      const { profileId, credentialId } = target;
      const ran = ranWith(target.spec);
      const set = { status: 'running', seq, profileId, credentialId, ...ran, startedAt: now } as const;
      const row = (await queueRepo.updateQueued(tx, chat.id, id, set)) as ChatTurn;
      const current = (await chatsRepo.get(tx, chat.id)) as Chat;
      const title = current.title === null ? { title: titleOf(row.prompt) } : {};
      await chatsRepo.update(tx, chat.id, { updatedAt: now, ...title });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return 'raced';
    throw error;
  }
}

/** Ends a turn that could not start, and tells the stream (and the inbound hook of a turn Most Wanted queued). */
async function failed(deps: DrainDeps, t: TenantDb, turn: ChatTurn, error: string, live: boolean) {
  const set = { status: 'failed', error, endedAt: deps.clock() } as const;
  const row = live
    ? await turnsRepo.updateLive(t, turn.id, set)
    : await queueRepo.updateQueued(t, turn.chatId, turn.id, set);
  if (row === undefined) return;
  deps.live.bus.publish(turn.chatId, { kind: 'turn', turn: turnView(row) });
  await tellInbound(deps.inbound, t, row);
}

/** Starts one waiting turn (see above). */
async function startOne(deps: DrainDeps, t: TenantDb, chatId: string, head: ChatTurn): Promise<Outcome> {
  const chat = (await chatsRepo.get(t, chatId)) as Chat;
  if (chat.archivedAt !== null) return CHAT_ARCHIVED;
  const target = await resolveTarget(deps, t, chat, { principalId: head.createdBy, purpose: 'chat_turn' });
  if (!target.ok) return target;
  const slot = await slotCheck(deps, t, chat);
  if (!slot.free) {
    await holdForSlot(deps, t, head, slot.slots);
    return 'slots';
  }
  const draft = await taskDraft(deps.tasks, t, { chat, agent: target.agent, kind: head.kind });
  const tools = await specTools(deps, t, { chat, target, kind: head.kind, draft });
  const row = await claim(deps, t, chat, head.id, target);
  if (row === 'gone' || row === 'raced') return row;
  const spec = TurnSpec.safeParse({
    ...target.spec,
    prompt: row.prompt,
    ...target.fork,
    ...artifactsOf(draft),
    ...tools,
  });
  if (!spec.success) {
    await failed(deps, t, row, INVALID_SPEC(specIssues(spec.error)).message, true);
    return 'failed';
  }
  const { credentialId, ownerUserId, kind } = target;
  const used = { credentialId, ownerUserId, kind };
  const where = { machineId: chat.machineId, agent: target.agent };
  const sent = await launch(deps, t, row, where, used, spec.data, draft);
  return sent.ok && sent.turn.status !== 'failed' ? 'started' : 'failed';
}

/** Starts waiting turns until one runs or none waits. */
async function drain(deps: DrainDeps, t: TenantDb, chatId: string): Promise<void> {
  for (;;) {
    if ((await queueRepo.runningOf(t, chatId)) !== undefined) return;
    const head = nextQueued(await queueRepo.queuedOf(t, chatId));
    if (head === undefined) return;
    const outcome = await startOne(deps, t, chatId, head);
    if (outcome === 'started' || outcome === 'raced' || outcome === 'slots') return;
    if (typeof outcome !== 'object') continue;
    if (outcome.code === MACHINE_OFFLINE.code && (await queueRepo.machineWaitsOf(t, chatId)).length > 0)
      return;
    await failed(deps, t, head, outcome.message, false);
  }
}

/** The chats' queue in this process: `startNext` starts the chat's next waiting turn while none runs. */
export function chatQueue(deps: DrainDeps) {
  const chains = new Map<string, Promise<void>>();
  return {
    startNext(t: TenantDb, chatId: string): Promise<void> {
      const next = (chains.get(chatId) ?? Promise.resolve())
        .then(() => drain(deps, t, chatId))
        .catch((error: unknown) => {
          deps.logger.error({ err: error, chatId }, 'chats: could not start the next waiting turn');
        });
      chains.set(chatId, next);
      void next.then(() => {
        if (chains.get(chatId) === next) chains.delete(chatId);
      });
      return next;
    },
  };
}

export type ChatQueue = ReturnType<typeof chatQueue>;
