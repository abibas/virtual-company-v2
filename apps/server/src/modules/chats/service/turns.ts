import { type Agent, type Chat, type ChatTurn, isUniqueViolation, type TenantDb } from '@mwc/db';
import type { ChatTurnKind } from '@mwc/shared/enums';
import { TurnSpec } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import { machineBusy } from '../rules/machine.ts';
import { ranWith } from '../rules/overrides.ts';
import { fromColumns, type TurnFrom } from '../rules/sender.ts';
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
import { type DecisionsHook, withDecisionTool } from './decisions.ts';
import type { InboundTurnHook } from './inbound.ts';
import type { ChatsLive, TurnCredential } from './live.ts';
import { type MachineWaits, type TurnWake, waitForMachine } from './machine-wait.ts';
import { type ServerToolsHook, serverToolsOf } from './server-tools.ts';
import { slotCheck, waitForSlot } from './slot-wait.ts';
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
 * its start (`task-hook.ts`). A prompt whose machine is stopped may start it and wait for it (`machine-wait.ts`); one
 * whose machine has every slot taken waits for a free slot (`slot-wait.ts`; a Compact or an answer is refused then).
 */

export interface TurnsDeps extends TargetDeps {
  readonly live: ChatsLive;
  readonly clock: () => Date;
  /** The tasks module's side of a task's conversation (S5.3b); none: chats know nothing of tasks. */
  readonly tasks?: TaskTurnHook | undefined;
  /** The server's own tools (S7.1c, the Atlassian tools); none: a turn gets none. */
  readonly serverTools?: ServerToolsHook | undefined;
  /** The decision log (2026-11-14); none: a turn gets no `record_decision`. */
  readonly decisions?: DecisionsHook | undefined;
  /** The waits for a stopped machine (the runtime's); none: a stopped machine refuses the turn (`machine_offline`). */
  readonly waits?: MachineWaits | undefined;
  /** What hears the end of a turn Most Wanted queued for a message from outside, one that never started too. */
  readonly inbound?: InboundTurnHook | undefined;
}

/**
 * Who starts or stops a turn: their principal; `system` when Most Wanted queues it itself (S6c: a Lead's wake-up, its
 * principal the agent's own), so the turn shows as Most Wanted's.
 */
export interface TurnCaller {
  readonly principalId: string;
  readonly system?: boolean | undefined;
  /** The team room's message a turn Most Wanted queues answers (docs/processes.md "The team room"). */
  readonly roomMessageId?: string | undefined;
  /** What a prompt may do when the agent's machine is stopped: wake it for a message or for work. */
  readonly wake?: TurnWake | undefined;
  /** A message from outside the turn speaks for (a Slack message: its sender, visible text and contact). */
  readonly from?: TurnFrom | undefined;
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
  if (!target.ok) {
    return target.code === MACHINE_OFFLINE.code ? waitForMachine(deps, t, caller, chat, prompt) : target;
  }
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
  const slot = await slotCheck(deps, t, chat);
  if (!slot.free) {
    const waits = how.kind === 'message' && how.check === undefined && deps.waits !== undefined;
    return waits ? waitForSlot(deps, t, caller, chat, prompt, slot.slots) : machineBusy(slot.slots);
  }
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
      ...ranWith(spec.data),
      startedAt: now,
      createdBy: caller.principalId,
      system: caller.system === true,
      roomMessageId: caller.roomMessageId ?? null,
      ...fromColumns(caller.from),
    },
    how,
  );
  if ('ok' in turn) return turn;
  const { credentialId, ownerUserId, kind } = target;
  const used = { credentialId, ownerUserId, kind };
  return launch(deps, t, turn, { machineId: chat.machineId, agent: target.agent }, used, spec.data, draft);
}

/**
 * What a turn's spec adds for the tools when its runner offers them: the agents' tools' names (S6a) with the decision
 * log's (2026-11-14), the server's own tools of its profile (S7.1c) with, on a runner that takes it, the GitHub sign-in
 * for git and gh (S7.1d), and its instructions with each one's line.
 */
export async function specTools(
  deps: TurnsDeps,
  t: TenantDb,
  turn: {
    readonly chat: Chat;
    readonly target: Target;
    readonly kind: ChatTurnKind;
    readonly draft: TaskTurnDraft | undefined;
  },
) {
  const { target, kind } = turn;
  const tasks = await toolsOf(deps.tasks, t, {
    chat: turn.chat,
    agent: target.agent,
    kind,
    draft: turn.draft,
    offers: target.agentTools,
    instructions: target.spec.instructions,
  });
  const decisions = { hook: deps.decisions, offers: target.decisions, kind };
  const agent = withDecisionTool(tasks, { ...decisions, instructions: target.spec.instructions });
  const instructions = agent.instructions ?? target.spec.instructions;
  const offers = target.serverTools;
  const git = target.github ? { chatId: turn.chat.id, agentId: target.agent.id, by: target.by } : undefined;
  const server = await serverToolsOf(deps.serverTools, t, {
    profileId: target.profileId,
    kind,
    offers,
    instructions,
    git,
    max: target.serverToolsMax,
  });
  return { ...agent, ...server };
}

/** Why a spec failed its schema: the paths of its issues, once each. */
export const specIssues = (error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[] }[];
}) => [...new Set(error.issues.map((i) => i.path.join('.')))].join(', ');

/**
 * Sends the recorded turn to its machine's runner and tells the stream (and, for a task's turn, the tasks module); one
 * gone in the meantime fails it at once (`machine_offline`), told to the stream too: a turn Most Wanted started has no
 * page waiting for the answer. Its sink knows the chat's agent, whose tools it answers.
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
    const failed = turnView((await turnsRepo.updateLive(t, turn.id, ended)) ?? turn);
    deps.live.bus.publish(turn.chatId, { kind: 'turn', turn: failed });
    return { ok: true, turn: failed };
  }
  deps.live.started(turn.id, channel);
  deps.live.bus.publish(turn.chatId, { kind: 'turn', turn: turnView(turn) });
  if (task !== undefined) await deps.tasks?.started(t, task, turn.createdBy);
  return { ok: true, turn: turnView(turn) };
}

/** Asks the runner to stop the chat's running turn, or ends one waiting for its machine; 202 with the turn, or why not. */
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
  if (turn.status === 'queued' && turn.machineWaitAt !== null) {
    const stopped = await deps.waits?.stop(t, turn);
    return stopped === undefined ? TURN_NOT_RUNNING : { ok: true, turn: turnView(stopped) };
  }
  if (turn.status !== 'running' || !deps.live.stop(turn.id)) return TURN_NOT_RUNNING;
  return { ok: true, turn: turnView(turn) };
}
