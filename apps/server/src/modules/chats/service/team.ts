import type { Chat, ChatTurn, TenantDb } from '@mwc/db';
import { CHAT_PROMPT, CHAT_TITLE } from '@mwc/shared/chats';
import { agentPlacement } from '../../machines/index.ts';
import { queueRepo } from '../repo/queue.ts';
import { chatsRepo } from '../repo.ts';
import {
  AGENT_ARCHIVED,
  AGENT_NOT_FOUND,
  CONTAINER_RUNS_LATER,
  PLACEMENT_MISSING,
  type Refusal,
  refuse,
} from '../rules.ts';
import { auditChat } from './audit.ts';
import { type QueueDeps, sendMessage } from './queue.ts';
import { turnView } from './views.ts';

/**
 * A flow's team chat with its Lead agent (S6c, docs/processes.md "Built: the Lead wakes up"), the chats module's side
 * of a Lead's wake-up, which the tasks module asks through `TeamChats` (passed in by `app.ts`). The chat is the flow's
 * latest team chat with the agent while it can go on (not archived, the agent's harness and machine unchanged), else a
 * new one titled "<flow>: team", made by Most Wanted (audited as the system). A wake-up's message goes there as a turn
 * Most Wanted queued (`system`, the agent as its sender), delivered "after this turn": at once while nothing runs, else
 * behind the running turn; while a wake-up of its own still waits there, the new message joins it rather than queue
 * another. Every check of a turn holds (the placement, the runner, the profile); a paused agent is not woken. A stopped
 * machine is started when its policy starts it for work, and the wake-up waits for it. A refusal says why in words.
 */

export const AGENT_PAUSED = refuse(409, 'agent_paused', 'The agent is paused: resume it to wake it');

/** What a wake-up asks: the flow (its name titles a new team chat), the Lead agent, the message. */
export interface LeadWakeRequest {
  readonly flowId: string;
  readonly flowName: string;
  readonly agentPrincipalId: string;
  readonly prompt: string;
}

/** Where the message went: the team chat, its turn, and whether it joined a wake-up that was waiting there. */
export type LeadWakeSent =
  | { readonly ok: true; readonly chatId: string; readonly turnId: string; readonly merged: boolean }
  | Refusal;

/** The chats' side of a Lead's wake-up (the port the tasks module calls). */
export interface TeamChats {
  wake(t: TenantDb, request: LeadWakeRequest): Promise<LeadWakeSent>;
}

/** A team chat's title: "<flow>: team", the flow's name cut to fit. */
export function teamTitle(flowName: string): string {
  const suffix = ': team';
  const room = CHAT_TITLE.max - suffix.length;
  const name = flowName.replace(/\s+/g, ' ').trim();
  return `${name.length <= room ? name : `${name.slice(0, room - 1).trimEnd()}…`}${suffix}`;
}

/** The flow's team chat with the Lead agent (see above), made when there is none that can go on; or why not. */
async function teamChat(t: TenantDb, request: LeadWakeRequest): Promise<Chat | Refusal> {
  const agent = await chatsRepo.agentByPrincipal(t, request.agentPrincipalId);
  if (agent === undefined) return AGENT_NOT_FOUND;
  if (agent.status === 'archived') return AGENT_ARCHIVED;
  if (agent.status === 'paused') return AGENT_PAUSED;
  const placed = await agentPlacement(t, agent.id);
  const placement = placed.ok ? placed.placement : null;
  if (placement === null) return PLACEMENT_MISSING;
  if (placement.mode === 'container') return CONTAINER_RUNS_LATER;
  const found = await chatsRepo.teamChatOf(t, request.flowId, agent.id);
  if (found?.harness === agent.harness && found.machineId === placement.machineId) return found;
  const chat = await chatsRepo.insert(t, {
    agentId: agent.id,
    harness: agent.harness,
    machineId: placement.machineId,
    flowId: request.flowId,
    title: teamTitle(request.flowName),
    createdBy: agent.principalId,
  });
  await auditChat(t, null, chat, 'create', null);
  return chat;
}

/** Joins the message to a wake-up still waiting in the chat, when it fits; the waiting turn, or undefined. */
async function joinWaiting(deps: QueueDeps, t: TenantDb, chat: Chat, prompt: string) {
  const waiting = (await queueRepo.queuedOf(t, chat.id))
    .filter((turn) => turn.system && turn.delivery === 'after')
    .at(-1);
  if (waiting === undefined) return undefined;
  const joined = `${waiting.prompt}\n\n${prompt}`;
  if (joined.length > CHAT_PROMPT.max) return undefined;
  const row: ChatTurn | undefined = await queueRepo.updateQueued(t, chat.id, waiting.id, { prompt: joined });
  if (row !== undefined) deps.live.bus.publish(chat.id, { kind: 'turn', turn: turnView(row) });
  return row;
}

/** The team chats over the chats' queue (see above). */
export function teamChats(deps: QueueDeps): TeamChats {
  return {
    async wake(t, request) {
      const chat = await teamChat(t, request);
      if (!('id' in chat)) return chat;
      const joined = await joinWaiting(deps, t, chat, request.prompt);
      if (joined !== undefined) return { ok: true, chatId: chat.id, turnId: joined.id, merged: true };
      const reason = `Started for a wake-up of the Lead of ${request.flowName}`;
      const caller = {
        principalId: request.agentPrincipalId,
        system: true,
        wake: { trigger: 'work' as const, reason },
      };
      const sent = await sendMessage(deps, t, caller, chat.id, request.prompt, 'after');
      if (!sent.ok) return sent;
      if (sent.turn.status === 'failed') {
        return refuse(409, sent.turn.error ?? 'turn_failed', `The turn could not start (${sent.turn.error})`);
      }
      return { ok: true, chatId: chat.id, turnId: sent.turn.id, merged: false };
    },
  };
}
