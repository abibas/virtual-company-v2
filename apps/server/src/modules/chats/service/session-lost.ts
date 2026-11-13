import type { Chat, ChatTurn, TenantDb } from '@mwc/db';
import { TurnSpec } from '@mwc/shared/harness';
import { historyRepo } from '../repo/history.ts';
import { slotsRepo } from '../repo/slots.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import { RECAP_EXCHANGES, recapExchanges, recapPrompt, sessionLostNotice } from '../rules/recap.ts';
import { MACHINE_OFFLINE } from '../rules.ts';
import type { LostTurn } from './live-end.ts';
import { resolveTarget } from './target.ts';
import { artifactsOf, type TaskTurnContext } from './task-hook.ts';
import { specTools, type TurnsDeps } from './turns.ts';
import { streamEvent } from './views.ts';

/**
 * A chat whose saved conversation the harness no longer has (docs/harness.md "A lost conversation", 2026-11-13: the
 * Docker runner's rebuild had dropped Claude Code's store, and the chat's next message failed with "No conversation
 * found with session ID"). The runner ends such a turn `session_missing` (it sees the harness's own words); here the
 * same turn starts again, once, on a fresh conversation: resolved as any turn is (the person who sent it, the profile,
 * the runner), without the session or a branch's fork, its prompt the recap of the conversation so far (`rules/recap.ts`:
 * the chat's own finished turns since its last Clear, or a branch's parent's up to the reply it branched from) then
 * the person's message. The chat forgets the lost session (its next `session` event saves the new one), the thread gets
 * a quiet notice, and the runner numbers the new events after it. A task step's conversation (Keep context too) goes the
 * same way, with its own turns. Only while the chat still names a session (so never twice for a turn) and only for a
 * message turn; anything that refuses leaves the turn to fail as before.
 */

/** The turns a recap reads: the chat's own before this one since its last Clear, or a pending branch's parent's. */
async function historyOf(t: TenantDb, chat: Chat, beforeSeq: number): Promise<ChatTurn[]> {
  const own = await conversationBefore(t, chat.id, beforeSeq);
  if (own.length > 0 || !chat.forkPending || chat.branchedFromChatId === null) return own;
  const reply =
    chat.branchedFromTurnId === null
      ? undefined
      : await turnsRepo.get(t, chat.branchedFromChatId, chat.branchedFromTurnId);
  return conversationBefore(t, chat.branchedFromChatId, reply === undefined ? undefined : reply.seq + 1);
}

/** The chat's turns before `beforeSeq` (none: all), since the last Clear before it, the latest few. */
async function conversationBefore(t: TenantDb, chatId: string, beforeSeq: number | undefined) {
  const clears = await historyRepo.clearsOf(t, chatId);
  const clear = clears.filter((c) => beforeSeq === undefined || c.seq < beforeSeq).at(-1);
  const range = { fromSeq: (clear?.seq ?? 0) + 1, ...(beforeSeq === undefined ? {} : { beforeSeq }) };
  return historyRepo.latestOf(t, chatId, range, RECAP_EXCHANGES * 2);
}

/**
 * Starts the turn again on a fresh conversation (see above): the chat's session forgotten and the notice written now,
 * and what sends it to the runner once the runner heard the end's ack; undefined when it cannot start again.
 */
export async function startAfresh(
  deps: TurnsDeps,
  t: TenantDb,
  turn: ChatTurn,
  lost: LostTurn,
): Promise<(() => void) | undefined> {
  const chat = await chatsRepo.get(t, turn.chatId);
  if (chat === undefined || chat.archivedAt !== null || chat.sessionId === null || turn.kind !== 'message')
    return undefined;
  const fresh = { ...chat, sessionId: null, forkPending: false };
  const target = await resolveTarget(deps, t, fresh, { principalId: turn.createdBy, purpose: 'chat_turn' });
  if (!target.ok) return undefined;
  const draft = draftOf(lost.task);
  const tools = await specTools(deps, t, { chat: fresh, target, kind: turn.kind, draft });
  const exchanges = recapExchanges(await historyOf(t, chat, turn.seq));
  const prompt = recapPrompt(exchanges, turn.prompt);
  const parsed = TurnSpec.safeParse({ ...target.spec, prompt, ...artifactsOf(draft), ...tools });
  if (!parsed.success) return undefined;
  await chatsRepo.update(t, chat.id, { sessionId: null, forkPending: false });
  const afterSeq = await notice(deps, t, turn, chat.machineId, exchanges.length > 0);
  const { credentialId, ownerUserId, kind } = target;
  const used = { credentialId, ownerUserId, kind };
  const agentPrincipalId = target.agent.principalId;
  return () => {
    const sink = deps.live.sink(t, turn, used, { task: lost.task, agentPrincipalId });
    const request = { turnId: turn.id, spec: parsed.data, afterSeq };
    const channel = deps.hub.turn(chat.machineId, request, sink);
    if (channel === undefined) void sink.end({ ok: false, exitCode: null, error: MACHINE_OFFLINE.code });
    else deps.live.started(turn.id, channel);
  };
}

/** A task step's turn's draft (its round and outputs folder) from its context. */
function draftOf(task: TaskTurnContext | undefined) {
  if (task === undefined) return undefined;
  const { turnId: _turnId, ...draft } = task;
  return draft;
}

/** Writes the thread's notice as the turn's next event and tells the stream; its number, which the runner goes on from. */
async function notice(deps: TurnsDeps, t: TenantDb, turn: ChatTurn, machineId: string, recapped: boolean) {
  const seq = (await turnsRepo.lastEventSeq(t, turn.id)) + 1;
  const { name } = await slotsRepo.machineOf(t, machineId);
  const event = { type: 'notice', level: 'info', message: sessionLostNotice(name, recapped) };
  const rows = await turnsRepo.insertEvents(t, turn.id, [{ seq, event, at: deps.clock() }]);
  for (const row of rows)
    deps.live.bus.publish(turn.chatId, { kind: 'event', event: streamEvent(turn, row) });
  return seq;
}
