import type { Agent, Chat, TenantDb } from '@mwc/db';
import { BRANCH_SUPPORT } from '@mwc/shared/chats';
import { branchRepo } from '../repo/branch.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import {
  branchFacts,
  branchLatestOnly,
  branchPoint,
  branchTitle,
  isBranchable,
  LATEST_ONLY,
  TURN_NOT_BRANCHABLE,
} from '../rules/branch.ts';
import { AGENT_ARCHIVED, CHAT_NOT_FOUND, type Refusal, TURN_NOT_FOUND, TURN_RUNNING } from '../rules.ts';
import type { ChatBranchedFromView } from '../schemas/branch.ts';
import type { ChatView } from '../schemas.ts';
import type { ChatCaller } from '../service.ts';
import { auditChat } from './audit.ts';
import { chatView } from './views.ts';

/**
 * Branching a conversation (docs/harness.md "Branching"): a new chat with the same agent that continues the parent's
 * conversation from one of its replies, the parent untouched. The branch copies the parent's harness, machine, access
 * profile choice (and who made it) and the reply's session, names its parent and the reply, and stays `fork_pending`
 * until its first turn resumes that session forked (`forkOf`, read when the turn resolves) and its `session` event saves
 * the new one. Audited as `branch` (entity `chat`). A branch's detail names its parent (`branchedFromOf`).
 */

type Branched = { readonly ok: true; readonly chat: ChatView } | Refusal;

/** Branches the chat from the reply of `turnId` (see above), or says why not. */
export async function branchChat(
  t: TenantDb,
  caller: ChatCaller,
  chatId: string,
  turnId: string,
): Promise<Branched> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  const turn = await turnsRepo.get(t, chat.id, turnId);
  if (turn === undefined) return TURN_NOT_FOUND;
  if ((await turnsRepo.liveOf(t, chat.id)) !== undefined) return TURN_RUNNING;
  if (!isBranchable(turn)) return TURN_NOT_BRANCHABLE;
  const facts = branchFacts(await branchRepo.markersFrom(t, chat.id, turn.seq), turn.id);
  if (facts.sessionId === null) return TURN_NOT_BRANCHABLE;
  const point = branchPoint(BRANCH_SUPPORT[chat.harness], facts);
  if (!point.ok) return point;
  if (((await chatsRepo.agentOf(t, chat.agentId)) as Agent).status === 'archived') return AGENT_ARCHIVED;
  const branch = await chatsRepo.insert(t, {
    agentId: chat.agentId,
    harness: chat.harness,
    machineId: chat.machineId,
    profileId: chat.profileId,
    profileSetBy: chat.profileSetBy,
    sessionId: facts.sessionId,
    title: branchTitle(chat.title),
    branchedFromChatId: chat.id,
    branchedFromTurnId: turn.id,
    forkPending: true,
    createdBy: caller.principalId,
  });
  await auditChat(t, caller, branch, 'branch', null);
  return { ok: true, chat: chatView(branch) };
}

/** What a turn adds to its spec to fork the session: nothing once forked, else the fork and maybe a message. */
export interface TurnFork {
  readonly forkSession?: true;
  readonly resumeAt?: string;
}

/**
 * The fork a chat's next turn makes: none unless the chat is a branch whose first turn has not forked yet; then the
 * session forked, up to the reply's last message when later turns of the parent ran on its session. Read again at each
 * try, so a parent that went on since is still cut at the reply; one that can no longer be (Codex, a compaction) is
 * refused (`branch_latest_only`). A parent or reply gone forks the whole session.
 */
export async function forkOf(
  t: TenantDb,
  chat: Chat,
): Promise<{ readonly ok: true; readonly fork: TurnFork } | Refusal> {
  if (!chat.forkPending) return { ok: true, fork: {} };
  const parentId = chat.branchedFromChatId;
  const reply =
    parentId === null || chat.branchedFromTurnId === null
      ? undefined
      : await turnsRepo.get(t, parentId, chat.branchedFromTurnId);
  if (reply === undefined) return { ok: true, fork: { forkSession: true } };
  const facts = branchFacts(await branchRepo.markersFrom(t, reply.chatId, reply.seq), reply.id);
  const point = branchPoint(BRANCH_SUPPORT[chat.harness], facts);
  if (!point.ok) return branchLatestOnly(LATEST_ONLY.moved);
  const at = point.resumeAt === null ? {} : { resumeAt: point.resumeAt };
  return { ok: true, fork: { forkSession: true, ...at } };
}

/** The parent a branch's detail names (its "Branched from" line), with its title now; null for a chat begun anew. */
export async function branchedFromOf(t: TenantDb, chat: Chat): Promise<ChatBranchedFromView | null> {
  if (chat.branchedFromChatId === null) return null;
  const parent = (await chatsRepo.get(t, chat.branchedFromChatId)) as Chat;
  return { chatId: parent.id, turnId: chat.branchedFromTurnId, title: parent.title };
}
