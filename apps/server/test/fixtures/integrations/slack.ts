/**
 * The Slack tools' tests helpers (S7.1e): a chat scene (`slackScene`) whose runner takes the server's tools and whose
 * profile has a Slack part (a bot's or a user's token sealed as the store does, its scopes, and its rights), and Slack's
 * answers at `slack.com/api`, read by method. Never a real Slack: every call goes to the fake provider (`w.provider`).
 */
import { accessProfiles, agents, credentials, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { SlackRights } from '@mwc/shared/credentials';
import { eq } from 'drizzle-orm';
import type { SubscriptionView } from '../../../src/modules/credentials/schemas.ts';
import { type ChatsWorld, type Scene, type SceneOptions, scene, startedTurn } from '../chats/world.ts';
import { type Answer, json, type ProviderCall } from '../credentials/providers.ts';
import { addSignIn, SLACK_BOT_SCOPES } from '../org.ts';

export { answerOf, callTool, principalOf, serverToolNames, statusOf, toolAudit } from './atlassian.ts';
export { SLACK_BOT_SCOPES };

/** Slack's Web API, where the connector calls. */
export const SLACK = 'https://slack.com/api';

/** The tokens the sealed test sign-ins hold (`SECRETS` of the profiles' fixtures), never shown. */
export const BOT_TOKEN = 'xoxb-1-SLACKBOTtokenNEVERshown';
export const USER_TOKEN = 'xoxp-1-SLACKUSERtokenNEVERshown';

/** Rights that read and post in #general and react there, unless changed. */
export const CHAT_GENERAL: SlackRights = {
  read: true,
  post: true,
  channels: ['general'],
  dms: 'off',
  search: false,
  react: true,
};

export interface SlackSceneOptions extends SceneOptions {
  readonly rights?: Partial<SlackRights> | null;
  /** A user's token instead of a bot's. */
  readonly user?: boolean;
  /** Leave the part without a sign-in. */
  readonly noSignIn?: boolean;
}

export interface SlackScene extends Scene {
  readonly signIn: SubscriptionView;
  /** The agent's name, which its posts show. */
  readonly agentName: string;
}

/** Sets a profile's Slack part straight in the table (no rules checked): its sign-in and rights, or none. */
export async function putSlackPart(
  db: DbHandle,
  profileId: string,
  part: { readonly credentialId: string | null; readonly rights: SlackRights | null },
): Promise<void> {
  await rawDb(db)
    .update(accessProfiles)
    .set({ slackCredentialId: part.credentialId, slackRights: part.rights })
    .where(eq(accessProfiles.id, profileId));
}

/** Gives a sealed Slack sign-in these scopes, straight in the table, as a check with Slack would. */
export async function setScopes(
  db: DbHandle,
  credentialId: string,
  scopes: readonly string[],
): Promise<void> {
  const [row] = await rawDb(db).select().from(credentials).where(eq(credentials.id, credentialId));
  await rawDb(db)
    .update(credentials)
    .set({ accountMeta: { ...row?.accountMeta, scopes } })
    .where(eq(credentials.id, credentialId));
}

/** The chat scene on a runner that takes the server's tools, its profile with a Slack part (`CHAT_GENERAL`). */
export async function slackScene(w: ChatsWorld, options: SlackSceneOptions = {}): Promise<SlackScene> {
  const s = await scene(w, { ...options, caps: { serverTools: true, serverToolsMax: 64, ...options.caps } });
  const kind = options.user ? 'slack_user_token' : 'slack_bot_token';
  const signIn = await addSignIn(w, w.keyring, s.company.owner.userId, kind);
  const rights = options.rights === null ? null : { ...CHAT_GENERAL, ...options.rights };
  const credentialId = options.noSignIn || rights === null ? null : signIn.id;
  await putSlackPart(w.t.db, s.profile.id, { credentialId, rights });
  const [agent] = await rawDb(w.t.db).select().from(agents).where(eq(agents.id, s.agentId));
  return { ...s, signIn, agentName: agent?.name as string };
}

/** A turn started on the scene, as the runner got it. */
export const slackTurn = (w: ChatsWorld, s: Scene, prompt = 'What’s new in #general?') =>
  startedTurn(w, s, prompt);

/** A call's form arguments, as the connector sent them. */
export const formOf = (call: ProviderCall | undefined): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(typeof call?.body === 'string' ? call.body : ''));

/** Slack's `{ok: true}` answer with these fields. */
export const ok = (fields: Record<string, unknown> = {}): Answer => json(200, { ok: true, ...fields });

/** Slack's refusal: HTTP 200 and `{ok: false, error}`. */
export const slackError = (error: string, fields: Record<string, unknown> = {}): Answer =>
  json(200, { ok: false, error, ...fields });

/** Answers Slack's methods (`conversations.history`), each with its answers in turn, the last one kept. */
export function answerSlack(w: ChatsWorld, methods: Record<string, Answer | readonly Answer[]>): void {
  for (const [method, answers] of Object.entries(methods)) {
    const list = Array.isArray(answers) ? answers : [answers as Answer];
    w.provider.route('POST', `${SLACK}/${method}`, ...list);
  }
}

/** The calls to one Slack method. */
export const callsOf = (w: ChatsWorld, method: string) => w.provider.callsTo(`${SLACK}/${method}`);

/** A channel as `conversations.list` and `conversations.info` give it. */
export const rawChannel = (id: string, name: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  ...(name === null ? {} : { name }),
  is_private: false,
  is_im: false,
  is_mpim: false,
  is_member: true,
  ...extra,
});

/** A message as `conversations.history` gives it. */
export const rawMessage = (ts: string, user: string, text: string, extra: Record<string, unknown> = {}) => ({
  ts,
  user,
  text,
  ...extra,
});

/** A person as `users.info` gives them. */
export const rawUser = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  real_name: name,
  profile: { display_name: name },
  ...extra,
});
