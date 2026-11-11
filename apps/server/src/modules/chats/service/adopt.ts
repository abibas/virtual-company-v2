import { type ChatTurn, type DbHandle, type TenantDb, tenant } from '@mwc/db';
import type { Logger } from 'pino';
import type { TurnAdopter, TurnSink } from '../../machines/index.ts';
import { profilesRepo } from '../repo/profiles.ts';
import { runningSince } from '../repo/reaper.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import type { ChatsLive, TurnCredential } from './live.ts';
import { type TaskTurnHook, taskContext, taskDraft } from './task-hook.ts';

/**
 * Turns a restarted server takes back (S5.4, docs/harness.md "Surviving restarts"): a runner that says hello with a turn
 * still running in the database, of a chat on its machine and held by no sink of this process, gets a sink built from
 * the turn's row (the credential it runs on, its task's step and round) and its stored events. Once the grace after
 * the start is over, every running turn a stopped server left that no runner took back ends through such a sink with
 * `server_restarted`, so its task is blocked and the chat's waiting messages start, as any turn's end.
 */

/** Why a turn a stopped server left running failed, once no runner took it back. */
export const SERVER_RESTARTED = 'server_restarted';

export interface AdoptDeps {
  readonly db: DbHandle;
  readonly logger: Logger;
  readonly live: ChatsLive;
  readonly tasks?: TaskTurnHook | undefined;
}

/** The credential a turn runs on as its sink needs it (whose, of which kind); an unknown kind when it is gone. */
async function usedOf(t: TenantDb, turn: ChatTurn): Promise<TurnCredential> {
  const profile = turn.profileId === null ? undefined : await profilesRepo.get(t, turn.profileId);
  const ownerUserId = profile?.ownerUserId ?? '';
  const credentialId = turn.credentialId ?? '';
  const kind =
    profile && turn.credentialId
      ? await profilesRepo.credentialKind(t, ownerUserId, turn.credentialId)
      : undefined;
  return { credentialId, ownerUserId, kind: kind ?? 'anthropic_api_key' };
}

/** The sink of a running turn this process does not hold; undefined when it is not one (or not of `machineId`). */
async function sinkOf(
  deps: AdoptDeps,
  t: TenantDb,
  turnId: string,
  machineId?: string,
): Promise<TurnSink | undefined> {
  const turn = await turnsRepo.byId(t, turnId);
  if (turn?.status !== 'running' || deps.live.holds(turn.id)) return undefined;
  const chat = await chatsRepo.get(t, turn.chatId);
  if (chat === undefined || (machineId !== undefined && chat.machineId !== machineId)) return undefined;
  const agent = await chatsRepo.agentOf(t, chat.agentId);
  const draft = agent && (await taskDraft(deps.tasks, t, { chat, agent, kind: turn.kind }));
  const context = { task: taskContext(draft, turn), agentPrincipalId: agent?.principalId };
  return deps.live.sink(t, turn, await usedOf(t, turn), context, true);
}

/** The hub's adopter: a runner's held turn, taken back when it is a running turn of a chat on that runner's machine. */
export function turnAdopter(deps: AdoptDeps): TurnAdopter {
  return async (runner, turnId) =>
    sinkOf(deps, await tenant(deps.db, runner.companyId), turnId, runner.machineId);
}

/** Ends the turns a stopped server left running (started before `before`) that no runner took back; how many. */
export async function failLeftTurns(deps: AdoptDeps, before: Date): Promise<number> {
  let failed = 0;
  for (const left of await runningSince(deps.db, before)) {
    try {
      const sink = await sinkOf(deps, await tenant(deps.db, left.companyId), left.id);
      if (sink === undefined) continue;
      await sink.end({ ok: false, exitCode: null, error: SERVER_RESTARTED });
      failed++;
    } catch (error) {
      deps.logger.warn({ err: error, turnId: left.id }, 'could not end a turn a stopped server left running');
    }
  }
  if (failed > 0) deps.logger.info({ failed }, 'failed the chat turns a stopped server left running');
  return failed;
}
