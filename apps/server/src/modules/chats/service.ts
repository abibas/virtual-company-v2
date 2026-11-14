import type { AccessProfile, Chat, DbHandle, TenantDb } from '@mwc/db';
import { aiPartOf } from '@mwc/db';
import { queueOrder } from '@mwc/shared/chats';
import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { Harness } from '@mwc/shared/enums';
import { agentPlacement } from '../machines/index.ts';
import { giveRefusal, profilePartMissing } from '../org/rules/agents.ts';
import { profilesRepo } from './repo/profiles.ts';
import { taskChatsRepo } from './repo/task-chats.ts';
import { chatsRepo } from './repo.ts';
import { isMessageChat } from './rules/people.ts';
import { openQuestion } from './rules/questions.ts';
import { AGENT_TASK_CHATS } from './rules/task-chats.ts';
import { AGENT_ARCHIVED, AGENT_NOT_FOUND, CHAT_NOT_FOUND, PLACEMENT_MISSING, type Refusal } from './rules.ts';
import type { ChatListItemView } from './schemas/activity.ts';
import type { CreateChat } from './schemas/people.ts';
import type { ChatDetailView, ChatView, UpdateChat } from './schemas.ts';
import { auditChat } from './service/audit.ts';
import { branchedFromOf } from './service/branch.ts';
import { listItems, peopleOf } from './service/faces.ts';
import { currentConversation } from './service/history.ts';
import type { TurnAway } from './service/live.ts';
import { profileRunsOf, switchedAi } from './service/overrides.ts';
import { joinable, seatPeople } from './service/people.ts';
import type { ChatSlackHook } from './service/slack.ts';
import { taskNamesOf } from './service/task-names.ts';
import { chatView } from './service/views.ts';

/**
 * The chats with an agent (S5.1b): list an agent's, begin one (on the agent's harness and its placement's machine,
 * with the caller's own access profile when they choose one), read one with its current conversation, rename it,
 * choose its profile (only one's own, with the part the chat's harness runs on: the rules of giving a profile to an
 * agent; any admin takes it off; one of another AI clears the chat's own mode, model and effort) and archive it.
 * Every change is audited (entity `chat`). The turns are `service/turns.ts`'s, a branch `service/branch.ts`'s.
 */

/** Who acts: the member's principal, person, role and how they signed in (giving a profile needs a session). */
export interface ChatCaller {
  readonly principalId: string;
  readonly userId: string;
  readonly role: 'owner' | 'admin' | 'member' | 'viewer';
  readonly session: boolean;
  readonly requestId: string;
}

type Shown = { readonly ok: true; readonly chat: ChatView };

/**
 * Why the caller may not choose this profile for a chat on `harness` (the rules of giving one to an agent: only their
 * own, with the harness's part, else 422 `profile_part_missing`); undefined when they may.
 */
async function chooseRefusal(t: TenantDb, caller: ChatCaller, profileId: string, harness: Harness) {
  const profile = await profilesRepo.get(t, profileId);
  const refusal = giveRefusal(caller, profile?.ownerUserId);
  if (refusal) return refusal;
  return aiPartOf(profile as AccessProfile, HARNESS_PROVIDER[harness])
    ? undefined
    : profilePartMissing(harness);
}

/**
 * The agent's chats not archived, the latest first; 404 for an unknown agent. The viewer's own: the message chats they
 * are in, and the team chats (their own rules), with the agent's task conversations apart (`tasks`, T-19: anyone who
 * opens them from the task's page, the latest `AGENT_TASK_CHATS`); with `others`, the message chats they are not in (an
 * owner's look), and no `tasks`.
 */
export async function listChats(
  db: DbHandle,
  t: TenantDb,
  agentId: string,
  viewer: string,
  others = false,
): Promise<{ ok: true; chats: ChatListItemView[]; tasks: ChatListItemView[] } | Refusal> {
  const agent = await chatsRepo.agentOf(t, agentId);
  if (agent === undefined) return AGENT_NOT_FOUND;
  if (others)
    return {
      ok: true,
      chats: await listItems(db, t, await chatsRepo.othersOf(t, agent.id, viewer)),
      tasks: [],
    };
  const own = await chatsRepo.ofAgent(t, agent.id, viewer);
  const tasks = await taskChatsRepo.ofAgent(t, agent.id, AGENT_TASK_CHATS);
  return { ok: true, chats: await listItems(db, t, own), tasks: await listItems(db, t, tasks) };
}

/** Begins a chat with the agent, on its harness and its placement's machine (see above). */
export async function createChat(
  t: TenantDb,
  caller: ChatCaller,
  agentId: string,
  body: CreateChat,
): Promise<Shown | Refusal> {
  const agent = await chatsRepo.agentOf(t, agentId);
  if (agent === undefined) return AGENT_NOT_FOUND;
  if (agent.status === 'archived') return AGENT_ARCHIVED;
  const placement = await agentPlacement(t, agent.id);
  if (!placement.ok || placement.placement === null) return PLACEMENT_MISSING;
  const profileId = body.profileId ?? null;
  const refused = profileId === null ? undefined : await chooseRefusal(t, caller, profileId, agent.harness);
  if (refused !== undefined) return refused;
  const others = (body.with ?? []).filter((id) => id !== caller.principalId);
  const people = others.length === 0 ? [] : await joinable(t, others);
  if (!Array.isArray(people)) return people;
  const chat = await chatsRepo.insert(t, {
    agentId: agent.id,
    harness: agent.harness,
    machineId: placement.placement.machineId,
    profileId,
    profileSetBy: profileId === null ? null : caller.userId,
    createdBy: caller.principalId,
  });
  const by = caller.principalId;
  await seatPeople(
    t,
    chat.id,
    [by, ...people].map((principalId) => ({ principalId, addedBy: by })),
  );
  await auditChat(t, caller, chat, 'create', null, people);
  return { ok: true, chat: chatView(chat) };
}

/**
 * What a chat's detail reads of the live runners: whether a running turn's runner is away, and what the chat's profile
 * gives that its runner is too old to provide (`runnerUpdateFor` of `service/server-tools.ts`); neither by default.
 */
export interface ChatDetailLive {
  readonly awayOf?: ((turnId: string) => TurnAway | undefined) | undefined;
  readonly runnerUpdateFor?: ((t: TenantDb, chat: Chat) => Promise<string | null>) | undefined;
  /** The Slack conversation a chat is for (2026-11-14); none: no chat shows one. */
  readonly slack?: ChatSlackHook | undefined;
}

/** Who reads a chat's detail: their person, and whether they only look on as an owner who is not in it. */
export interface ChatReader {
  readonly db: DbHandle;
  readonly userId: string;
  readonly looksOn: boolean;
}

/**
 * One chat (archived ones too) with its current conversation: the turns since its last Clear, the latest 30 with their
 * events, and what is left out (`service/history.ts`); what that conversation runs on and how full it is (the last
 * `init`, its size), its open question and its waiting turns in the order they start; a running turn whose runner is
 * away says `detached` and since when (S5.4, `awayOf`), and what waits for its runner's update (`runnerUpdateFor`); 404
 * for an unknown one.
 */
export async function getChat(
  t: TenantDb,
  chatId: string,
  reader: ChatReader,
  live: ChatDetailLive = {},
): Promise<{ ok: true; chat: ChatDetailView } | Refusal> {
  const { awayOf = () => undefined, runnerUpdateFor = async () => null } = live;
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  const current = await currentConversation(t, chat);
  const { earlier, state } = current;
  const turns = current.turns.map((turn) => {
    const away = turn.status === 'running' ? awayOf(turn.id) : undefined;
    if (away === undefined) return turn;
    return { ...turn, detached: true, ...(away.since ? { detachedAt: away.since.toISOString() } : {}) };
  });
  const queue = turns.filter((turn) => turn.status === 'queued').sort(queueOrder);
  const question = openQuestion(turns);
  const branchedFrom = await branchedFromOf(t, chat);
  const profileRuns = await profileRunsOf(t, chat);
  const detail = { ...chatView(chat), turns, earlier, branchedFrom, ...state, profileRuns, question };
  const update = await runnerUpdateFor(t, chat);
  const people = isMessageChat(chat) ? await peopleOf(reader.db, t, chat) : [];
  const ownerView = isMessageChat(chat) && reader.looksOn;
  const slack = (await live.slack?.conversationOf(t, chat.id, reader.userId)) ?? null;
  const shown = { people, ownerView, slack: slack && { ...slack, mayPost: slack.mayPost && !ownerView } };
  const forTask = (await taskNamesOf(t, [chat])).get(chat.id) ?? null;
  return {
    ok: true,
    chat: { ...detail, queue: queue.map((turn) => turn.id), runnerUpdateFor: update, ...shown, forTask },
  };
}

/** Renames a chat and chooses its profile (see above); an unchanged field writes nothing. */
export async function updateChat(
  t: TenantDb,
  caller: ChatCaller,
  chatId: string,
  body: UpdateChat,
): Promise<Shown | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  const set: Partial<Pick<Chat, 'title' | 'profileId' | 'profileSetBy' | 'mode' | 'model' | 'effort'>> = {};
  if (body.title !== undefined && body.title !== chat.title) set.title = body.title;
  if (body.profileId !== undefined && body.profileId !== chat.profileId) {
    const refused =
      body.profileId === null ? undefined : await chooseRefusal(t, caller, body.profileId, chat.harness);
    if (refused !== undefined) return refused;
    set.profileId = body.profileId;
    set.profileSetBy = body.profileId === null ? null : caller.userId;
    Object.assign(set, await switchedAi(t, chat, body.profileId));
  }
  if (Object.keys(set).length === 0) return { ok: true, chat: chatView(chat) };
  const after = await chatsRepo.update(t, chat.id, set);
  await auditChat(t, caller, after, 'update', chat);
  return { ok: true, chat: chatView(after) };
}

/** Archives a chat (it stays readable; a running turn finishes); archiving it again changes nothing. */
export async function archiveChat(
  t: TenantDb,
  caller: ChatCaller,
  chatId: string,
  now: Date,
): Promise<{ ok: true } | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  if (chat.archivedAt !== null) return { ok: true };
  const after = await chatsRepo.update(t, chat.id, { archivedAt: now });
  await auditChat(t, caller, after, 'archive', chat);
  return { ok: true };
}
