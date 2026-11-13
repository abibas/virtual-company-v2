import type { ChatTurn, TenantDb } from '@mwc/db';
import type { CredentialKind } from '@mwc/shared/enums';
import type { Logger } from 'pino';
import type { CredentialsForHarness } from '../../credentials/index.ts';
import type { TurnChannel, TurnEnding } from '../../machines/index.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import { endedTurn, type TurnOutcome } from '../rules.ts';
import type { ChatBus } from './bus.ts';
import { heldForSlot } from './live-slot.ts';
import type { ServerToolsHook } from './server-tools.ts';
import type { TaskTurnContext, TaskTurnHook } from './task-hook.ts';
import { turnView } from './views.ts';

/**
 * A live turn's end (`live.ts`): its row closed (done, failed or stopped, with the reply and the usage), a Codex login
 * the process rewrote sealed again, the tasks module told, then the chat's next waiting turn. Two ends do not close it: a
 * full machine's refusal (`busy`) puts it back to wait for a slot (`live-slot.ts`), and a conversation the harness no
 * longer has (`session_missing`, 2026-11-13) starts it again on a fresh one with a recap (`session-lost.ts`), unless a
 * stop was asked: what that start sends runs once the runner heard the end's ack.
 */

/** The subscription a turn runs on: which credential, whose, of which kind (a Codex login is sealed again). */
export interface TurnCredential {
  readonly credentialId: string;
  readonly ownerUserId: string;
  readonly kind: CredentialKind;
}

export interface LiveDeps {
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly credentials: CredentialsForHarness;
  /** The tasks module's side of a task's conversation (S5.3b). */
  readonly tasks?: TaskTurnHook | undefined;
  /** The server's own tools (S7.1c), whose calls skip the write queue. */
  readonly serverTools?: ServerToolsHook | undefined;
}

export interface LiveTurn {
  channel: TurnChannel | undefined;
  stopRequested: boolean;
  /** Since when its runner is away and the turn waits for it (S5.4); undefined while attached. */
  detachedAt: Date | undefined;
}

/** What a turn that lost its conversation starts again with: its subscription and its task step. */
export interface LostTurn {
  readonly used: TurnCredential;
  readonly task: TaskTurnContext | undefined;
}

/** Starts a turn again on a fresh conversation: what runs after the end's ack, or undefined when it cannot. */
export type StartAfresh = (t: TenantDb, turn: ChatTurn, lost: LostTurn) => Promise<(() => void) | undefined>;

/** One turn's end as `ended` writes it. */
export interface Ending extends LostTurn {
  readonly ending: TurnEnding;
  readonly outcome: TurnOutcome;
}

/** What the steps of a turn's sink share: the deps, the stream's bus and the live turns. */
export interface Live {
  readonly deps: LiveDeps;
  readonly bus: ChatBus;
  readonly turns: Map<string, LiveTurn>;
  /** What runs once a turn's end is written (the chats' queue starts the next waiting turn). */
  ended?: (t: TenantDb, chatId: string) => Promise<void>;
  /** What runs once a turn the runner refused for a full machine waits for a slot (`live-slot.ts`). */
  busy?: (t: TenantDb, turn: ChatTurn) => Promise<void>;
  /** What starts a turn whose conversation was lost again on a fresh one (`session-lost.ts`). */
  afresh?: StartAfresh;
}

/** The runner's end of a turn whose resumed conversation is not on the machine (`turn.end.error`). */
export const SESSION_MISSING = 'session_missing';

/** True for a `session_missing` end. */
export const lostSession = (ending: TurnEnding): boolean =>
  !ending.ok &&
  (ending.error === SESSION_MISSING || ending.error?.startsWith(`${SESSION_MISSING}:`) === true);

/** The turn started again on a fresh conversation, if it can be; a failure to is logged and the turn fails as before. */
async function afresh(l: Live, t: TenantDb, turn: ChatTurn, lost: LostTurn) {
  try {
    return await l.afresh?.(t, turn, lost);
  } catch (error) {
    l.deps.logger.error({ err: error, turnId: turn.id }, 'chats: could not start a lost conversation afresh');
    return undefined;
  }
}

/**
 * Closes the turn's row from its end (see above), or puts it back to wait for a slot, or starts it again on a fresh
 * conversation: then what runs after the end's ack.
 */
export async function ended(
  l: Live,
  t: TenantDb,
  turn: ChatTurn,
  end: Ending,
): Promise<(() => void) | undefined> {
  const { ending, outcome, used } = end;
  const hold = { bus: l.bus, clock: l.deps.clock, busy: l.busy };
  if (await heldForSlot(hold, t, turn, ending)) {
    l.turns.delete(turn.id);
    return undefined;
  }
  if (ending.authJson !== undefined && used.kind === 'codex_oauth') {
    await l.deps.credentials.rewriteCodexLogin(
      used.credentialId,
      used.ownerUserId,
      ending.authJson,
      'chat_turn',
    );
  }
  const stopRequested = l.turns.get(turn.id)?.stopRequested ?? false;
  if (!stopRequested && lostSession(ending)) {
    const again = await afresh(l, t, turn, end);
    if (again !== undefined) {
      l.turns.delete(turn.id);
      return again;
    }
  }
  l.turns.delete(turn.id);
  const how = ending.error === undefined ? { ok: ending.ok } : { ok: ending.ok, error: ending.error };
  const row = await turnsRepo.updateLive(t, turn.id, {
    ...endedTurn(how, outcome, stopRequested, used.kind),
    endedAt: l.deps.clock(),
  });
  if (row === undefined) return undefined;
  await chatsRepo.update(t, turn.chatId, { updatedAt: l.deps.clock() });
  l.bus.publish(turn.chatId, { kind: 'turn', turn: turnView(row) });
  const { status, resultText, error } = row;
  if (end.task !== undefined) await l.deps.tasks?.ended(t, end.task, { status, resultText, error });
  if (row.system && row.kind === 'message') {
    const which = { chatId: row.chatId, turnId: row.id, roomMessageId: row.roomMessageId };
    await l.deps.tasks?.systemEnded?.(t, { ...which, status, resultText, error });
  }
  await l.ended?.(t, turn.chatId);
  return undefined;
}
