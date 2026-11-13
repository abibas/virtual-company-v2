import { type AccessProfile, type AiPartRow, aiPartOf, type Chat, type TenantDb } from '@mwc/db';
import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import { NO_OVERRIDES } from '@mwc/shared/modes';
import { profilesRepo } from '../repo/profiles.ts';
import { chatsRepo } from '../repo.ts';
import { OVERRIDES_UNSUPPORTED, overridesOf, overridesRefusal, takesOverrides } from '../rules/overrides.ts';
import { CHAT_ARCHIVED, CHAT_NOT_FOUND, type Refusal } from '../rules.ts';
import type { ProfileRunsView, UpdateChatOverrides } from '../schemas/overrides.ts';
import type { ChatView } from '../schemas.ts';
import { type AuditCaller, auditChat } from './audit.ts';
import { chatView } from './views.ts';

/**
 * A chat's own mode, model and effort for its next turns (2026-11-13, docs/harness.md "Modes"): set or cleared by
 * whoever may send it messages, at any time (a running turn keeps what it started with; the next one takes them), in a
 * message chat only, each checked against the chat's AI (`overridesRefusal`); audited with the chat. When the chat's
 * profile becomes one of another AI, they are cleared (`updateChat`, `switchedAi`).
 */

/** The profile a chat runs on (its own, else its agent's), or undefined without one. */
async function profileOf(t: TenantDb, chat: Pick<Chat, 'profileId' | 'agentId'>) {
  const profileId = chat.profileId ?? (await chatsRepo.agentOf(t, chat.agentId))?.profileId ?? null;
  return profileId === null ? undefined : profilesRepo.get(t, profileId);
}

/** The AI part of the chat's harness on the profile it runs on; undefined without one. */
export async function chatPart(t: TenantDb, chat: Chat): Promise<AiPartRow | undefined> {
  const profile = await profileOf(t, chat);
  return profile === undefined ? undefined : aiPartOf(profile, HARNESS_PROVIDER[chat.harness]);
}

/** What the profile the chat runs on runs for its harness, as the chat's detail shows it; null without one. */
export async function profileRunsOf(t: TenantDb, chat: Chat): Promise<ProfileRunsView | null> {
  const part = await chatPart(t, chat);
  return part === undefined ? null : { mode: part.mode, model: part.model, effort: part.effort };
}

/** The AI a profile runs: the provider of its AI part; null for a profile with none. */
const aiOf = (profile: AccessProfile | undefined): ProfileProvider | null =>
  profile?.claudePart ? 'claude' : profile?.openaiPart ? 'openai' : null;

/**
 * The overrides cleared when the chat would run on a profile of another AI than its harness's after a change of its
 * profile (Claude ↔ OpenAI); nothing otherwise.
 */
export async function switchedAi(t: TenantDb, chat: Chat, profileId: string | null) {
  const ai = aiOf(await profileOf(t, { agentId: chat.agentId, profileId }));
  const cleared = ai !== null && ai !== HARNESS_PROVIDER[chat.harness];
  return cleared && Object.values(overridesOf(chat)).some((value) => value !== null) ? NO_OVERRIDES : {};
}

/** Sets or clears the chat's own mode, model or effort (see above); an unchanged field writes nothing. */
export async function setOverrides(
  t: TenantDb,
  caller: AuditCaller,
  chatId: string,
  body: UpdateChatOverrides,
): Promise<{ readonly ok: true; readonly chat: ChatView } | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  if (chat.archivedAt !== null) return CHAT_ARCHIVED;
  if (!takesOverrides(chat)) return OVERRIDES_UNSUPPORTED;
  const before = overridesOf(chat);
  const after = {
    mode: body.mode === undefined ? before.mode : body.mode,
    model: body.model === undefined ? before.model : body.model,
    effort: body.effort === undefined ? before.effort : body.effort,
  };
  const provider = HARNESS_PROVIDER[chat.harness];
  const refused = overridesRefusal(provider, after, (await chatPart(t, chat))?.model ?? null);
  if (refused !== undefined) return refused;
  const set = Object.fromEntries(
    Object.entries(after).filter(([field, value]) => before[field as keyof typeof before] !== value),
  );
  if (Object.keys(set).length === 0) return { ok: true, chat: chatView(chat) };
  const changed = await chatsRepo.update(t, chat.id, set);
  await auditChat(t, caller, changed, 'update', chat);
  return { ok: true, chat: chatView(changed) };
}
