import { type Chat, isUniqueViolation, type TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import {
  CHAT_ARCHIVED,
  CHAT_NOT_FOUND,
  COMPACT_UNSUPPORTED,
  NOTHING_TO_CLEAR,
  NOTHING_TO_COMPACT,
  type Refusal,
  TURN_RUNNING,
} from '../rules.ts';
import type { ChatTurnView } from '../schemas.ts';
import type { ChatsLive } from './live.ts';
import { startTurn, type TurnCaller, type TurnsDeps } from './turns.ts';
import { turnView } from './views.ts';

/**
 * A chat's conversation as a whole (S5.2, docs/harness.md "Compact and Clear"). Compact runs the harness's own
 * `/compact` as a turn of kind `compact` on the chat's session, with a turn's checks and credential; Codex runs no
 * slash command in a turn, so a Codex chat is refused. Clear runs nothing: it records a turn of kind `clear` (done at
 * once, on no credential, the thread's marker) and forgets the chat's session, so the next turn starts a new
 * conversation; the old one stays on the machine, unused.
 */

export const COMPACT_PROMPT = '/compact';
export const CLEAR_PROMPT = '/clear';

/** Why this chat cannot compact, beyond a turn's checks: no conversation yet, or a harness without `/compact`. */
export function compactRefusal(chat: Pick<Chat, 'sessionId' | 'harness'>): Refusal | undefined {
  if (chat.sessionId === null) return NOTHING_TO_COMPACT;
  return chat.harness === 'codex' ? COMPACT_UNSUPPORTED : undefined;
}

/** Starts the chat's `/compact` turn; 202 with the turn, or why not. */
export function compactChat(deps: TurnsDeps, t: TenantDb, caller: TurnCaller, chatId: string) {
  return startTurn(deps, t, caller, chatId, COMPACT_PROMPT, { kind: 'compact', refuse: compactRefusal });
}

export interface ClearDeps {
  readonly live: Pick<ChatsLive, 'bus'>;
  readonly clock: () => Date;
}

/** Records the Clear turn and forgets the session, unless a turn runs or there is none; in one transaction. */
async function recordClear(t: TenantDb, chat: Chat, caller: TurnCaller, now: Date) {
  try {
    return await t.transaction(async (tx) => {
      if ((await turnsRepo.liveOf(tx, chat.id)) !== undefined) return TURN_RUNNING;
      if (chat.sessionId === null) return NOTHING_TO_CLEAR;
      const seq = (await turnsRepo.lastSeq(tx, chat.id)) + 1;
      const turn = await turnsRepo.insert(tx, {
        id: newId(),
        chatId: chat.id,
        seq,
        kind: 'clear',
        prompt: CLEAR_PROMPT,
        status: 'done',
        startedAt: now,
        endedAt: now,
        createdBy: caller.principalId,
      });
      await chatsRepo.update(tx, chat.id, { sessionId: null, forkPending: false, updatedAt: now });
      return turn;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return TURN_RUNNING;
    throw error;
  }
}

/** Clears the chat's conversation (see above); the Clear turn, also told to the chat's stream, or why not. */
export async function clearChat(
  deps: ClearDeps,
  t: TenantDb,
  caller: TurnCaller,
  chatId: string,
): Promise<{ readonly ok: true; readonly turn: ChatTurnView } | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  if (chat.archivedAt !== null) return CHAT_ARCHIVED;
  const turn = await recordClear(t, chat, caller, deps.clock());
  if ('ok' in turn) return turn;
  const view = turnView(turn);
  deps.live.bus.publish(chat.id, { kind: 'turn', turn: view });
  return { ok: true, turn: view };
}
