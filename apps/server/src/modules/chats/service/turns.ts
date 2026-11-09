import { type Chat, type ChatTurn, isUniqueViolation, type TenantDb } from '@mwc/db';
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
import { resolveTarget, type TargetDeps } from './target.ts';
import { turnView } from './views.ts';

/**
 * A chat's turns (S5.1b, docs/harness.md "How a turn runs"): a prompt starts one on the agent's machine (resolved by
 * `target.ts`, refused with what to fix), recorded as running with the profile and credential it runs on, then sent to
 * the runner (`turn.start`) with its sink in place, so its events and end land in the database and the chat's stream;
 * the first prompt is the chat's title. A stop asks the runner to stop it; its end says `stopped`.
 */

export interface TurnsDeps extends TargetDeps {
  readonly live: ChatsLive;
  readonly clock: () => Date;
}

/** Who starts or stops a turn: their principal. */
export interface TurnCaller {
  readonly principalId: string;
}

type Started = { readonly ok: true; readonly turn: ChatTurnView } | Refusal;

const INVALID_SPEC = (paths: string) =>
  refuse(422, 'invalid_spec', `The agent's settings cannot start a turn (${paths}): fix them on the agent`);

/** Records the turn as running, unless another one runs (409), and gives the chat its title on the first. */
async function record(
  t: TenantDb,
  chatId: string,
  values: Omit<Parameters<typeof turnsRepo.insert>[1], 'seq'>,
) {
  try {
    return await t.transaction(async (tx) => {
      const seq = (await turnsRepo.lastSeq(tx, chatId)) + 1;
      const turn = await turnsRepo.insert(tx, { ...values, seq });
      const chat = (await chatsRepo.get(tx, chatId)) as Chat;
      const title = chat.title === null ? { title: titleOf(values.prompt) } : {};
      await chatsRepo.update(tx, chatId, { updatedAt: values.startedAt as Date, ...title });
      return turn;
    });
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
): Promise<Started> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  if (chat.archivedAt !== null) return CHAT_ARCHIVED;
  if ((await turnsRepo.liveOf(t, chat.id)) !== undefined) return TURN_RUNNING;
  const target = await resolveTarget(deps, t, chat, {
    principalId: caller.principalId,
    purpose: 'chat_turn',
  });
  if (!target.ok) return target;
  const spec = TurnSpec.safeParse({ ...target.spec, prompt });
  if (!spec.success)
    return INVALID_SPEC([...new Set(spec.error.issues.map((i) => i.path.join('.')))].join(', '));
  const now = deps.clock();
  const turn = await record(t, chat.id, {
    id: newId(),
    chatId: chat.id,
    prompt,
    status: 'running',
    profileId: target.profileId,
    credentialId: target.credentialId,
    startedAt: now,
    createdBy: caller.principalId,
  });
  if ('ok' in turn) return turn;
  const { credentialId, ownerUserId, kind } = target;
  return send(deps, t, turn, chat.machineId, { credentialId, ownerUserId, kind }, spec.data);
}

/** Sends the recorded turn to its machine's runner; one gone in the meantime fails it at once (`machine_offline`). */
async function send(
  deps: TurnsDeps,
  t: TenantDb,
  turn: ChatTurn,
  machineId: string,
  used: TurnCredential,
  spec: TurnSpec,
): Promise<Started> {
  const sink = deps.live.sink(t, turn, used);
  const channel = deps.hub.turn(machineId, { turnId: turn.id, spec }, sink);
  if (channel === undefined) {
    deps.live.forget(turn.id);
    const ended = { status: 'failed', error: MACHINE_OFFLINE.code, endedAt: deps.clock() } as const;
    return { ok: true, turn: turnView((await turnsRepo.updateLive(t, turn.id, ended)) ?? turn) };
  }
  deps.live.started(turn.id, channel);
  deps.live.bus.publish(turn.chatId, { kind: 'turn', turn: turnView(turn) });
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
