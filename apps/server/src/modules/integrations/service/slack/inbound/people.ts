import { owned } from '@mwc/db';
import type { SlackPerson } from '@mwc/shared/credentials';
import { isSlackError, type SlackSignIn, type SlackUser } from '@mwc/tools-core';
import type { InboundDeps } from './context.ts';
import { botSignIn } from './settings.ts';

/**
 * The workspace's people for a connection's "Only these people" (2026-11-13): an email is looked up with
 * `users.lookupByEmail` (`users:read.email`), a name among the people `users.list` gives (`users:read`, its first pages),
 * matching a person's handle, real name or display name, any case; bots and deactivated people are left out. The bot
 * sign-in is opened for `slack_people`. Slack's refusals come back in words.
 */

/** The most people one search gives, and the most pages of 200 a name is looked for in. */
export const PEOPLE_MAX = 20;
export const PEOPLE_PAGES = 5;

export type PeopleRefusal = {
  readonly ok: false;
  readonly status: 404 | 422 | 502;
  readonly code: string;
  readonly message: string;
};

/** A Slack person as listed: their real name first, an https avatar or none. */
export function personOf(user: SlackUser): SlackPerson {
  const image = user.image?.startsWith('https://') ? user.image.slice(0, 500) : null;
  return {
    id: user.id,
    name: (user.realName ?? user.displayName ?? user.name).slice(0, 120) || user.id,
    image,
  };
}

const isPerson = (user: SlackUser) => !user.isBot && !user.deleted && user.id !== 'USLACKBOT';

/** People whose handle, real name or display name holds the words. */
async function byName(deps: InboundDeps, signIn: SlackSignIn, words: string): Promise<SlackPerson[]> {
  const found: SlackPerson[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PEOPLE_PAGES && found.length < PEOPLE_MAX; page++) {
    const listed = await deps.slack.listUsers(signIn, { limit: 200, cursor });
    for (const user of listed.items.filter(isPerson)) {
      const names = [user.name, user.realName, user.displayName].map((name) => name?.toLowerCase() ?? '');
      if (names.some((name) => name.includes(words))) found.push(personOf(user));
    }
    if (listed.nextCursor === null) break;
    cursor = listed.nextCursor;
  }
  return found.slice(0, PEOPLE_MAX);
}

/** The people matching `q` (see above), or why not. */
export async function searchPeople(
  deps: InboundDeps,
  userId: string,
  credentialId: string,
  q: string,
): Promise<{ readonly ok: true; readonly people: SlackPerson[] } | PeopleRefusal> {
  const bot = await botSignIn(owned(deps.db, userId), credentialId);
  if ('ok' in bot) return bot;
  const opened = await deps.credentials.slackBot(credentialId, userId, { purpose: 'slack_people' });
  if (!opened.ok) return { ok: false, status: 422, code: 'credential_revoked', message: opened.message };
  const signIn = { token: opened.token };
  const words = q.trim().toLowerCase();
  try {
    if (!words.includes('@')) return { ok: true, people: await byName(deps, signIn, words) };
    const user = await deps.slack.lookupUserByEmail(signIn, words);
    return { ok: true, people: isPerson(user) ? [personOf(user)] : [] };
  } catch (error) {
    if (!isSlackError(error)) throw error;
    if (error.code === 'not_found') return { ok: true, people: [] };
    const away =
      error.code === 'unavailable' || error.code === 'rate_limited' || error.code === 'invalid_response';
    return away
      ? { ok: false, status: 502, code: 'provider_unavailable', message: error.message }
      : { ok: false, status: 422, code: 'slack_refused', message: error.message };
  }
}
