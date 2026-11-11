import { type Agent, type Chat, type ChatTurn, isUniqueViolation, type TenantDb } from '@mwc/db';
import type { ChatTurnKind } from '@mwc/shared/enums';
import { TurnSpec } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import {
  CHAT_ARCHIVED,
  CHAT_NOT_FOUND,
  MACHINE_OFFLINE,
  type Refusal,
  refuse,
  TURN_NOT_FOUND,
  TURN_NOT_RUNNING,
  TURN_RUNNING,
  titleOf,
} from '../rules.ts';
import type { ChatTurnView } from '../schemas.ts';
import type { ChatsLive, TurnCredential } from './live.ts';
import { resolveTarget, type Target, type TargetDeps } from './target.ts';
import {
  artifactsOf,
  type TaskTurnDraft,
  type TaskTurnHook,
  taskContext,
  taskDraft,
  toolsOf,
} from './task-hook.ts';
import { turnView } from './views.ts';

/**
 * A chat's turns (S5.1b, docs/harness.md "How a turn runs"): a prompt starts one on the agent's machine (resolved by
 * `target.ts`, refused with what to fix), recorded as running with the profile and credential it runs on, then sent to
 * the runner (`turn.start`) with its sink in place, so its events and end land in the database and the chat's stream;
 * the first prompt is the chat's title. A stop asks the runner to stop it; its end says `stopped`. A Compact is such a
 * turn too, of kind `compact` (`conversation.ts`), and so is an answer to the agent's question (`answers.ts`), which
 * checks and marks its question in the transaction that records the turn. A message sent while a turn runs waits in
 * the chat's queue instead (`queue.ts`, S5.2 step 6), which starts it through `launch` once the running turn ended. A
 * message turn of a task's conversation (S5.3b) gets its outputs folder from the tasks module's hook, which hears of
 * its start (`task-hook.ts`).
 */

export interface TurnsDeps extends TargetDeps {
  readonly live: ChatsLive;
  readonly clock: () => Date;
  /** The tasks module's side of a task's conversation (S5.3b); none: chats know nothing of tasks. */
  readonly tasks?: TaskTurnHook | undefined;
}

/** Who starts or stops a turn: their principal. */
export interface TurnCaller {
  readonly principalId: string;
}

type Started = { readonly ok: true; readonly turn: ChatTurnView } | Refusal;

export const INVALID_SPEC = (paths: string) =>
  refuse(422, 'invalid_spec', `The agent's settings cannot start a turn (${paths}): fix them on the agent`);

/** What kind of turn to start (a prompt, a `/compact`), and why this chat may not have one, beyond a turn's checks. */
export interface TurnKindOptions {
  readonly kind: ChatTurnKind;
  readonly refuse?: (chat: Chat) => Refusal | undefined;
  /** In the transaction that records the turn, before it, with its number: a refusal records nothing. */
  readonly check?: (seq: number) => Refusal | undefined;
  /** In that transaction, after the turn is written; what it returns runs once it is committed. */
  readonly alongside?: (tx: TenantDb, turn: ChatTurn) => Promise<() => void>;
}

/**
 * Records the turn as running, unless another one runs (409) or `how.check` refuses, gives the chat its title on the
 * first, and writes what `how.alongside` adds in the same transaction.
 */
async function record(
  t: TenantDb,
  chatId: string,
  values: Omit<Parameters<typeof turnsRepo.insert>[1], 'seq'>,
  how: TurnKindOptions,
) {
  let committed: (() => void) | undefined;
  try {
    const recorded = await t.transaction(async (tx) => {
      const seq = (await turnsRepo.lastSeq(tx, chatId)) + 1;
      const refused = how.check?.(seq);
      if (refused !== undefined) return refused;
      const turn = await turnsRepo.insert(tx, { ...values, seq });
      committed = await how.alongside?.(tx, turn);
      const chat = (await chatsRepo.get(tx, chatId)) as Chat;
      const title = chat.title === null ? { title: titleOf(values.prompt) } : {};
      await chatsRepo.update(tx, chatId, { updatedAt: values.startedAt as Date, ...title });
      return turn;
    });
    committed?.();
    return recorded;
  } catch (error) {
    if (isUniqueViolation(error)) return TURN_RUNNING;
    throw error;
  }
}

/** Starts a turn of the chat with this prompt (see above); 202 with the turn, or why not. */
export async function startTurn(
  deps: TurnsDeps,
  t: TenantDb,
  caller: TurnCaller,
  chatId: string,
  prompt: string,
  how: TurnKindOptions = { kind: 'message' },
): Promise<Started> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  if (chat.archivedAt !== null) return CHAT_ARCHIVED;
  if ((await turnsRepo.liveOf(t, chat.id)) !== undefined) return TURN_RUNNING;
  const refused = how.refuse?.(chat);
  if (refused !== undefined) return refused;
  const target = await resolveTarget(deps, t, chat, {
    principalId: caller.principalId,
    purpose: 'chat_turn',
  });
  if (!target.ok) return target;
  const draft = await taskDraft(deps.tasks, t, { chat, agent: target.agent, kind: how.kind });
  const tools = await specTools(deps, t, { chat, target, kind: how.kind, draft });
  const spec = TurnSpec.safeParse({
    ...target.spec,
    prompt,
    ...target.fork,
    ...artifactsOf(draft),
    ...tools,
  });
  if (!spec.success) return INVALID_SPEC(specIssues(spec.error));
  const now = deps.clock();
  const turn = await record(
    t,
    chat.id,
    {
      id: newId(),
      chatId: chat.id,
      kind: how.kind,
      prompt,
      status: 'running',
      profileId: target.profileId,
      credentialId: target.credentialId,
      startedAt: now,
      createdBy: caller.principalId,
    },
    how,
  );
  if ('ok' in turn) return turn;
  const { credentialId, ownerUserId, kind } = target;
  const used = { credentialId, ownerUserId, kind };
  return launch(deps, t, turn, { machineId: chat.machineId, agent: target.agent }, used, spec.data, draft);
}

/** What a turn's spec adds for the agents' tools (S6a) when its runner offers them: their names, its instructions. */
export const specTools = (
  deps: TurnsDeps,
  t: TenantDb,
  turn: {
    readonly chat: Chat;
    readonly target: Target;
    readonly kind: ChatTurnKind;
    readonly draft: TaskTurnDraft | undefined;
  },
) =>
  toolsOf(deps.tasks, t, {
    chat: turn.chat,
    agent: turn.target.agent,
    kind: turn.kind,
    draft: turn.draft,
    offers: turn.target.agentTools,
    instructions: turn.target.spec.instructions,
  });

/** Why a spec failed its schema: the paths of its issues, once each. */
export const specIssues = (error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[] }[];
}) => [...new Set(error.issues.map((i) => i.path.join('.')))].join(', ');

/**
 * Sends the recorded turn to its machine's runner and tells the stream (and, for a task's turn, the tasks module); one
 * gone in the meantime fails it at once (`machine_offline`). Its sink knows the chat's agent, whose tools it answers.
 */
export async function launch(
  deps: TurnsDeps,
  t: TenantDb,
  turn: ChatTurn,
  where: { readonly machineId: string; readonly agent: Pick<Agent, 'principalId'> },
  used: TurnCredential,
  spec: TurnSpec,
  draft?: TaskTurnDraft,
): Promise<Started> {
  const { machineId } = where;
  const task = taskContext(draft, turn);
  const sink = deps.live.sink(t, turn, used, { task, agentPrincipalId: where.agent.principalId });
  const channel = deps.hub.turn(machineId, { turnId: turn.id, spec }, sink);
  if (channel === undefined) {
    deps.live.forget(turn.id);
    const ended = { status: 'failed', error: MACHINE_OFFLINE.code, endedAt: deps.clock() } as const;
    return { ok: true, turn: turnView((await turnsRepo.updateLive(t, turn.id, ended)) ?? turn) };
  }
  deps.live.started(turn.id, channel);
  deps.live.bus.publish(turn.chatId, { kind: 'turn', turn: turnView(turn) });
  if (task !== undefined) await deps.tasks?.started(t, task, turn.createdBy);
  return { ok: true, turn: turnView(turn) };
}

/** Asks the runner to stop the chat's running turn; 202 with the turn, or why not. */
export async function stopTurn(
  deps: TurnsDeps,
  t: TenantDb,
  chatId: string,
  turnId: string,
): Promise<Started> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  const turn = await turnsRepo.get(t, chat.id, turnId);
  if (turn === undefined) return TURN_NOT_FOUND;
  if (turn.status !== 'running' || !deps.live.stop(turn.id)) return TURN_NOT_RUNNING;
  return { ok: true, turn: turnView(turn) };
}
